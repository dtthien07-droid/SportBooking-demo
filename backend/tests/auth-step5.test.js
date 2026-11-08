'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');
const {
  comparePassword,
  getBcryptRounds,
  hashPassword
} = require('../src/auth/password.helper');
const { createAuthService } = require('../src/auth/auth.service');
const createUserRepository = require('../src/auth/repositories/user.repository');
const { seedAdmin } = require('../../infra/database/seed-admin');

function randomPassword() {
  return crypto.randomBytes(24).toString('base64url');
}

function makeUser(overrides = {}) {
  return {
    id: 1,
    full_name: 'Test User',
    email: 'user@example.test',
    password_hash: 'test-hash',
    phone: '+84901234567',
    gender: null,
    skill_level: null,
    role: 'USER',
    account_status: 'ACTIVE',
    failed_login_count: 0,
    login_locked_until: null,
    ...overrides
  };
}

function makeRepository(initialUser = makeUser(), now = () => Date.now()) {
  const state = {
    user: initialUser,
    created: [],
    failedLoginCalls: 0,
    resetCalls: 0
  };

  return {
    state,
    async findByEmail(email) {
      return state.user && state.user.email === email ? { ...state.user } : null;
    },
    async findByPhone(phone) {
      return state.user && state.user.phone === phone ? { id: state.user.id } : null;
    },
    async createUser(user) {
      state.created.push(user);
      return 2;
    },
    async recordFailedLogin() {
      state.failedLoginCalls += 1;
      if (state.user.login_locked_until && new Date(state.user.login_locked_until).getTime() <= now()) {
        state.user.failed_login_count = 1;
        state.user.login_locked_until = null;
      } else {
        state.user.failed_login_count = Math.min(state.user.failed_login_count + 1, 5);
        if (state.user.failed_login_count >= 5) {
          state.user.login_locked_until = new Date(now() + 15 * 60 * 1000);
        }
      }
      return 1;
    },
    async resetFailedLogins() {
      state.resetCalls += 1;
      state.user.failed_login_count = 0;
      state.user.login_locked_until = null;
      return 1;
    }
  };
}

function fakePasswords(correctPassword) {
  return {
    async hashPassword(password) {
      return `fake-hash:${password.length}`;
    },
    async comparePassword(password) {
      return password === correctPassword;
    }
  };
}

test('bcrypt helper hashes and verifies using the configured default rounds', async () => {
  const password = randomPassword();
  const hash = await hashPassword(password, {});

  assert.equal(getBcryptRounds({}), 12);
  assert.equal(await comparePassword(password, hash), true);
  assert.equal(await comparePassword(randomPassword(), hash), false);
});

test('registration stores a bcrypt hash and returns only a public user', async () => {
  const password = randomPassword();
  const repository = makeRepository(null);
  const service = createAuthService({
    userRepository: repository,
    passwords: fakePasswords(password),
    now: () => 1_800_000_000_000
  });

  const user = await service.register({
    fullName: '  Test User  ',
    email: ' USER@example.test ',
    phone: '+84 90 1234 567',
    password,
    termsAccepted: true,
    role: 'ADMIN'
  });

  assert.equal(user.id, 2);
  assert.equal(user.email, 'user@example.test');
  assert.equal(user.phone, '+84901234567');
  assert.equal(user.role, 'USER');
  assert.equal(Object.hasOwn(user, 'password_hash'), false);
  assert.equal(repository.state.created[0].passwordHash, `fake-hash:${password.length}`);
  assert.notEqual(repository.state.created[0].passwordHash, password);
});

test('registration rejects invalid input, duplicate records, and concurrent duplicate inserts', async () => {
  const password = randomPassword();
  const repository = makeRepository(null);
  const service = createAuthService({
    userRepository: repository,
    passwords: fakePasswords(password)
  });

  await assert.rejects(
    service.register({
      fullName: 'Test User',
      email: 'user@example.test',
      phone: '+84901234567',
      password: randomPassword().slice(0, 7),
      termsAccepted: true
    }),
    { status: 400 }
  );
  await assert.rejects(
    service.register({
      fullName: 'Test User',
      email: 'user@example.test',
      phone: '+84901234567',
      password,
      termsAccepted: false
    }),
    { status: 400 }
  );

  repository.state.user = makeUser();
  await assert.rejects(
    service.register({
      fullName: 'Test User',
      email: 'USER@example.test',
      phone: '+84901234567',
      password,
      termsAccepted: true
    }),
    { status: 409 }
  );

  repository.state.user = null;
  repository.createUser = async () => {
    const error = new Error('duplicate');
    error.code = 'ER_DUP_ENTRY';
    throw error;
  };
  await assert.rejects(
    service.register({
      fullName: 'Test User',
      email: 'user@example.test',
      phone: '+84901234567',
      password,
      termsAccepted: true
    }),
    { status: 409 }
  );
});

test('five consecutive failed attempts trigger a 15-minute lock and expiry resets the counter', async () => {
  let now = 1_800_000_000_000;
  const correctPassword = randomPassword();
  const repository = makeRepository(makeUser(), () => now);
  const service = createAuthService({
    userRepository: repository,
    passwords: fakePasswords(correctPassword),
    now: () => now
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await assert.rejects(
      service.login({ email: 'user@example.test', password: randomPassword() }),
      { status: 401, code: 'INVALID_CREDENTIALS' }
    );
  }

  assert.equal(repository.state.user.failed_login_count, 5);
  assert.equal(
    new Date(repository.state.user.login_locked_until).getTime(),
    now + 15 * 60 * 1000
  );
  await assert.rejects(
    service.login({ email: 'user@example.test', password: correctPassword }),
    { status: 423 }
  );

  now += 15 * 60 * 1000;
  await assert.rejects(
    service.login({ email: 'user@example.test', password: randomPassword() }),
    { status: 401 }
  );
  assert.equal(repository.state.user.failed_login_count, 1);
  assert.equal(repository.state.user.login_locked_until, null);
});

test('successful login resets failed attempts and admin lock remains separate', async () => {
  const correctPassword = randomPassword();
  const repository = makeRepository(makeUser({
    failed_login_count: 3,
    login_locked_until: null
  }));
  const service = createAuthService({
    userRepository: repository,
    passwords: fakePasswords(correctPassword)
  });

  const user = await service.login({ email: 'user@example.test', password: correctPassword });
  assert.equal(user.role, 'USER');
  assert.equal(Object.hasOwn(user, 'password_hash'), false);
  assert.equal(repository.state.user.failed_login_count, 0);

  repository.state.user.account_status = 'ADMIN_LOCKED';
  await assert.rejects(
    service.login({ email: 'user@example.test', password: randomPassword() }),
    { status: 403, code: 'ACCOUNT_LOCKED' }
  );
  assert.equal(repository.state.failedLoginCalls, 0);
});

test('user repository parameterizes all values and applies atomic 5-attempt, 15-minute lockout', async () => {
  const calls = [];
  const pool = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return [{ affectedRows: 1, insertId: 7 }];
    }
  };
  const repository = createUserRepository(pool);

  await repository.findByEmail('user@example.test');
  await repository.findByPhone('+84901234567');
  await repository.recordFailedLogin('user@example.test');
  await repository.resetFailedLogins('user@example.test');

  assert.equal(calls.length, 4);
  for (const call of calls) {
    assert.ok(call.sql.includes('?'));
    assert.ok(Array.isArray(call.params));
  }
  assert.match(calls[2].sql, /DATE_ADD\(UTC_TIMESTAMP\(3\), INTERVAL \? MINUTE\)/);
  assert.deepEqual(calls[2].params, [5, 5, 15, 'user@example.test']);
  assert.match(calls[2].sql, /failed_login_count >= \?/);
});

test('admin seed uses only the supplied bcrypt hash, parameters, and does not overwrite existing admin', async () => {
  const password = randomPassword();
  const passwordHash = await hashPassword(password);
  const calls = [];
  const existingAdminPool = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return [[{ id: 1 }]];
    }
  };

  assert.equal(await seedAdmin(existingAdminPool, passwordHash), false);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].params, ['admin@sportbooking.com']);
  assert.ok(calls[0].sql.includes('WHERE email = ?'));

  calls.length = 0;
  const emptyPool = {
    async execute(sql, params) {
      calls.push({ sql, params });
      return calls.length === 1 ? [[]] : [{ affectedRows: 1 }];
    }
  };

  assert.equal(await seedAdmin(emptyPool, passwordHash), true);
  assert.equal(calls.length, 2);
  assert.ok(calls[1].sql.includes('VALUES (?, ?, ?,'));
  assert.deepEqual(calls[1].params, ['SportBooking Admin', 'admin@sportbooking.com', passwordHash]);
  assert.equal(calls[1].params.includes(password), false);
});
