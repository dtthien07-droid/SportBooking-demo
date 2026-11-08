'use strict';

const { assertBcryptHash } = require('../../backend/src/auth/password.helper');

const ADMIN_EMAIL = 'admin@sportbooking.com';
const ADMIN_FULL_NAME = 'SportBooking Admin';

async function seedAdmin(pool, passwordHash) {
  if (!pool || typeof pool.execute !== 'function') {
    throw new TypeError('A MySQL-compatible pool is required.');
  }

  assertBcryptHash(passwordHash);

  const [rows] = await pool.execute(
    `SELECT id
     FROM users
     WHERE email = ?
     LIMIT 1`,
    [ADMIN_EMAIL]
  );
  if (rows.length > 0) {
    return false;
  }

  try {
    await pool.execute(
      `INSERT INTO users
         (full_name, email, password_hash, role, account_status,
          failed_login_count, login_locked_until, terms_accepted_at,
          created_at, updated_at)
       VALUES (?, ?, ?, 'ADMIN', 'ACTIVE', 0, NULL, NULL,
               UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [ADMIN_FULL_NAME, ADMIN_EMAIL, passwordHash]
    );
  } catch (error) {
    if (error && error.code === 'ER_DUP_ENTRY') {
      return false;
    }
    throw error;
  }

  return true;
}

async function main() {
  const { closePool, getPool } = require('../../backend/src/config/database');
  const passwordHash = process.env.ADMIN_PASSWORD_HASH;

  if (!passwordHash) {
    throw new Error('ADMIN_PASSWORD_HASH must be configured before seeding the admin account.');
  }

  const pool = getPool();
  try {
    const created = await seedAdmin(pool, passwordHash);
    console.log(created ? 'Admin account created.' : 'Admin account already exists; no changes made.');
  } finally {
    await closePool();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Admin seed failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { seedAdmin };
