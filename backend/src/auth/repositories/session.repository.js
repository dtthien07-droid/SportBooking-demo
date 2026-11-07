'use strict';

function createSessionRepository(pool) {
  if (!pool || typeof pool.execute !== 'function') {
    throw new TypeError('A MySQL-compatible pool is required.');
  }

  return {
    async createSession({ userId, tokenHash, expiresAt }) {
      const [result] = await pool.execute(
        `INSERT INTO user_sessions
           (user_id, token_hash, expires_at, created_at)
         VALUES (?, ?, ?, UTC_TIMESTAMP(3))`,
        [userId, tokenHash, expiresAt]
      );
      return result.insertId;
    },

    async findActiveByTokenHash(tokenHash) {
      const [rows] = await pool.execute(
        `SELECT s.id AS session_id, s.user_id, s.expires_at, s.revoked_at,
                u.full_name, u.email, u.phone, u.gender, u.skill_level,
                u.role, u.account_status
         FROM user_sessions AS s
         INNER JOIN users AS u ON u.id = s.user_id
         WHERE s.token_hash = ?
           AND s.revoked_at IS NULL
           AND s.expires_at > UTC_TIMESTAMP(3)
         LIMIT 1`,
        [tokenHash]
      );
      return rows[0] || null;
    },

    async revokeByTokenHash(tokenHash) {
      const [result] = await pool.execute(
        `UPDATE user_sessions
         SET revoked_at = UTC_TIMESTAMP(3)
         WHERE token_hash = ?
           AND revoked_at IS NULL`,
        [tokenHash]
      );
      return result.affectedRows;
    }
  };
}

module.exports = createSessionRepository;
