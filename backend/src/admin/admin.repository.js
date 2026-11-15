'use strict';

function escapeLike(value) {
  return value.replace(/[!%_]/g, (character) => `!${character}`);
}

function buildBookingWhere({ status, query, facilityId, date }, includeDisplayStatus = false) {
  const conditions = [];
  const parameters = [];
  let bookingTimeJoin = '';
  if (status) {
    if (includeDisplayStatus && ['UPCOMING', 'IN_PROGRESS', 'COMPLETED'].includes(status)) {
      bookingTimeJoin = `LEFT JOIN (
        SELECT bs.booking_id,
               MIN(TIMESTAMP(ts.service_date, ts.starts_at)) AS first_slot_start,
               MAX(CASE
                 WHEN TIME(ts.ends_at) = '24:00:00'
                 THEN TIMESTAMP(DATE_ADD(ts.service_date, INTERVAL 1 DAY), '00:00:00')
                 ELSE TIMESTAMP(ts.service_date, ts.ends_at)
               END) AS last_slot_end
        FROM booking_slots AS bs
        INNER JOIN time_slots AS ts ON ts.id = bs.time_slot_id
        GROUP BY bs.booking_id
      ) AS booking_times ON booking_times.booking_id = b.id`;
      const localNow = 'DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 HOUR)';
      if (status === 'UPCOMING') {
        conditions.push(`b.status = 'CONFIRMED' AND booking_times.first_slot_start > ${localNow}`);
      } else if (status === 'IN_PROGRESS') {
        conditions.push(
          `b.status = 'CONFIRMED'
           AND booking_times.first_slot_start <= ${localNow}
           AND booking_times.last_slot_end > ${localNow}`
        );
      } else {
        conditions.push(
          `(b.status = 'COMPLETED'
            OR (b.status = 'CONFIRMED' AND booking_times.last_slot_end <= ${localNow}))`
        );
      }
    } else {
      conditions.push('b.status = ?');
      parameters.push(status);
    }
  }
  if (query) {
    conditions.push("b.booking_code LIKE ? ESCAPE '!'");
    parameters.push(`%${escapeLike(query)}%`);
  }
  if (facilityId || date) {
    const slotConditions = ['filter_bs.booking_id = b.id'];
    if (facilityId) {
      slotConditions.push('filter_c.facility_id = ?');
      parameters.push(facilityId);
    }
    if (date) {
      slotConditions.push('filter_ts.service_date = ?');
      parameters.push(date);
    }
    conditions.push(
      `EXISTS (
         SELECT 1
         FROM booking_slots AS filter_bs
         INNER JOIN time_slots AS filter_ts ON filter_ts.id = filter_bs.time_slot_id
         INNER JOIN courts AS filter_c ON filter_c.id = filter_bs.court_id
         WHERE ${slotConditions.join(' AND ')}
       )`
    );
  }
  return {
    bookingTimeJoin,
    whereClause: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
    parameters
  };
}

function createAdminRepository(pool) {
  if (!pool || typeof pool.execute !== 'function') {
    throw new TypeError('A MySQL-compatible pool is required.');
  }

  return {
    async withTransaction(callback) {
      const connection = await pool.getConnection();
      let committed = false;
      try {
        await connection.beginTransaction();
        const result = await callback(connection);
        await connection.commit();
        committed = true;
        return result;
      } catch (error) {
        if (!committed) await connection.rollback();
        throw error;
      } finally {
        connection.release();
      }
    },

    async listUsers({ query, status, page, pageSize, monthStartUtc, monthEndUtc }) {
      const conditions = [];
      const parameters = [];
      if (status) {
        conditions.push('u.account_status = ?');
        parameters.push(status);
      }
      if (query) {
        const escaped = query.replace(/[!%_]/g, '!$&');
        conditions.push("(u.full_name LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!')");
        parameters.push(`%${escaped}%`, `%${escaped}%`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const [countRows] = await pool.execute(
        `SELECT COUNT(*) AS total FROM users AS u ${where}`,
        parameters
      );
      const total = Number(countRows[0].total);
      if (!Number.isSafeInteger(total)) throw new RangeError('User count exceeds the supported range.');
      const [summaryRows] = await pool.execute(
        `SELECT COUNT(*) AS total_users,
                COALESCE(SUM(CASE WHEN u.account_status = 'ACTIVE' THEN 1 ELSE 0 END), 0) AS active_users,
                COALESCE(SUM(CASE WHEN u.account_status = 'ADMIN_LOCKED' THEN 1 ELSE 0 END), 0) AS locked_users,
                COALESCE(SUM(CASE WHEN u.created_at >= ? AND u.created_at < ? THEN 1 ELSE 0 END), 0) AS new_users_this_month
         FROM users AS u`,
        [monthStartUtc, monthEndUtc]
      );
      const summary = Object.fromEntries(
        ['total_users', 'active_users', 'locked_users', 'new_users_this_month']
          .map((key) => [key, Number(summaryRows[0][key])])
      );
      const [rows] = await pool.execute(
        `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.account_status,
                u.created_at, u.updated_at,
                COUNT(DISTINCT b.id) AS total_bookings,
                COALESCE(SUM(CASE WHEN b.status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS completed_count,
                COALESCE(SUM(CASE WHEN b.status = 'CANCELLED' THEN 1 ELSE 0 END), 0) AS cancelled_count,
                COALESCE(SUM(CASE
                  WHEN b.status = 'CANCELLED' AND b.cancelled_by = 'USER'
                    AND first_slot.starts_at IS NOT NULL
                    AND TIMESTAMPDIFF(
                      SECOND, b.cancelled_at, first_slot.starts_at - INTERVAL 7 HOUR
                    ) BETWEEN 0 AND 21600
                  THEN 1 ELSE 0 END), 0) AS late_cancel_count
         FROM users AS u
         LEFT JOIN bookings AS b ON b.user_id = u.id
         LEFT JOIN (
           SELECT bs.booking_id, MIN(TIMESTAMP(ts.service_date, ts.starts_at)) AS starts_at,
                  SUBSTRING_INDEX(
                    GROUP_CONCAT(ts.starts_at ORDER BY ts.service_date, ts.starts_at), ',', 1
                  ) AS first_start
           FROM booking_slots AS bs
           INNER JOIN time_slots AS ts ON ts.id = bs.time_slot_id
           GROUP BY bs.booking_id
         ) AS first_slot ON first_slot.booking_id = b.id
         ${where}
         GROUP BY u.id, u.full_name, u.email, u.phone, u.role, u.account_status,
                  u.created_at, u.updated_at
         ORDER BY u.id DESC
         LIMIT ? OFFSET ?`,
        [...parameters, pageSize, (page - 1) * pageSize]
      );
      return { rows, total, summary };
    },

    async exportUsers({ query, status, monthStartUtc, monthEndUtc, maxRows }) {
      const conditions = [];
      const parameters = [];
      if (status) {
        conditions.push('u.account_status = ?');
        parameters.push(status);
      }
      if (query) {
        conditions.push("(u.full_name LIKE ? ESCAPE '!' OR u.email LIKE ? ESCAPE '!')");
        parameters.push(`%${escapeLike(query)}%`, `%${escapeLike(query)}%`);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const [countRows] = await pool.execute(
        `SELECT COUNT(*) AS total FROM users AS u ${where}`,
        parameters
      );
      const total = Number(countRows[0].total);
      if (!Number.isSafeInteger(total)) throw new RangeError('User count exceeds the supported range.');
      const [summaryRows] = await pool.execute(
        `SELECT COUNT(*) AS total_users,
                COALESCE(SUM(CASE WHEN account_status = 'ACTIVE' THEN 1 ELSE 0 END), 0) AS active_users,
                COALESCE(SUM(CASE WHEN account_status = 'ADMIN_LOCKED' THEN 1 ELSE 0 END), 0) AS locked_users,
                COALESCE(SUM(CASE WHEN created_at >= ? AND created_at < ? THEN 1 ELSE 0 END), 0) AS new_users_this_month
         FROM users`,
        [monthStartUtc, monthEndUtc]
      );
      const summary = Object.fromEntries(
        ['total_users', 'active_users', 'locked_users', 'new_users_this_month']
          .map((key) => [key, Number(summaryRows[0][key])])
      );
      if (total > maxRows) return { rows: [], total, summary };
      const [rows] = await pool.execute(
        `SELECT u.id, u.full_name, u.email, u.phone, u.account_status, u.created_at
         FROM users AS u
         ${where}
         ORDER BY u.id DESC
         LIMIT ?`,
        [...parameters, maxRows]
      );
      return { rows, total, summary };
    },

    async lockUser(connection, userId) {
      const [rows] = await connection.execute(
        `SELECT id, role, account_status, updated_at
         FROM users WHERE id = ? FOR UPDATE`,
        [userId]
      );
      return rows[0] || null;
    },

    async lockUserSessions(connection, userId) {
      const [rows] = await connection.execute(
        `SELECT id FROM user_sessions
         WHERE user_id = ? AND revoked_at IS NULL
         ORDER BY id ASC FOR UPDATE`,
        [userId]
      );
      return rows.map((row) => row.id);
    },

    async updateUserLock(connection, userId, status) {
      const [result] = await connection.execute(
        `UPDATE users SET account_status = ?, updated_at = UTC_TIMESTAMP(3)
         WHERE id = ? AND account_status <> ?`,
        [status, userId, status]
      );
      return result.affectedRows;
    },

    async revokeUserSessions(connection, sessionIds) {
      if (sessionIds.length === 0) return 0;
      const placeholders = sessionIds.map(() => '?').join(', ');
      const [result] = await connection.execute(
        `UPDATE user_sessions SET revoked_at = UTC_TIMESTAMP(3)
         WHERE id IN (${placeholders}) AND revoked_at IS NULL`,
        sessionIds
      );
      return result.affectedRows;
    },

    async listBookings({ status, query, facilityId, date, page, pageSize }) {
      const { whereClause, parameters } = buildBookingWhere({ status, query, facilityId, date });
      const [countRows] = await pool.execute(
        `SELECT COUNT(*) AS total
         FROM bookings AS b
         ${whereClause}`,
        parameters
      );
      const total = Number(countRows[0].total);
      if (!Number.isSafeInteger(total)) {
        throw new RangeError('Booking count exceeds the supported range.');
      }

      const [rows] = await pool.execute(
        `SELECT b.id, b.booking_code, b.status, b.total_amount, b.created_at,
                (b.lock_expires_at > UTC_TIMESTAMP(3)) AS lock_active,
                p.status AS payment_status, p.paid_amount, p.refunded_amount,
                u.id AS owner_id, u.full_name AS owner_full_name,
                u.email AS owner_email, u.phone AS owner_phone
         FROM bookings AS b
         INNER JOIN users AS u ON u.id = b.user_id
         LEFT JOIN payments AS p ON p.booking_id = b.id
         ${whereClause}
         ORDER BY b.created_at DESC, b.id DESC
         LIMIT ? OFFSET ?`,
        [...parameters, pageSize, (page - 1) * pageSize]
      );

      return { rows, total };
    },

    async exportBookings({ status, query, facilityId, date, maxRows }) {
      const { bookingTimeJoin, whereClause, parameters } = buildBookingWhere(
        { status, query, facilityId, date },
        true
      );
      const [countRows] = await pool.execute(
        `SELECT COUNT(DISTINCT b.id) AS total
         FROM bookings AS b
         ${bookingTimeJoin}
         ${whereClause}`,
        parameters
      );
      const total = Number(countRows[0].total);
      if (!Number.isSafeInteger(total)) {
        throw new RangeError('Booking count exceeds the supported range.');
      }
      if (total > maxRows) return { rows: [], total };
      const [rows] = await pool.execute(
        `SELECT b.id, b.booking_code, b.status, b.total_amount, b.created_at,
                b.cancelled_by, b.cancellation_reason,
                p.paid_amount, p.refunded_amount,
                u.full_name AS owner_full_name, u.phone AS owner_phone,
                u.email AS owner_email
         FROM bookings AS b
         INNER JOIN users AS u ON u.id = b.user_id
         LEFT JOIN payments AS p ON p.booking_id = b.id
         ${bookingTimeJoin}
         ${whereClause}
         ORDER BY b.created_at DESC, b.id DESC
         LIMIT ?`,
        [...parameters, maxRows]
      );
      return { rows, total };
    },

    async findBookingSlots(bookingIds) {
      if (bookingIds.length === 0) {
        return [];
      }
      const placeholders = bookingIds.map(() => '?').join(', ');
      const [rows] = await pool.execute(
        `SELECT bs.booking_id, bs.time_slot_id, bs.court_id, bs.price_at_booking,
                DATE_FORMAT(ts.service_date, '%Y-%m-%d') AS service_date,
                TIME_FORMAT(ts.starts_at, '%H:%i:%s') AS starts_at,
                TIME_FORMAT(ts.ends_at, '%H:%i:%s') AS ends_at,
                c.name AS court_name, c.sport_type,
                f.id AS facility_id, f.name AS facility_name
         FROM booking_slots AS bs
         INNER JOIN time_slots AS ts ON ts.id = bs.time_slot_id
         INNER JOIN courts AS c ON c.id = bs.court_id
         INNER JOIN facilities AS f ON f.id = c.facility_id
         WHERE bs.booking_id IN (${placeholders})
         ORDER BY ts.service_date ASC, ts.starts_at ASC, ts.id ASC`,
        bookingIds
      );
      return rows;
    },

    async getBookingDetail(bookingId) {
      const [rows] = await pool.execute(
        `SELECT b.id, b.booking_code, b.status, b.total_amount, b.created_at,
                (b.lock_expires_at > UTC_TIMESTAMP(3)) AS lock_active,
                b.cancelled_by, b.cancellation_reason,
                p.status AS payment_status, p.payment_option, p.paid_amount, p.refunded_amount,
                u.id AS owner_id, u.full_name AS owner_full_name,
                u.email AS owner_email, u.phone AS owner_phone
         FROM bookings AS b
         INNER JOIN users AS u ON u.id = b.user_id
         LEFT JOIN payments AS p ON p.booking_id = b.id
         WHERE b.id = ?`,
        [bookingId]
      );
      return rows[0] || null;
    },

    async getDashboardBookingCounts(start, end) {
      const [rows] = await pool.execute(
        `SELECT COUNT(*) AS new_bookings,
                COALESCE(SUM(CASE WHEN status = 'CONFIRMED' THEN 1 ELSE 0 END), 0) AS confirmed_bookings,
                COALESCE(SUM(CASE WHEN status = 'CANCELLED' THEN 1 ELSE 0 END), 0) AS cancelled_bookings,
                COALESCE(SUM(CASE WHEN status = 'COMPLETED' THEN 1 ELSE 0 END), 0) AS completed_bookings,
                COALESCE(SUM(CASE WHEN status = 'PENDING' THEN 1 ELSE 0 END), 0) AS pending_bookings,
                COALESCE(SUM(CASE WHEN status = 'EXPIRED' THEN 1 ELSE 0 END), 0) AS expired_bookings
         FROM bookings
         WHERE created_at >= ? AND created_at < ?`,
        [start, end]
      );
      return {
        ...rows[0],
        bookings_by_status: {
          PENDING: Number(rows[0].pending_bookings),
          CONFIRMED: Number(rows[0].confirmed_bookings),
          COMPLETED: Number(rows[0].completed_bookings),
          CANCELLED: Number(rows[0].cancelled_bookings),
          EXPIRED: Number(rows[0].expired_bookings)
        }
      };
    },

    async getDashboardPaymentMetrics(start, end) {
      const [rows] = await pool.execute(
        `SELECT
           COALESCE(SUM(paid_amount), 0) AS gross_paid,
           COALESCE(SUM(refunded_amount), 0) AS refunded
         FROM payments
         WHERE paid_at >= ? AND paid_at < ?`,
        [start, end]
      );
      return rows[0];
    },

    async getRevenueByDay(start, end) {
      const [rows] = await pool.execute(
        `SELECT DATE_FORMAT(DATE_ADD(paid_at, INTERVAL 7 HOUR), '%Y-%m-%d') AS date,
                COALESCE(SUM(paid_amount - refunded_amount), 0) AS net_revenue
         FROM payments
         WHERE paid_at >= ? AND paid_at < ?
         GROUP BY DATE(DATE_ADD(paid_at, INTERVAL 7 HOUR))
         ORDER BY date ASC`,
        [start, end]
      );
      return rows;
    },

    async getRevenueSeries(start, end, hourly) {
      const bucketExpression = hourly
        ? "DATE_FORMAT(DATE_ADD(paid_at, INTERVAL 7 HOUR), '%Y-%m-%d %H:00:00')"
        : "DATE_FORMAT(DATE_ADD(paid_at, INTERVAL 7 HOUR), '%Y-%m-%d 00:00:00')";
      const [rows] = await pool.execute(
        `SELECT ${bucketExpression} AS bucket,
                COALESCE(SUM(paid_amount - refunded_amount), 0) AS net_revenue
         FROM payments
         WHERE paid_at >= ? AND paid_at < ?
         GROUP BY bucket
         ORDER BY bucket ASC`,
        [start, end]
      );
      return rows;
    },

    async getBookingSeries(start, end, hourly) {
      const bucketExpression = hourly
        ? "DATE_FORMAT(DATE_ADD(created_at, INTERVAL 7 HOUR), '%Y-%m-%d %H:00:00')"
        : "DATE_FORMAT(DATE_ADD(created_at, INTERVAL 7 HOUR), '%Y-%m-%d 00:00:00')";
      const [rows] = await pool.execute(
        `SELECT ${bucketExpression} AS bucket, COUNT(*) AS bookings
         FROM bookings
         WHERE created_at >= ? AND created_at < ?
         GROUP BY bucket
         ORDER BY bucket ASC`,
        [start, end]
      );
      return rows;
    },

    async getDashboardCourtCounts(start, end) {
      const [rows] = await pool.execute(
        `SELECT
           (SELECT COUNT(*) FROM courts WHERE is_active = TRUE) AS courts_active,
           (SELECT COUNT(*) FROM courts WHERE is_active = FALSE) AS courts_inactive,
           COUNT(DISTINCT CASE
             WHEN b.status = 'PENDING' AND b.lock_expires_at > UTC_TIMESTAMP(3)
               OR b.status = 'CONFIRMED'
                 AND TIMESTAMP(ts.service_date, ts.ends_at) > DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 HOUR)
             THEN c.id
           END) AS courts_with_bookings
         FROM bookings AS b
         INNER JOIN booking_slots AS bs ON bs.booking_id = b.id
         INNER JOIN time_slots AS ts ON ts.id = bs.time_slot_id
         INNER JOIN courts AS c ON c.id = bs.court_id
         WHERE b.created_at >= ? AND b.created_at < ?`,
        [start, end]
      );
      return rows[0];
    },

    async getDashboardFillRate(fromDate, toDate) {
      const [rows] = await pool.execute(
        `SELECT COUNT(*) AS total_slots,
                COALESCE(SUM(CASE WHEN status = 'BOOKED' THEN 1 ELSE 0 END), 0) AS booked_slots
         FROM time_slots
         WHERE service_date >= ? AND service_date <= ?
           AND status IN ('AVAILABLE', 'LOCKED', 'BOOKED')
           AND (status <> 'LOCKED' OR lock_expires_at > UTC_TIMESTAMP(3))`,
        [fromDate, toDate]
      );
      return rows[0];
    },

    async getTopCourts(start, end) {
      const [rows] = await pool.execute(
        `SELECT ranked.facility_name, ranked.court_name, ranked.sport_type,
                COUNT(*) AS booking_count,
                COALESCE(SUM(ranked.revenue), 0) AS revenue
         FROM (
           SELECT c.id AS court_id, b.id AS booking_id,
                  f.name AS facility_name, c.name AS court_name, c.sport_type,
                  COALESCE(MAX(p.paid_amount - p.refunded_amount), 0) AS revenue
           FROM bookings AS b
           INNER JOIN booking_slots AS bs ON bs.booking_id = b.id
           INNER JOIN courts AS c ON c.id = bs.court_id
           INNER JOIN facilities AS f ON f.id = c.facility_id
           LEFT JOIN payments AS p
             ON p.booking_id = b.id AND p.paid_at >= ? AND p.paid_at < ?
           WHERE b.created_at >= ? AND b.created_at < ?
           GROUP BY c.id, b.id, f.name, c.name, c.sport_type
         ) AS ranked
         GROUP BY ranked.court_id, ranked.facility_name, ranked.court_name, ranked.sport_type
         ORDER BY booking_count DESC, revenue DESC, ranked.court_id ASC
         LIMIT 5`,
        [start, end, start, end]
      );
      return rows;
    },

    async getRecentBookings(limit) {
      const [rows] = await pool.execute(
        `SELECT b.id, b.booking_code, b.status, b.created_at,
                (b.lock_expires_at > UTC_TIMESTAMP(3)) AS lock_active,
                u.full_name AS owner_name, u.phone AS owner_phone,
                p.status AS payment_status, p.payment_option,
                COALESCE(p.paid_amount, 0) AS paid_amount,
                COALESCE(p.refunded_amount, 0) AS refunded_amount
         FROM bookings AS b
         INNER JOIN users AS u ON u.id = b.user_id
         LEFT JOIN payments AS p ON p.booking_id = b.id
         ORDER BY b.created_at DESC, b.id DESC
         LIMIT ?`,
        [limit]
      );
      return rows;
    }
  };
}

module.exports = createAdminRepository;
