'use strict';

const { spawnSync } = require('node:child_process');

const testEnvironment = {
  ...process.env,
  APP_ENV: 'test',
  DB_NAME: 'sportbooking_test'
};

if (testEnvironment.APP_ENV !== 'test'
    || !testEnvironment.DB_NAME.endsWith('_test')
    || testEnvironment.DB_NAME === 'sportbooking_dev'
    || testEnvironment.DB_NAME.toLowerCase() === 'sportbooking_system') {
  console.error('Refusing to run tests outside a dedicated test database.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test'], {
  env: testEnvironment,
  stdio: 'inherit'
});

if (result.error) {
  console.error(`Failed to start the Node.js test runner: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
