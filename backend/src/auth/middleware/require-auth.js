'use strict';

const { hashToken } = require('../session.service');
const { readCookie } = require('../session.cookie');

function createAuthError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function createRequireAuth({ sessionRepository, cookieName, secureCookie = false }) {
  if (!sessionRepository || typeof sessionRepository.findActiveByTokenHash !== 'function') {
    throw new TypeError('A compatible session repository is required.');
  }

  return async function requireAuth(request, response, next) {
    const token = readCookie(request, cookieName);
    if (!token) {
      return next(createAuthError(401, 'UNAUTHENTICATED', 'Authentication is required.'));
    }

    const tokenHash = hashToken(token);
    const session = await sessionRepository.findActiveByTokenHash(tokenHash);
    if (!session) {
      return next(createAuthError(401, 'UNAUTHENTICATED', 'Authentication is required.'));
    }
    if (session.account_status !== 'ACTIVE') {
      return next(createAuthError(403, 'ACCOUNT_LOCKED', 'This account has been locked.'));
    }

    request.auth = {
      sessionId: session.session_id,
      tokenHash,
      user: {
        id: session.user_id,
        fullName: session.full_name,
        email: session.email,
        phone: session.phone,
        gender: session.gender,
        skillLevel: session.skill_level,
        role: session.role
      }
    };
    response.locals.sessionCookieSecure = secureCookie || request.secure === true;
    return next();
  };
}

module.exports = createRequireAuth;
