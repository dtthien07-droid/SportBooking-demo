'use strict';

const path = require('node:path');
const dotenv = require('../../backend/node_modules/dotenv');

const DATABASE_ENVIRONMENTS = new Map([
  ['sportbooking_dev', 'development'],
  ['sportbooking_test', 'test']
]);

function assertAllowedDatabase(databaseName) {
  if (!DATABASE_ENVIRONMENTS.has(databaseName)) {
    throw new Error('Database target must be sportbooking_dev or sportbooking_test.');
  }
}

function getAllowedPool(databaseName) {
  assertAllowedDatabase(databaseName);
  dotenv.config({ path: path.resolve(__dirname, '..', '..', 'backend', '.env') });
  process.env.APP_ENV = DATABASE_ENVIRONMENTS.get(databaseName);
  process.env.DB_NAME = databaseName;
  const { getPool } = require('../../backend/src/config/database');
  return getPool();
}

function readDatabaseTarget(args = process.argv.slice(2)) {
  const index = args.findIndex((argument) => argument === '--database');
  const target = index >= 0
    ? args[index + 1]
    : args.find((argument) => argument.startsWith('--database='))?.slice('--database='.length);

  assertAllowedDatabase(target);
  return target;
}

module.exports = {
  assertAllowedDatabase,
  getAllowedPool,
  readDatabaseTarget
};
