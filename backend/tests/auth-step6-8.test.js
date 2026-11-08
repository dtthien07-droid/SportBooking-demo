'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const { createApp } = require('../src/app');

function randomPassword() {
  return crypto.randomBytes(24).toString('base64url');
}

function createMemoryPool() {
  const state = { users: [], sessions: [], queries: [] };
  let nextUserId = 1;
  let nextSessionId = 1;

  const pool = {
    state,
    async execute(sql, params) {
      state.queries.push({ sql, params });
      const statement = sql.replace(/\s+/g, ' ').trim();

      if (statement.includes('FROM users WHERE email = ?')) {
        return [state.users.filter((user) => user.email === params[0]).map((user) => ({ ...user }))];
      }
      if (statement.includes('FROM users WHERE phone = ?')) {
        return [state.users.filter((user) => user.phone === params[0]).map((user) => ({ id: user.id }))];
      }
      if (statement.includes('FROM users WHERE id = ?')) {
        const user = state.users.find((item) => item.id === params[0]);
        return [user ? [{ ...user }] : []];
      }
      if (statement.startsWith('INSERT INTO users')) {
        const [fullName, email, passwordHash, phone, termsAcceptedAt] = params;
        const user = {
          id: nextUserId++,
          full_name: fullName,
          email,
          password_hash: passwordHash,
          phone,
          gender: null,
          skill_level: null,
          role: 'USER',
          account_status: 'ACTIVE',
          failed_login_count: 0,
          login_locked_until: null,
          terms_accepted_at: termsAcceptedAt
        };
        state.users.push(user);
        return [{ insertId: user.id, affectedRows: 1 }];
      }
      if (statement.startsWith('UPDATE users SET failed_login_count = 0')) {
        const user = state.users.find((item) => item.email === params[0]);
        if (user) {
          user.failed_login_count = 0;
          user.login_locked_until = null;
        }
        return [{ affectedRows: user ? 1 : 0 }];
      }
      if (statement.startsWith('UPDATE users SET full_name = IF')) {
        const [hasName, fullName, hasPhone, phone, hasGender, gender, hasSkill, skillLevel, id] = params;
        const user = state.users.find((item) => item.id === id);
        let changed = false;
        if (user) {
          if (hasName && user.full_name !== fullName) {
            user.full_name = fullName;
            changed = true;
          }
          if (hasPhone && user.phone !== phone) {
            user.phone = phone;
            changed = true;
          }
          if (hasGender && user.gender !== gender) {
            user.gender = gender;
            changed = true;
          }
          if (hasSkill && user.skill_level !== skillLevel) {
            user.skill_level = skillLevel;
            changed = true;
          }
        }
        return [{ affectedRows: changed ? 1 : 0 }];
      }
      if (statement.startsWith('UPDATE users SET password_hash = ?')) {
        const [passwordHash, id] = params;
        const user = state.users.find((item) => item.id === id);
        if (user) user.password_hash = passwordHash;
        return [{ affectedRows: user ? 1 : 0 }];
      }
      if (statement.startsWith('INSERT INTO user_sessions')) {
        const [userId, tokenHash, expiresAt] = params;
        state.sessions.push({
          id: nextSessionId++,
          user_id: userId,
          token_hash: tokenHash,
          expires_at: expiresAt,
          revoked_at: null
        });
        return [{ insertId: nextSessionId - 1, affectedRows: 1 }];
      }
      if (statement.includes('FROM user_sessions AS s')) {
        const session = state.sessions.find((item) =>
          item.token_hash === params[0]
          && item.revoked_at === null
          && item.expires_at.getTime() > Date.now()
        );
        const user = session && state.users.find((item) => item.id === session.user_id);
        return [session && user ? [{
          session_id: session.id,
          user_id: user.id,
          expires_at: session.expires_at,
          revoked_at: session.revoked_at,
          full_name: user.full_name,
          email: user.email,
          phone: user.phone,
          gender: user.gender,
          skill_level: user.skill_level,
          role: user.role,
          account_status: user.account_status
        }] : []];
      }
      if (statement.startsWith('UPDATE user_sessions')) {
        const session = state.sessions.find((item) =>
          item.token_hash === params[0] && item.revoked_at === null
        );
        if (session) session.revoked_at = new Date();
        return [{ affectedRows: session ? 1 : 0 }];
      }
      throw new Error('Unexpected SQL statement in test pool.');
    }
  };

  return pool;
}

async function withServer(app, run) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const address = server.address();
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test('auth routes, eight-hour hashed sessions, profile changes, password changes, and health', async () => {
  const pool = createMemoryPool();
  const app = createApp({
    pool,
    env: { SESSION_COOKIE_NAME: 'sportbooking_session', COOKIE_SECURE: 'true' }
  });
  const password = randomPassword();
  const newPassword = randomPassword();

  await withServer(app, async (baseUrl) => {
    const health = await fetch(`${baseUrl}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ok' });

    const registration = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Test User',
        email: 'user@example.test',
        phone: '+84901234567',
        password,
        termsAccepted: true,
        role: 'ADMIN'
      })
    });
    assert.equal(registration.status, 201);
    const registeredBody = await registration.json();
    assert.equal(registeredBody.user.role, 'USER');
    assert.equal(Object.hasOwn(registeredBody.user, 'password_hash'), false);

    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'user@example.test', password })
    });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get('set-cookie');
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    assert.match(setCookie, /;\s*Secure/i);
    assert.match(setCookie, /Max-Age=28800/i);
    const cookie = setCookie.split(';', 1)[0];
    const rawToken = cookie.slice(cookie.indexOf('=') + 1);
    assert.equal(pool.state.sessions.length, 1);
    assert.equal(pool.state.sessions[0].token_hash.length, 64);
    assert.notEqual(pool.state.sessions[0].token_hash, rawToken);
    assert.ok(
      Math.abs(pool.state.sessions[0].expires_at.getTime() - Date.now() - 8 * 60 * 60 * 1000) < 1000
    );

    const me = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { cookie }
    });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.id, registeredBody.user.id);

    const forbiddenProfileChange = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ role: 'ADMIN' })
    });
    assert.equal(forbiddenProfileChange.status, 400);

    const profileChange = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ fullName: ' Updated User ', gender: 'OTHER' })
    });
    assert.equal(profileChange.status, 200);
    const profile = await profileChange.json();
    assert.equal(profile.user.fullName, 'Updated User');
    assert.equal(profile.user.gender, 'OTHER');

    const unchangedProfile = await fetch(`${baseUrl}/api/v1/users/me`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ fullName: 'Updated User' })
    });
    assert.equal(unchangedProfile.status, 200);

    const attemptedPasswordPrivilegeChange = await fetch(`${baseUrl}/api/v1/users/me/password`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ currentPassword: password, newPassword, role: 'ADMIN' })
    });
    assert.equal(attemptedPasswordPrivilegeChange.status, 400);

    const wrongPassword = await fetch(`${baseUrl}/api/v1/users/me/password`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ currentPassword: randomPassword(), newPassword })
    });
    assert.equal(wrongPassword.status, 401);

    const passwordChange = await fetch(`${baseUrl}/api/v1/users/me/password`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ currentPassword: password, newPassword })
    });
    assert.equal(passwordChange.status, 204);

    const logout = await fetch(`${baseUrl}/api/v1/auth/logout`, {
      method: 'POST',
      headers: { cookie }
    });
    assert.equal(logout.status, 204);
    const clearedCookie = logout.headers.get('set-cookie');
    assert.match(clearedCookie, /HttpOnly/i);
    assert.match(clearedCookie, /SameSite=Lax/i);
    assert.match(clearedCookie, /Expires=Thu, 01 Jan 1970/i);

    const revokedSession = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { cookie }
    });
    assert.equal(revokedSession.status, 401);

    for (const query of pool.state.queries) {
      assert.ok(Array.isArray(query.params));
      assert.ok(query.sql.includes('?'));
    }
  });
});
