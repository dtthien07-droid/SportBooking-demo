'use strict';

const DEFAULT_COOKIE_NAME = 'sportbooking_session';

function getCookieName(env = process.env) {
  const name = env.SESSION_COOKIE_NAME || DEFAULT_COOKIE_NAME;
  if (!/^[A-Za-z0-9_-]+$/.test(name)) {
    throw new Error('SESSION_COOKIE_NAME contains unsupported characters.');
  }
  return name;
}

function getSecureCookieSetting(env = process.env) {
  const value = env.COOKIE_SECURE;
  if (value !== undefined && value !== 'true' && value !== 'false') {
    throw new Error('COOKIE_SECURE must be true or false.');
  }
  return value === 'true';
}

function cookieOptions({ secure = false } = {}) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/'
  };
}

function readCookie(request, name) {
  const header = request.headers.cookie;
  if (!header) {
    return null;
  }

  let value = null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim() !== name) {
      continue;
    }
    if (value !== null) {
      return null;
    }
    try {
      value = decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }

  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

module.exports = { cookieOptions, getCookieName, getSecureCookieSetting, readCookie };
