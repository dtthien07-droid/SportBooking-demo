'use strict';

const passwordHelper = require('./password.helper');

const TERMS_TEXT = 'Tôi đồng ý sử dụng SportBooking đúng mục đích đặt sân, cung cấp thông tin chính xác, và tuân thủ nội quy, chính sách hủy của từng cơ sở.';
const MAX_PASSWORD_BYTES = 72;

function createAuthError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function badRequest(message) {
  return createAuthError(400, 'VALIDATION_ERROR', message);
}

function normalizeEmail(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return null;
  }

  return email;
}

function normalizePhone(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const phone = value.trim().replace(/[\s().-]/g, '');
  if (!/^\+?\d{8,15}$/.test(phone)) {
    return null;
  }

  return phone;
}

function toEpochMilliseconds(value) {
  if (value instanceof Date) {
    const time = value.getTime();
    if (!Number.isFinite(time)) {
      throw new Error('The stored login lock timestamp is invalid.');
    }
    return time;
  }

  const time = Date.parse(value);
  if (!Number.isFinite(time)) {
    throw new Error('The stored login lock timestamp is invalid.');
  }
  return time;
}

function toPublicUser(user) {
  return {
    id: user.id,
    fullName: user.full_name,
    email: user.email,
    phone: user.phone,
    gender: user.gender,
    skillLevel: user.skill_level,
    role: user.role
  };
}

function isDuplicateEntry(error) {
  return error && error.code === 'ER_DUP_ENTRY';
}

function createAuthService({
  userRepository,
  passwords = passwordHelper,
  now = () => Date.now()
}) {
  if (!userRepository
      || typeof userRepository.findByEmail !== 'function'
      || typeof userRepository.findByPhone !== 'function'
      || typeof userRepository.createUser !== 'function'
      || typeof userRepository.recordFailedLogin !== 'function'
      || typeof userRepository.resetFailedLogins !== 'function') {
    throw new TypeError('A compatible user repository is required.');
  }

  if (!passwords
      || typeof passwords.hashPassword !== 'function'
      || typeof passwords.comparePassword !== 'function') {
    throw new TypeError('A compatible password helper is required.');
  }

  async function register(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw badRequest('Registration data is required.');
    }

    const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : '';
    const email = normalizeEmail(input.email);
    const phone = normalizePhone(input.phone);
    const password = input.password;

    if (!fullName || fullName.length > 120) {
      throw badRequest('Full name is required and must be at most 120 characters.');
    }
    if (!email) {
      throw badRequest('A valid email is required.');
    }
    if (!phone) {
      throw badRequest('A valid phone number is required.');
    }
    if (typeof password !== 'string'
        || password.length < 8
        || Buffer.byteLength(password, 'utf8') > MAX_PASSWORD_BYTES) {
      throw badRequest('Password must be at least 8 characters and at most 72 UTF-8 bytes.');
    }
    if (input.termsAccepted !== true) {
      throw badRequest('Registration terms must be accepted.');
    }

    if (await userRepository.findByEmail(email) || await userRepository.findByPhone(phone)) {
      throw createAuthError(409, 'ACCOUNT_CONFLICT', 'Email or phone number is already registered.');
    }

    const passwordHash = await passwords.hashPassword(password);
    let id;
    try {
      id = await userRepository.createUser({
        fullName,
        email,
        passwordHash,
        phone,
        termsAcceptedAt: new Date(now())
      });
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw createAuthError(409, 'ACCOUNT_CONFLICT', 'Email or phone number is already registered.');
      }
      throw error;
    }

    return {
      id,
      fullName,
      email,
      phone,
      gender: null,
      skillLevel: null,
      role: 'USER'
    };
  }

  async function login(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw badRequest('Login data is required.');
    }

    const email = normalizeEmail(input.email);
    if (!email || typeof input.password !== 'string' || input.password.length === 0) {
      throw badRequest('A valid email and password are required.');
    }

    const user = await userRepository.findByEmail(email);
    if (!user) {
      throw createAuthError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }
    if (user.account_status === 'ADMIN_LOCKED') {
      throw createAuthError(403, 'ACCOUNT_LOCKED', 'This account has been locked by an administrator.');
    }

    if (user.login_locked_until !== null && user.login_locked_until !== undefined) {
      const lockedUntil = toEpochMilliseconds(user.login_locked_until);
      if (lockedUntil > now()) {
        throw createAuthError(423, 'LOGIN_TEMPORARILY_LOCKED', 'Login is temporarily locked.');
      }
      await userRepository.resetFailedLogins(email);
    }

    const passwordMatches = await passwords.comparePassword(input.password, user.password_hash);
    if (!passwordMatches) {
      await userRepository.recordFailedLogin(email);
      throw createAuthError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
    }

    await userRepository.resetFailedLogins(email);
    return toPublicUser(user);
  }

  return { login, register };
}

module.exports = {
  TERMS_TEXT,
  createAuthService
};
