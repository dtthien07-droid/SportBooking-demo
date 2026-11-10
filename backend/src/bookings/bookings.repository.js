'use strict';

const crypto = require('node:crypto');

function createBookingRepository(pool) {
  if (!pool || typeof pool.execute !== 'function') {
    throw new TypeError('A MySQL-compatible pool is required.');
  }

  async function withTransaction(callback) {
    if (typeof pool.getConnection !== 'function') {
      throw new TypeError('The database pool must support transactions.');
    }
    const connection = await pool.getConnection();
    let committed = false;
    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      committed = true;
      return result;
    } catch (error) {
      if (!committed) {
        try {
          await connection.rollback();
        } catch (rollbackError) {
          throw new AggregateError(
            [error, rollbackError],
            'The booking transaction and its rollback both failed.'
          );
        }
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  return {
    withTransaction,

    async lockUser(connection, userId) {
      const [rows] = await connection.execute(
        'SELECT id FROM users WHERE id = ? FOR UPDATE',
        [userId]
      );
      return rows[0] || null;
    },

    async lockPendingBookingsForUser(connection, userId) {
      const [rows] = await connection.execute(
        `SELECT id, lock_expires_at,
                CASE
                  WHEN lock_expires_at IS NULL
                       OR lock_expires_at <= UTC_TIMESTAMP(3)
                  THEN 1 ELSE 0
                END AS lock_expired,
                CASE
                  WHEN lock_expires_at IS NULL THEN 0
                  ELSE GREATEST(
                    0,
                    CEIL(TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), lock_expires_at) / 1000000)
                  )
                END AS remaining_seconds
         FROM bookings
         WHERE user_id = ?
           AND status = 'PENDING'
         ORDER BY id ASC
         FOR UPDATE`,
        [userId]
      );
      return rows;
    },

    async findActivePendingBookingByUser(userId) {
      const [rows] = await pool.execute(
        `SELECT id
         FROM bookings
         WHERE user_id = ?
           AND status = 'PENDING'
           AND lock_expires_at > UTC_TIMESTAMP(3)
         ORDER BY id ASC
         LIMIT 1`,
        [userId]
      );
      return rows[0] || null;
    },

    async findRequestedSlotStates(connection, slotIds) {
      const placeholders = slotIds.map(() => '?').join(', ');
      const [rows] = await connection.execute(
        `SELECT id, status, current_booking_id, lock_expires_at,
                CASE
                  WHEN lock_expires_at IS NOT NULL
                       AND lock_expires_at <= UTC_TIMESTAMP(3)
                  THEN 1 ELSE 0
                END AS lock_expired
         FROM time_slots
         WHERE id IN (${placeholders})
         ORDER BY id ASC`,
        slotIds
      );
      return rows;
    },

    async lockBookings(connection, bookingIds) {
      if (bookingIds.length === 0) {
        return [];
      }
      const placeholders = bookingIds.map(() => '?').join(', ');
      const [rows] = await connection.execute(
        `SELECT id, status, lock_expires_at,
                CASE
                  WHEN lock_expires_at IS NOT NULL
                       AND lock_expires_at <= UTC_TIMESTAMP(3)
                  THEN 1 ELSE 0
                END AS lock_expired
         FROM bookings
         WHERE id IN (${placeholders})
         ORDER BY id ASC
         FOR UPDATE`,
        bookingIds
      );
      return rows;
    },

    async findSlotIdsForBookings(connection, bookingIds) {
      if (bookingIds.length === 0) {
        return [];
      }
      const placeholders = bookingIds.map(() => '?').join(', ');
      const [rows] = await connection.execute(
        `SELECT time_slot_id
         FROM booking_slots
         WHERE booking_id IN (${placeholders})
         ORDER BY time_slot_id ASC`,
        bookingIds
      );
      return rows.map((row) => row.time_slot_id);
    },

    async lockTimeSlots(connection, slotIds) {
      if (slotIds.length === 0) {
        return [];
      }
      const placeholders = slotIds.map(() => '?').join(', ');
      const [rows] = await connection.execute(
        `SELECT ts.id, ts.court_id,
                DATE_FORMAT(ts.service_date, '%Y-%m-%d') AS service_date,
                TIME_FORMAT(ts.starts_at, '%H:%i:%s') AS starts_at,
                TIME_FORMAT(ts.ends_at, '%H:%i:%s') AS ends_at,
                ts.price, ts.status, ts.current_booking_id, ts.lock_expires_at,
                c.name AS court_name, c.sport_type,
                c.is_active AS court_is_active,
                f.id AS facility_id, f.name AS facility_name,
                f.is_active AS facility_is_active,
                CASE
                  WHEN ts.lock_expires_at IS NOT NULL
                       AND ts.lock_expires_at <= UTC_TIMESTAMP(3)
                  THEN 1 ELSE 0
                END AS lock_expired,
                CASE
                  WHEN TIMESTAMP(ts.service_date, ts.starts_at)
                       >= DATE_ADD(DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 HOUR), INTERVAL 15 MINUTE)
                  THEN 1 ELSE 0
                END AS starts_in_time,
                CASE
                  WHEN TIMESTAMP(ts.service_date, ts.starts_at)
                       >= DATE_ADD(DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 HOUR), INTERVAL 30 MINUTE)
                  THEN 1 ELSE 0
                END AS starts_in_match_time
         FROM time_slots AS ts
         LEFT JOIN courts AS c ON c.id = ts.court_id
         LEFT JOIN facilities AS f ON f.id = c.facility_id
         WHERE ts.id IN (${placeholders})
         ORDER BY ts.id ASC
         FOR UPDATE`,
        slotIds
      );
      return rows;
    },

    async expireStaleBooking(connection, bookingId) {
      await connection.execute(
        `UPDATE bookings
         SET status = 'EXPIRED', updated_at = UTC_TIMESTAMP(3)
         WHERE id = ?
           AND status = 'PENDING'
           AND (lock_expires_at IS NULL OR lock_expires_at <= UTC_TIMESTAMP(3))`,
        [bookingId]
      );
      await connection.execute(
        `UPDATE time_slots
         SET status = 'AVAILABLE',
             current_booking_id = NULL,
             lock_expires_at = NULL,
             updated_at = UTC_TIMESTAMP(3)
         WHERE current_booking_id = ?
           AND status = 'LOCKED'`,
        [bookingId]
      );
    },

    async createBooking(connection, {
      bookingCode, userId, totalAmount, matchPreference, expiresAt
    }) {
      const [result] = await connection.execute(
        `INSERT INTO bookings
           (booking_code, user_id, status, total_amount, match_preference, lock_expires_at,
            created_at, updated_at)
         VALUES (?, ?, 'PENDING', ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [bookingCode, userId, totalAmount, matchPreference, expiresAt]
      );
      return result.insertId;
    },

    async createPayment(connection, { bookingId, amountDue, paymentOption }) {
      const [result] = await connection.execute(
        `INSERT INTO payments
           (booking_id, status, amount_due, paid_amount, refunded_amount,
            payment_option, created_at, updated_at)
         VALUES (?, 'PENDING', ?, 0, 0, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [bookingId, amountDue, paymentOption]
      );
      return result.insertId;
    },

    async createBookingSlots(connection, bookingId, slots) {
      for (const slot of slots) {
        await connection.execute(
          `INSERT INTO booking_slots
             (booking_id, time_slot_id, court_id, price_at_booking, created_at)
           VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`,
          [bookingId, slot.id, slot.court_id, slot.price]
        );
      }
    },

    async createHoldDeadline(connection) {
      const [rows] = await connection.execute(
        'SELECT DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 10 MINUTE) AS lock_expires_at'
      );
      return rows[0].lock_expires_at;
    },

    async lockTimeSlotsForBooking(connection, slotIds, bookingId, expiresAt) {
      const placeholders = slotIds.map(() => '?').join(', ');
      const [result] = await connection.execute(
        `UPDATE time_slots
         SET status = 'LOCKED',
             current_booking_id = ?,
             lock_expires_at = ?,
             updated_at = UTC_TIMESTAMP(3)
         WHERE id IN (${placeholders})
           AND (status = 'AVAILABLE'
                OR (status = 'LOCKED' AND lock_expires_at <= UTC_TIMESTAMP(3)))`,
        [bookingId, expiresAt, ...slotIds]
      );
      return result.affectedRows;
    },

    async lockSlotsForBooking(connection, bookingId) {
      const [rows] = await connection.execute(
        `SELECT time_slot_id
         FROM booking_slots
         WHERE booking_id = ?
         ORDER BY time_slot_id ASC`,
        [bookingId]
      );
      return rows.map((row) => row.time_slot_id);
    },

    async lockBooking(connection, bookingId) {
      const [rows] = await connection.execute(
        `SELECT id, booking_code, user_id, status, total_amount, lock_expires_at,
                CASE
                  WHEN lock_expires_at IS NOT NULL
                       AND lock_expires_at <= UTC_TIMESTAMP(3)
                  THEN 1 ELSE 0
                END AS lock_expired
         FROM bookings
         WHERE id = ?
         FOR UPDATE`,
        [bookingId]
      );
      return rows[0] || null;
    },

    async lockPaymentForBooking(connection, bookingId) {
      const [rows] = await connection.execute(
        `SELECT id, status, amount_due, paid_amount
         FROM payments
         WHERE booking_id = ?
         LIMIT 1
         FOR UPDATE`,
        [bookingId]
      );
      return rows[0] || null;
    },

    async createPaymentAttempt(connection, { paymentId, method, amount, result }) {
      const [numberRows] = await connection.execute(
        `SELECT COALESCE(MAX(attempt_no), 0) + 1 AS attempt_no
         FROM payment_attempts
         WHERE payment_id = ?`,
        [paymentId]
      );
      const attemptNo = numberRows[0].attempt_no;
      const [insert] = await connection.execute(
        `INSERT INTO payment_attempts
           (payment_id, attempt_no, method, amount, result, created_at, completed_at)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [paymentId, attemptNo, method, amount, result]
      );
      const [attemptRows] = await connection.execute(
        `SELECT created_at, completed_at
         FROM payment_attempts WHERE id = ?`,
        [insert.insertId]
      );
      return {
        id: String(insert.insertId),
        attempt_no: Number(attemptNo),
        method,
        amount: String(amount),
        result,
        created_at: attemptRows[0].created_at,
        completed_at: attemptRows[0].completed_at
      };
    },

    async markPaymentPaid(connection, paymentId, amount) {
      const [result] = await connection.execute(
        `UPDATE payments
         SET status = ?, paid_amount = ?, paid_at = UTC_TIMESTAMP(3),
             updated_at = UTC_TIMESTAMP(3)
         WHERE id = ? AND status = ?`,
        ['PAID', amount, paymentId, 'PENDING']
      );
      if (result.affectedRows !== 1) {
        throw new Error('Payment changed before it could be marked paid.');
      }
    },

    async confirmBooking(connection, bookingId) {
      const [result] = await connection.execute(
        `UPDATE bookings
         SET status = ?, updated_at = UTC_TIMESTAMP(3)
         WHERE id = ? AND status = ?
           AND lock_expires_at > UTC_TIMESTAMP(3)`,
        ['CONFIRMED', bookingId, 'PENDING']
      );
      if (result.affectedRows !== 1) {
        throw new Error('Booking changed before it could be confirmed.');
      }
    },

    async bookSlotsForBooking(connection, bookingId) {
      const [result] = await connection.execute(
        `UPDATE time_slots
         SET status = ?, lock_expires_at = NULL, updated_at = UTC_TIMESTAMP(3)
         WHERE current_booking_id = ? AND status = ?
           AND lock_expires_at > UTC_TIMESTAMP(3)`,
        ['BOOKED', bookingId, 'LOCKED']
      );
      if (result.affectedRows === 0) {
        throw new Error('No locked booking slots could be confirmed.');
      }
      return result.affectedRows;
    },

    async createBookingTicket(connection, bookingId) {
      const qrCode = `QR-${crypto.randomBytes(24).toString('hex').toUpperCase()}`;
      const [result] = await connection.execute(
        `INSERT INTO booking_tickets (booking_id, qr_code, created_at)
         VALUES (?, ?, UTC_TIMESTAMP(3))`,
        [bookingId, qrCode]
      );
      return { id: String(result.insertId), qr_code: qrCode };
    },

    async findPaymentsByBookingId(bookingId) {
      const [rows] = await pool.execute(
        `SELECT p.id AS payment_id, p.status AS payment_status, p.amount_due,
                p.paid_amount, p.refunded_amount, p.payment_option, p.paid_at, p.refunded_at,
                pa.id AS attempt_id, pa.attempt_no, pa.method, pa.amount AS attempt_amount,
                pa.result, pa.provider_reference, pa.created_at AS attempt_created_at,
                pa.completed_at, bt.id AS ticket_id, bt.qr_code, bt.created_at AS ticket_created_at
         FROM payments p
         LEFT JOIN payment_attempts pa ON pa.payment_id = p.id
         LEFT JOIN booking_tickets bt ON bt.booking_id = p.booking_id
         WHERE p.booking_id = ?
         ORDER BY pa.attempt_no ASC`,
        [bookingId]
      );
      if (rows.length === 0) return null;
      const payment = rows[0];
      const attempts = rows.filter((row) => row.attempt_id !== null).map((attempt) => ({
        id: String(attempt.attempt_id),
        attempt_no: Number(attempt.attempt_no),
        method: attempt.method,
        amount: String(attempt.attempt_amount),
        result: attempt.result,
        provider_reference: attempt.provider_reference,
        created_at: attempt.attempt_created_at,
        completed_at: attempt.completed_at
      }));
      const ticketRow = rows.find((row) => row.ticket_id !== null);
      return {
        payment: {
          id: String(payment.payment_id),
          status: payment.payment_status,
          amount_due: String(payment.amount_due),
          paid_amount: String(payment.paid_amount),
          refunded_amount: String(payment.refunded_amount),
          payment_option: payment.payment_option,
          paid_at: payment.paid_at,
          refunded_at: payment.refunded_at
        },
        attempts,
        ticket: !ticketRow ? null : {
          id: String(ticketRow.ticket_id),
          qr_code: ticketRow.qr_code,
          created_at: ticketRow.ticket_created_at
        }
      };
    },

    async updateBookingStatus(connection, bookingId, status) {
      const cancelledAt = status === 'CANCELLED' ? 'cancelled_at = UTC_TIMESTAMP(3),' : '';
      await connection.execute(
        `UPDATE bookings
         SET status = ?, ${cancelledAt}updated_at = UTC_TIMESTAMP(3)
         WHERE id = ? AND status = 'PENDING'`,
        [status, bookingId]
      );
    },

    async releaseBookingSlots(connection, bookingId) {
      await connection.execute(
        `UPDATE time_slots
         SET status = 'AVAILABLE',
             current_booking_id = NULL,
             lock_expires_at = NULL,
             updated_at = UTC_TIMESTAMP(3)
         WHERE current_booking_id = ? AND status = 'LOCKED'`,
        [bookingId]
      );
    },

    async findBookingById(bookingId) {
      const [rows] = await pool.execute(
        `SELECT b.id, b.booking_code, b.user_id, b.status, b.total_amount,
                b.match_preference, b.lock_expires_at,
                p.status AS payment_status, p.amount_due, p.paid_amount,
                p.refunded_amount, p.payment_option,
                CASE
                  WHEN b.status != 'PENDING' OR b.lock_expires_at IS NULL THEN NULL
                  ELSE GREATEST(
                    0,
                    CEIL(TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), b.lock_expires_at) / 1000000)
                  )
                END AS remaining_seconds,
                CASE
                  WHEN b.lock_expires_at IS NOT NULL
                       AND b.lock_expires_at <= UTC_TIMESTAMP(3)
                  THEN 1 ELSE 0
                END AS lock_expired
         FROM bookings AS b
         LEFT JOIN payments AS p ON p.booking_id = b.id
         WHERE b.id = ?
         LIMIT 1`,
        [bookingId]
      );
      return rows[0] || null;
    },

    async findBookingSlotsById(bookingId) {
      const [rows] = await pool.execute(
        `SELECT bs.time_slot_id, bs.court_id, bs.price_at_booking,
                DATE_FORMAT(ts.service_date, '%Y-%m-%d') AS service_date,
                TIME_FORMAT(ts.starts_at, '%H:%i:%s') AS starts_at,
                TIME_FORMAT(ts.ends_at, '%H:%i:%s') AS ends_at,
                c.name AS court_name, c.sport_type,
                f.id AS facility_id, f.name AS facility_name
         FROM booking_slots AS bs
         INNER JOIN time_slots AS ts ON ts.id = bs.time_slot_id
         INNER JOIN courts AS c ON c.id = bs.court_id
         INNER JOIN facilities AS f ON f.id = c.facility_id
         WHERE bs.booking_id = ?
         ORDER BY ts.service_date ASC, ts.starts_at ASC, ts.id ASC`,
        [bookingId]
      );
      return rows;
    },

    async findExpiredBookingIds(limit) {
      const [rows] = await pool.execute(
        `SELECT id
         FROM bookings
         WHERE status = 'PENDING'
           AND lock_expires_at <= UTC_TIMESTAMP(3)
         ORDER BY lock_expires_at ASC, id ASC
         LIMIT ?`,
        [limit]
      );
      return rows.map((row) => row.id);
    },

    async expireBookingIfDue(bookingId) {
      return withTransaction(async (connection) => {
        const booking = await this.lockBooking(connection, bookingId);
        if (!booking || booking.status !== 'PENDING' || Number(booking.lock_expired) !== 1) {
          return false;
        }
        const slotIds = await this.lockSlotsForBooking(connection, bookingId);
        await this.lockTimeSlots(connection, slotIds);
        await this.updateBookingStatus(connection, bookingId, 'EXPIRED');
        await this.releaseBookingSlots(connection, bookingId);
        return true;
      });
    }
  };
}

module.exports = createBookingRepository;
