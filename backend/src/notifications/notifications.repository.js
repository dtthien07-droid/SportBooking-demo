'use strict';

async function insertNotification(connection, {
  userId,
  category,
  title,
  body,
  resourceType = null,
  resourceId = null
}) {
  await connection.execute(
    `INSERT INTO notifications
       (user_id, category, title, body, resource_type, resource_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
    [userId, category, title, body, resourceType, resourceId]
  );
}

function createNotificationsRepository(pool) {
  if (!pool || typeof pool.execute !== 'function') {
    throw new TypeError('A MySQL-compatible pool is required.');
  }

  return {
    async listForUser({ userId, category, page, pageSize }) {
      const where = category ? 'WHERE user_id = ? AND category = ?' : 'WHERE user_id = ?';
      const values = category ? [userId, category] : [userId];
      const [countRows] = await pool.execute(
        `SELECT COUNT(*) AS total FROM notifications ${where}`,
        values
      );
      const total = Number(countRows[0].total);
      if (!Number.isSafeInteger(total)) {
        throw new RangeError('Notification count exceeds the supported range.');
      }
      const offset = (page - 1) * pageSize;
      const [rows] = await pool.execute(
        `SELECT id, category, title, body, resource_type, resource_id, read_at, created_at
         FROM notifications ${where}
         ORDER BY created_at DESC, id DESC
         LIMIT ? OFFSET ?`,
        [...values, pageSize, offset]
      );
      return { rows, total };
    },

    async countUnread(userId) {
      const [rows] = await pool.execute(
        'SELECT COUNT(*) AS count FROM notifications WHERE user_id = ? AND read_at IS NULL',
        [userId]
      );
      const count = Number(rows[0].count);
      if (!Number.isSafeInteger(count)) {
        throw new RangeError('Unread notification count exceeds the supported range.');
      }
      return count;
    },

    async markRead(userId, notificationId) {
      await pool.execute(
        `UPDATE notifications
         SET read_at = UTC_TIMESTAMP(3)
         WHERE id = ? AND user_id = ? AND read_at IS NULL`,
        [notificationId, userId]
      );
      const [rows] = await pool.execute(
        `SELECT id, category, title, body, resource_type, resource_id, read_at, created_at
         FROM notifications
         WHERE id = ? AND user_id = ?`,
        [notificationId, userId]
      );
      return rows[0] || null;
    },

    async markAllRead(userId) {
      const [result] = await pool.execute(
        `UPDATE notifications
         SET read_at = UTC_TIMESTAMP(3)
         WHERE user_id = ? AND read_at IS NULL`,
        [userId]
      );
      return result.affectedRows;
    }
  };
}

module.exports = { createNotificationsRepository, insertNotification };
