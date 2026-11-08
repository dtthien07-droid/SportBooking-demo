'use strict';

const bcrypt = require('bcrypt');

const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const DEFAULT_BCRYPT_ROUNDS = 12;

function getBcryptRounds(env = process.env) {
  const rawRounds = env.BCRYPT_ROUNDS;
  const rounds = rawRounds === undefined || rawRounds === ''
    ? DEFAULT_BCRYPT_ROUNDS
    : Number(rawRounds);

  if (!Number.isInteger(rounds) || rounds < 4 || rounds > 15) {
    throw new Error('BCRYPT_ROUNDS must be an integer between 4 and 15.');
  }

  return rounds;
}

function isBcryptHash(hash) {
  return typeof hash === 'string' && BCRYPT_HASH_PATTERN.test(hash);
}

function assertBcryptHash(hash, env = process.env) {
  if (!isBcryptHash(hash)) {
    throw new Error('A valid bcrypt password hash is required.');
  }

  if (bcrypt.getRounds(hash) !== getBcryptRounds(env)) {
    throw new Error('The bcrypt hash rounds do not match BCRYPT_ROUNDS.');
  }
}

async function hashPassword(password, env = process.env) {
  if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72) {
    throw new TypeError('Password must be a string of at most 72 UTF-8 bytes.');
  }

  return bcrypt.hash(password, getBcryptRounds(env));
}

async function comparePassword(password, passwordHash) {
  if (typeof password !== 'string' || Buffer.byteLength(password, 'utf8') > 72) {
    return false;
  }

  if (!isBcryptHash(passwordHash)) {
    throw new Error('The stored password hash is not a valid bcrypt hash.');
  }

  return bcrypt.compare(password, passwordHash);
}

module.exports = {
  assertBcryptHash,
  comparePassword,
  getBcryptRounds,
  hashPassword,
  isBcryptHash
};
