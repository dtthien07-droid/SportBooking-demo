'use strict';

function createAdminRepository(pool) {
  if (!pool || typeof pool.execute !== 'function') {
    throw new TypeError('A MySQL-compatible pool is required.');
  }

  return {
    async listBookings({ status, query, page, pageSize }) {
      const conditions = [];
      const parameters = [];
      if (status) {
        conditions.push('b.status = ?');
        parameters.push(status);
      }
      if (query) {
        const escapedQuery = query.replace(/[!%_]/g, '!$&');
        conditions.push("b.booking_code LIKE ? ESCAPE '!'");
        parameters.push(`%${escapedQuery}%`);
      }
      const whereClause = conditions.length > 0
        ? `WHERE ${conditions.join(' AND ')}`
        : '';
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

    async getBookingDashboardCounts(start, end) {
      const [rows] = await pool.execute(
        `SELECT COUNT(*) AS new_bookings,
                COALESCE(SUM(CASE WHEN status = ? THEN 1 ELSE 0 END), 0) AS cancelled_bookings,
                COALESCE(SUM(CASE WHEN status = ? THEN 1 ELSE 0 END), 0) AS completed_bookings
         FROM bookings
         WHERE created_at >= ? AND created_at < ?`,
        ['CANCELLED', 'COMPLETED', start, end]
      );
      return rows[0];
    },

    async getRevenueEvents(start, end) {
      const [rows] = await pool.execute(
        `SELECT
           COALESCE(SUM(CASE
             WHEN paid_at >= ? AND paid_at < ? THEN paid_amount ELSE 0
           END), 0) AS paid_amount,
           COALESCE(SUM(CASE
             WHEN refunded_at >= ? AND refunded_at < ? THEN refunded_amount ELSE 0
           END), 0) AS refunded_amount
         FROM payments`,
        [start, end, start, end]
      );
      return rows[0];
    }
  };
}

module.exports = createAdminRepository;
