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

    async findByPhone(phone) {
      const [rows] = await pool.execute(
        `SELECT id
         FROM users
         WHERE phone = ?
         LIMIT 1`,
        [phone]
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
    },

    async recordFailedLogin(email) {
      const [result] = await pool.execute(
        `UPDATE users
         SET failed_login_count = CASE
               WHEN login_locked_until IS NOT NULL
                    AND login_locked_until <= UTC_TIMESTAMP(3) THEN 1
               WHEN login_locked_until IS NOT NULL THEN failed_login_count
               ELSE LEAST(failed_login_count + 1, ?)
             END,
             login_locked_until = CASE
               WHEN login_locked_until IS NOT NULL
                    AND login_locked_until <= UTC_TIMESTAMP(3) THEN NULL
               WHEN login_locked_until IS NOT NULL THEN login_locked_until
               WHEN failed_login_count >= ? THEN
                    DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? MINUTE)
               ELSE NULL
             END,
             updated_at = UTC_TIMESTAMP(3)
         WHERE email = ?`,
        [5, 5, 15, email]
      );
      return result.affectedRows;
    },

    async resetFailedLogins(email) {
      const [result] = await pool.execute(
        `UPDATE users
         SET failed_login_count = 0,
             login_locked_until = NULL,
             updated_at = UTC_TIMESTAMP(3)
         WHERE email = ?`,
        [email]
      );
      return result.affectedRows;
    },

    async updateProfile(id, { fullName, phone, gender, skillLevel }) {
      const [result] = await pool.execute(
        `UPDATE users
         SET full_name = IF(?, ?, full_name),
             phone = IF(?, ?, phone),
             gender = IF(?, ?, gender),
             skill_level = IF(?, ?, skill_level),
             updated_at = UTC_TIMESTAMP(3)
         WHERE id = ?`,
        [
          fullName !== undefined, fullName === undefined ? null : fullName,
          phone !== undefined, phone === undefined ? null : phone,
          gender !== undefined, gender === undefined ? null : gender,
          skillLevel !== undefined, skillLevel === undefined ? null : skillLevel,
          id
        ]
      );
      return result.affectedRows;
    },

    async updatePassword(id, passwordHash) {
      const [result] = await pool.execute(
        `UPDATE users
         SET password_hash = ?,
             updated_at = UTC_TIMESTAMP(3)
         WHERE id = ?`,
        [passwordHash, id]
      );
      return result.affectedRows;
    }
  };
}

module.exports = createUserRepository;
