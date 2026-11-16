'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');
const {
  loadSurvey,
  normalizePhone,
  parseMapUrl,
  parseOpeningHours,
  parsePrice,
  parseRating
} = require('../../infra/database/seed-facilities');
const { assertAllowedDatabase } = require('../../infra/database/facilities-db');
const { validateDatabaseConfig } = require('../src/config/database');

test('test database configuration supports local MariaDB without TLS', () => {
  const config = validateDatabaseConfig({
    APP_ENV: 'test',
    DB_NAME: 'sportbooking_test',
    DB_HOST: '127.0.0.1',
    DB_PORT: '3306',
    DB_USER: 'root',
    DB_PASSWORD: '',
    DB_SSL: 'false'
  });

  assert.equal(config.ssl, false);
  assert.throws(
    () => validateDatabaseConfig({
      APP_ENV: 'production',
      DB_NAME: 'sportbooking',
      DB_HOST: '127.0.0.1',
      DB_PORT: '3306',
      DB_USER: 'root',
      DB_PASSWORD: '',
      DB_SSL: 'false'
    }),
    /TiDB Cloud connections require DB_SSL=true/
  );
});

test('facility seed accepts only the two approved database names', () => {
  assert.doesNotThrow(() => assertAllowedDatabase('sportbooking_dev'));
  assert.doesNotThrow(() => assertAllowedDatabase('sportbooking_test'));
  assert.throws(
    () => assertAllowedDatabase('sportbooking_system'),
    /must be sportbooking, sportbooking_dev or sportbooking_test/
  );
});

test('backend test runner refuses a database name other than sportbooking_test', () => {
  const result = spawnSync(
    process.execPath,
    [path.resolve(__dirname, '..', 'run-tests.js')],
    {
      env: {
        ...process.env,
        APP_ENV: 'test',
        DB_NAME: 'sportbooking'
      },
      encoding: 'utf8'
    }
  );

  assert.equal(result.status, 1);
  assert.match(result.stderr, /DB_NAME must be exactly sportbooking_test/);
});

test('survey telephone normalization preserves an existing zero and restores a missing one', () => {
  const warnings = [];
  assert.equal(normalizePhone('899234260', 2, warnings), '0899234260');
  assert.equal(normalizePhone('0987599746.', 12, warnings), '0987599746');
  assert.equal(normalizePhone('', 6, warnings), null);
  assert.deepEqual(warnings, []);
});

test('opening hours preserve 24:00 and round partial hours inward', () => {
  assert.deepEqual(parseOpeningHours('Cả ngày', 2), {
    openingMinutes: 0,
    closingMinutes: 1440,
    allDay: true
  });
  assert.deepEqual(parseOpeningHours('5h30 – 22h30.', 12), {
    openingMinutes: 360,
    closingMinutes: 1320,
    allDay: false
  });
  assert.equal(parseOpeningHours('05:00 đến 00:00', 21).closingMinutes, 1440);
});

test('survey prices distinguish normal and peak and apply the one-rate multiplier', () => {
  const warnings = [];
  assert.deepEqual(parsePrice('90.000 VNĐ/giờ.', 3, warnings), {
    minimum: 90000,
    maximum: 90000,
    normal: 90000,
    peak: 117000
  });
  assert.deepEqual(parsePrice('35.000 – 125.000 VNĐ/giờ', 20, warnings), {
    minimum: 35000,
    maximum: 125000,
    normal: 35000,
    peak: 125000
  });
  assert.deepEqual(warnings, []);
});

test('non-URL maps and invalid ratings are nulled with row-specific warnings', () => {
  const warnings = [];
  assert.equal(parseMapUrl('not a URL', 4, warnings), null);
  assert.equal(parseRating(new Date('2026-01-01T00:00:00Z'), 5, warnings), null);
  assert.deepEqual(warnings.map(({ row, field }) => ({ row, field })), [
    { row: 4, field: 'map_url' },
    { row: 5, field: 'initial_rating' }
  ]);
});

test('current workbook has 29 unique facility rows, expected sport totals, and valid ratings', async () => {
  const { facilities, sportCounts, warnings } = await loadSurvey();
  assert.equal(facilities.length, 29);
  assert.equal(new Set(facilities.map(({ district }) => district)).size, 6);
  assert.deepEqual(sportCounts, {
    BADMINTON: 10,
    FOOTBALL_MINI: 8,
    PICKLEBALL: 11
  });
  assert.equal(warnings.filter(({ field }) => field === 'map_url').length, 0);
  assert.equal(warnings.filter(({ field }) => field === 'initial_rating').length, 0);
});
