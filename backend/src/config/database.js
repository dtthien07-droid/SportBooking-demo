
'use strict';

const path = require('node:path');
const dotenv = require('dotenv');
const mysql = require('mysql2/promise');

dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env') });

let pool;

function validateDatabaseConfig(env = process.env) {
  const appEnv = env.APP_ENV;
  const databaseName = env.DB_NAME;
  const databaseUser = env.DB_USER;

  if (!['development', 'test', 'production'].includes(appEnv)) {
    throw new Error('APP_ENV must be development, test or production.');
  }

  if (!databaseName || !/^[A-Za-z0-9_]+$/.test(databaseName)) {
    throw new Error('DB_NAME must be a valid database identifier.');
  }

  if (databaseName.toLowerCase() === 'sportbooking_system') {
    throw new Error('Connections to sportbooking_system are disabled.');
  }

  if (appEnv === 'test' && !databaseName.endsWith('_test')) {
    throw new Error('Test connections require a DB_NAME ending in _test.');
  }

  if (
    !env.DB_HOST ||
    !databaseUser ||
    !Object.hasOwn(env, 'DB_PASSWORD')
  ) {
    throw new Error('DB_HOST, DB_USER, and DB_PASSWORD must be configured.');
  }

  const port = Number(env.DB_PORT);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('DB_PORT must be a valid TCP port.');
  }

  if (env.DB_SSL !== 'true') {
    throw new Error('TiDB Cloud connections require DB_SSL=true.');
  }

  return {
    host: env.DB_HOST,
    port,
    database: databaseName,
    user: databaseUser,
    password: env.DB_PASSWORD,
    charset: 'utf8mb4',
    timezone: 'Z',
    connectionLimit: 10,
    waitForConnections: true,
    queueLimit: 0,
    ssl: {
      minVersion: 'TLSv1.2'
    }
  };
}

function getPool() {
  if (!pool) {
    pool = mysql.createPool(validateDatabaseConfig());
  }

  return pool;
}

async function closePool() {
  if (pool) {
    const activePool = pool;
    pool = undefined;
    await activePool.end();
  }
}

module.exports = {
  closePool,
  getPool,
  validateDatabaseConfig
};
