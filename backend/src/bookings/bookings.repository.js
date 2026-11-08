'use strict';

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

    async findPendingBookingForUser(connection, userId) {
      const [rows] = await connection.execute(
        `SELECT id
         FROM bookings
         WHERE user_id = ?
           AND status = 'PENDING'
           AND (lock_expires_at IS NULL OR lock_expires_at > UTC_TIMESTAMP(3))
         ORDER BY id ASC
         LIMIT 1
         FOR UPDATE`,
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
                       >= DATE_ADD(
                         DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 HOUR),
                         INTERVAL 15 MINUTE
                       )
                  THEN 1 ELSE 0
                END AS starts_in_time
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
           AND lock_expires_at <= UTC_TIMESTAMP(3)`,
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

    async createBooking(connection, { bookingCode, userId, totalAmount, expiresAt }) {
      const [result] = await connection.execute(
        `INSERT INTO bookings
           (booking_code, user_id, status, total_amount, lock_expires_at,
            created_at, updated_at)
         VALUES (?, ?, 'PENDING', ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [bookingCode, userId, totalAmount, expiresAt]
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
        `SELECT id, booking_code, user_id, status, total_amount, lock_expires_at,
                CASE
                  WHEN status != 'PENDING' OR lock_expires_at IS NULL THEN NULL
                  ELSE GREATEST(
                    0,
                    CEIL(TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), lock_expires_at) / 1000000)
                  )
                END AS remaining_seconds,
                CASE
                  WHEN lock_expires_at IS NOT NULL
                       AND lock_expires_at <= UTC_TIMESTAMP(3)
                  THEN 1 ELSE 0
                END AS lock_expired
         FROM bookings
         WHERE id = ?
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
