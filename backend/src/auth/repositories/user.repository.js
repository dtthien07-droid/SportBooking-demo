'use strict';

function createUserRepository(pool) {
  if (!pool || typeof pool.execute !== 'function') {
    throw new TypeError('A MySQL-compatible pool is required.');
  }

  return {
    async findByEmail(email) {
      const [rows] = await pool.execute(
        `SELECT id, full_name, email, password_hash, phone, gender, skill_level,
                role, account_status, failed_login_count, login_locked_until,
                terms_accepted_at, created_at, updated_at
         FROM users
         WHERE email = ?
         LIMIT 1`,
        [email]
      );
      return rows[0] || null;
    },

    async findById(id) {
      const [rows] = await pool.execute(
        `SELECT id, full_name, email, password_hash, phone, gender, skill_level,
                role, account_status, failed_login_count, login_locked_until,
                terms_accepted_at, created_at, updated_at
         FROM users
         WHERE id = ?
         LIMIT 1`,
        [id]
      );
      return rows[0] || null;
    },

    async createUser({ fullName, email, passwordHash, phone = null, termsAcceptedAt }) {
      const [result] = await pool.execute(
        `INSERT INTO users
           (full_name, email, password_hash, phone, terms_accepted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [fullName, email, passwordHash, phone, termsAcceptedAt]
      );
      return result.insertId;
    }
  };
}

module.exports = createUserRepository;
