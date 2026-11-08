'use strict';

const crypto = require('node:crypto');

const SESSION_DURATION_MS = 8 * 60 * 60 * 1000;

function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

function createSessionService({ sessionRepository, now = () => Date.now() }) {
  if (!sessionRepository || typeof sessionRepository.createSession !== 'function') {
    throw new TypeError('A compatible session repository is required.');
  }

  async function startSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(now() + SESSION_DURATION_MS);
    await sessionRepository.createSession({
      userId,
      tokenHash: hashToken(token),
      expiresAt
    });
    return { expiresAt, token };
  }

  return { startSession };
}

module.exports = { createSessionService, hashToken, SESSION_DURATION_MS };
