'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

if (process.env.APP_ENV !== 'test' || process.env.DB_NAME !== 'sportbooking_test') {
  throw new Error('Auth integration tests require APP_ENV=test and DB_NAME=sportbooking_test.');
}

const { closePool, getPool } = require('../src/config/database');
const { comparePassword } = require('../src/auth/password.helper');
const { hashToken } = require('../src/auth/session.service');
const { getSecureCookieSetting } = require('../src/auth/session.cookie');
const { createApp } = require('../src/app');

function randomPassword() {
  return crypto.randomBytes(24).toString('base64url');
}

function randomPhone() {
  return `+84${String(crypto.randomInt(100000000, 1000000000))}`;
}

function cookiePair(setCookie) {
  assert.ok(setCookie, 'Login must set a session cookie.');
  return setCookie.split(';', 1)[0];
}

async function postJson(baseUrl, path, body, cookie) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) {
    headers.cookie = cookie;
  }
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
}

test('auth integration against sportbooking_test', async (t) => {
  const pool = getPool();
  const userEmail = `integration-${crypto.randomUUID()}@example.test`;
  const secondEmail = `integration-${crypto.randomUUID()}@example.test`;
  const userPhone = randomPhone();
  const secondPhone = randomPhone();
  const password = randomPassword();
  const newPassword = randomPassword();
  let databaseVerified = false;
  let server;

  try {
    const [databaseRows] = await pool.execute('SELECT DATABASE() AS database_name');
    assert.equal(databaseRows[0].database_name, 'sportbooking_test');
    databaseVerified = true;

    const app = createApp({ pool });
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const authPath = '/api/v1/auth';
    const profilePath = '/api/v1/users/me';
    const passwordPath = '/api/v1/users/me/password';

    const unauthenticatedMe = await fetch(`${baseUrl}${authPath}/me`);
    assert.equal(unauthenticatedMe.status, 401);
    const unauthenticatedProfile = await fetch(`${baseUrl}${profilePath}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ fullName: 'Unauthorized' })
    });
    assert.equal(unauthenticatedProfile.status, 401);
    const unauthenticatedLogout = await postJson(baseUrl, `${authPath}/logout`, {});
    assert.equal(unauthenticatedLogout.status, 401);

    const invalidRegistration = await postJson(baseUrl, `${authPath}/register`, {
      fullName: 'Integration User',
      email: userEmail,
      phone: userPhone,
      password: password.slice(0, 7),
      termsAccepted: true
    });
    assert.equal(invalidRegistration.status, 400);

    const registration = await postJson(baseUrl, `${authPath}/register`, {
      fullName: 'Integration User',
      email: userEmail,
      phone: userPhone,
      password,
      termsAccepted: true,
      role: 'ADMIN'
    });
    assert.equal(registration.status, 201);
    const registered = (await registration.json()).user;
    assert.equal(registered.role, 'USER');
    assert.equal(Object.hasOwn(registered, 'password_hash'), false);

    const [storedUsers] = await pool.execute(
      `SELECT id, password_hash, role, failed_login_count, login_locked_until
       FROM users
       WHERE email = ?`,
      [userEmail]
    );
    assert.equal(storedUsers.length, 1);
    assert.equal(storedUsers[0].role, 'USER');
    assert.equal(await comparePassword(password, storedUsers[0].password_hash), true);

    const duplicateEmail = await postJson(baseUrl, `${authPath}/register`, {
      fullName: 'Duplicate Email',
      email: userEmail,
      phone: secondPhone,
      password,
      termsAccepted: true
    });
    assert.equal(duplicateEmail.status, 409);

    const secondRegistration = await postJson(baseUrl, `${authPath}/register`, {
      fullName: 'Second Integration User',
      email: secondEmail,
      phone: secondPhone,
      password,
      termsAccepted: true
    });
    assert.equal(secondRegistration.status, 201);

    const duplicatePhone = await postJson(baseUrl, `${authPath}/register`, {
      fullName: 'Duplicate Phone',
      email: `integration-${crypto.randomUUID()}@example.test`,
      phone: secondPhone,
      password,
      termsAccepted: true
    });
    assert.equal(duplicatePhone.status, 409);

    const login = await postJson(baseUrl, `${authPath}/login`, {
      email: userEmail,
      password
    });
    assert.equal(login.status, 200);
    const initialCookie = cookiePair(login.headers.get('set-cookie'));
    const initialToken = initialCookie.slice(initialCookie.indexOf('=') + 1);
    const setCookie = login.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    if (getSecureCookieSetting()) {
      assert.match(setCookie, /;\s*Secure/i);
    } else {
      assert.doesNotMatch(setCookie, /;\s*Secure(?:;|$)/i);
    }

    const [storedSessions] = await pool.execute(
      `SELECT token_hash, expires_at,
              TIMESTAMPDIFF(MICROSECOND, UTC_TIMESTAMP(3), expires_at) AS remaining_us
       FROM user_sessions
       WHERE user_id = ? AND revoked_at IS NULL
       ORDER BY id DESC
       LIMIT 1`,
      [registered.id]
    );
    assert.equal(storedSessions.length, 1);
    assert.equal(storedSessions[0].token_hash.length, 64);
    assert.equal(storedSessions[0].token_hash, hashToken(initialToken));
    assert.notEqual(storedSessions[0].token_hash, initialToken);
    assert.ok(
      storedSessions[0].remaining_us > 7.99 * 60 * 60 * 1_000_000
      && storedSessions[0].remaining_us <= 8 * 60 * 60 * 1_000_000
    );

    const me = await fetch(`${baseUrl}${authPath}/me?userId=${encodeURIComponent(secondEmail)}`, {
      headers: { cookie: initialCookie }
    });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.id, registered.id);

    const roleEscalation = await fetch(`${baseUrl}${profilePath}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: initialCookie },
      body: JSON.stringify({ role: 'ADMIN', accountStatus: 'ACTIVE' })
    });
    assert.equal(roleEscalation.status, 400);

    const duplicatePhoneUpdate = await fetch(`${baseUrl}${profilePath}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: initialCookie },
      body: JSON.stringify({ phone: secondPhone })
    });
    assert.equal(duplicatePhoneUpdate.status, 409);

    const profileUpdate = await fetch(`${baseUrl}${profilePath}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: initialCookie },
      body: JSON.stringify({
        fullName: 'Updated Integration User',
        phone: userPhone,
        gender: 'OTHER',
        skillLevel: 'INTERMEDIATE'
      })
    });
    assert.equal(profileUpdate.status, 200);
    const profile = (await profileUpdate.json()).user;
    assert.equal(profile.fullName, 'Updated Integration User');
    assert.equal(profile.gender, 'OTHER');
    assert.equal(profile.skillLevel, 'INTERMEDIATE');

    const incorrectCurrentPassword = await fetch(`${baseUrl}${passwordPath}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: initialCookie },
      body: JSON.stringify({ currentPassword: randomPassword(), newPassword })
    });
    assert.equal(incorrectCurrentPassword.status, 401);

    const changedPassword = await fetch(`${baseUrl}${passwordPath}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: initialCookie },
      body: JSON.stringify({ currentPassword: password, newPassword })
    });
    assert.equal(changedPassword.status, 204);
    const [changedUsers] = await pool.execute(
      'SELECT password_hash FROM users WHERE email = ?',
      [userEmail]
    );
    assert.equal(await comparePassword(newPassword, changedUsers[0].password_hash), true);
    assert.equal(await comparePassword(password, changedUsers[0].password_hash), false);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const failedLogin = await postJson(baseUrl, `${authPath}/login`, {
        email: userEmail,
        password: randomPassword()
      });
      assert.equal(failedLogin.status, 401, `Invalid password attempt ${attempt + 1}`);
    }

    const [lockedUsers] = await pool.execute(
      `SELECT failed_login_count, login_locked_until,
              TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(3), login_locked_until) AS lock_seconds
       FROM users
       WHERE email = ?`,
      [userEmail]
    );
    assert.equal(lockedUsers[0].failed_login_count, 5);
    assert.ok(lockedUsers[0].login_locked_until);
    assert.ok(lockedUsers[0].lock_seconds > 0 && lockedUsers[0].lock_seconds <= 900);
    const blockedLogin = await postJson(baseUrl, `${authPath}/login`, {
      email: userEmail,
      password: newPassword
    });
    assert.equal(blockedLogin.status, 423);

    await pool.execute(
      `UPDATE users
       SET account_status = 'ADMIN_LOCKED'
       WHERE email = ?`,
      [userEmail]
    );
    const adminLockedLogin = await postJson(baseUrl, `${authPath}/login`, {
      email: userEmail,
      password: newPassword
    });
    assert.equal(adminLockedLogin.status, 403);
    assert.deepEqual((await adminLockedLogin.json()).error, {
      code: 'ACCOUNT_LOCKED',
      message: 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên để được hỗ trợ.',
      details: {}
    });
    const lockedSessionRequest = await fetch(`${baseUrl}${authPath}/me`, {
      headers: { cookie: initialCookie }
    });
    assert.equal(lockedSessionRequest.status, 401);
    assert.deepEqual((await lockedSessionRequest.json()).error, {
      code: 'ACCOUNT_LOCKED',
      message: 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên để được hỗ trợ.',
      details: {}
    });
    const lockedBookingRequest = await postJson(
      baseUrl, '/api/v1/bookings', {}, initialCookie
    );
    assert.equal(lockedBookingRequest.status, 401);
    assert.equal((await lockedBookingRequest.json()).error.code, 'ACCOUNT_LOCKED');

    await pool.execute(
      `UPDATE users
       SET account_status = 'ACTIVE',
           failed_login_count = 0,
           login_locked_until = NULL
       WHERE email = ?`,
      [userEmail]
    );

    const logout = await postJson(baseUrl, `${authPath}/logout`, {}, initialCookie);
    assert.equal(logout.status, 204);
    const clearedCookie = logout.headers.get('set-cookie');
    assert.match(clearedCookie, /HttpOnly/i);
    assert.match(clearedCookie, /SameSite=Lax/i);
    const revokedSessionRequest = await fetch(`${baseUrl}${authPath}/me`, {
      headers: { cookie: initialCookie }
    });
    assert.equal(revokedSessionRequest.status, 401);

    const secondLogin = await postJson(baseUrl, `${authPath}/login`, {
      email: userEmail,
      password: newPassword
    });
    assert.equal(secondLogin.status, 200);
    const expiringCookie = cookiePair(secondLogin.headers.get('set-cookie'));
    const expiringToken = expiringCookie.slice(expiringCookie.indexOf('=') + 1);
    await pool.execute(
      `UPDATE user_sessions
       SET expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND)
       WHERE token_hash = ?`,
      [hashToken(expiringToken)]
    );
    const expiredSessionRequest = await fetch(`${baseUrl}${authPath}/me`, {
      headers: { cookie: expiringCookie }
    });
    assert.equal(expiredSessionRequest.status, 401);
  } finally {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
    if (databaseVerified) {
      await pool.execute(
        'DELETE FROM users WHERE email IN (?, ?)',
        [userEmail, secondEmail]
      );
    }
    await closePool();
  }
});
