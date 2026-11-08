'use strict';

const MAX_PASSWORD_BYTES = 72;
const GENDERS = new Set(['MALE', 'FEMALE', 'OTHER']);
const SKILL_LEVELS = new Set(['BEGINNER', 'INTERMEDIATE', 'GOOD']);
const PROFILE_FIELDS = new Set(['fullName', 'phone', 'gender', 'skillLevel']);

function createProfileError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function badRequest(message) {
  return createProfileError(400, 'VALIDATION_ERROR', message);
}

function normalizePhone(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const phone = value.trim().replace(/[\s().-]/g, '');
  return /^\+?\d{8,15}$/.test(phone) ? phone : null;
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

function createProfileService({ userRepository, passwords }) {
  if (!userRepository
      || typeof userRepository.findById !== 'function'
      || typeof userRepository.updateProfile !== 'function'
      || typeof userRepository.updatePassword !== 'function') {
    throw new TypeError('A compatible user repository is required.');
  }

  if (!passwords
      || typeof passwords.hashPassword !== 'function'
      || typeof passwords.comparePassword !== 'function') {
    throw new TypeError('A compatible password helper is required.');
  }

  async function getProfile(userId) {
    const user = await userRepository.findById(userId);
    if (!user) {
      throw createProfileError(404, 'USER_NOT_FOUND', 'User was not found.');
    }
    return toPublicUser(user);
  }

  async function updateProfile(userId, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw badRequest('Profile data is required.');
    }

    const keys = Object.keys(input);
    if (keys.length === 0 || keys.some((key) => !PROFILE_FIELDS.has(key))) {
      throw badRequest('Only profile fields may be updated.');
    }

    const updates = {};
    if (Object.hasOwn(input, 'fullName')) {
      const fullName = typeof input.fullName === 'string' ? input.fullName.trim() : '';
      if (!fullName || fullName.length > 120) {
        throw badRequest('Full name is required and must be at most 120 characters.');
      }
      updates.fullName = fullName;
    }

    if (Object.hasOwn(input, 'phone')) {
      const phone = normalizePhone(input.phone);
      if (!phone) {
        throw badRequest('A valid phone number is required.');
      }
      updates.phone = phone;
    }

    if (Object.hasOwn(input, 'gender')) {
      if (input.gender !== null && !GENDERS.has(input.gender)) {
        throw badRequest('Gender is invalid.');
      }
      updates.gender = input.gender;
    }

    if (Object.hasOwn(input, 'skillLevel')) {
      if (input.skillLevel !== null && !SKILL_LEVELS.has(input.skillLevel)) {
        throw badRequest('Skill level is invalid.');
      }
      updates.skillLevel = input.skillLevel;
    }

    try {
      await userRepository.updateProfile(userId, updates);
    } catch (error) {
      if (isDuplicateEntry(error)) {
        throw createProfileError(409, 'ACCOUNT_CONFLICT', 'Phone number is already registered.');
      }
      throw error;
    }

    return getProfile(userId);
  }

  async function changePassword(userId, input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)
        || Object.keys(input).some((key) => key !== 'currentPassword' && key !== 'newPassword')
        || typeof input.currentPassword !== 'string'
        || typeof input.newPassword !== 'string') {
      throw badRequest('Current and new passwords are required.');
    }

    const newPassword = input.newPassword;
    if (newPassword.length < 8 || Buffer.byteLength(newPassword, 'utf8') > MAX_PASSWORD_BYTES) {
      throw badRequest('New password must be at least 8 characters and at most 72 UTF-8 bytes.');
    }

    const user = await userRepository.findById(userId);
    if (!user) {
      throw createProfileError(404, 'USER_NOT_FOUND', 'User was not found.');
    }

    if (!await passwords.comparePassword(input.currentPassword, user.password_hash)) {
      throw createProfileError(401, 'INVALID_CREDENTIALS', 'Current password is incorrect.');
    }

    const passwordHash = await passwords.hashPassword(newPassword);
    const updated = await userRepository.updatePassword(userId, passwordHash);
    if (!updated) {
      throw createProfileError(404, 'USER_NOT_FOUND', 'User was not found.');
    }
  }

  return { changePassword, getProfile, updateProfile };
}

module.exports = { createProfileService };
