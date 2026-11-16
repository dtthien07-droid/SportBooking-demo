'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const testEnvironment = {
  ...process.env,
  APP_ENV: 'test',
  DB_NAME: process.env.DB_NAME ?? 'sportbooking_test',
  DB_HOST: process.env.DB_HOST ?? '127.0.0.1',
  DB_PORT: process.env.DB_PORT ?? '3306',
  DB_SSL: process.env.DB_SSL ?? 'false',
  DB_USER: process.env.DB_USER ?? 'root',
  DB_PASSWORD: process.env.DB_PASSWORD ?? '',
  BOOKING_DATA_START_AT: process.env.BOOKING_DATA_START_AT ?? '2026-11-15T17:00:00.000Z'
};

if (testEnvironment.DB_NAME !== 'sportbooking_test') {
  console.error(
    'Refusing to run tests: DB_NAME must be exactly sportbooking_test. '
    + 'Tests only run against sportbooking_test.'
  );
  process.exit(1);
}

const testPaths = process.argv.includes('--frontend')
  ? [path.join('..', 'frontend', 'tests', '*.test.js')]
  : [];
const result = spawnSync(
  process.execPath,
  ['--test', '--test-concurrency=1', ...testPaths],
  {
    cwd: __dirname,
    env: testEnvironment,
    stdio: 'inherit'
  }
);

if (result.error) {
  console.error(`Failed to start the Node.js test runner: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
