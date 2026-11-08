'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  buildServiceDates,
  normalizedHours,
  readSlotDaysAhead,
  readSlotGeneratorEnabled,
  runSlotGenerator
} = require('../src/facilities/slot-generator');

test('slot generator config uses defaults, validates day range, and follows APP_ENV defaults', () => {
  const warnings = [];
  const warn = (message) => warnings.push(message);
  assert.equal(readSlotDaysAhead({}, warn), 14);
  assert.equal(readSlotDaysAhead({ SLOT_DAYS_AHEAD: '1' }, warn), 1);
  assert.equal(readSlotDaysAhead({ SLOT_DAYS_AHEAD: '60' }, warn), 60);
  for (const value of ['0', '61', '1.5', 'abc']) {
    assert.equal(readSlotDaysAhead({ SLOT_DAYS_AHEAD: value }, warn), 14);
  }
  assert.equal(warnings.length, 4);

  assert.equal(readSlotGeneratorEnabled({ APP_ENV: 'development' }, warn), true);
  assert.equal(readSlotGeneratorEnabled({ APP_ENV: 'test' }, warn), false);
  assert.equal(readSlotGeneratorEnabled({ APP_ENV: 'test', SLOT_GENERATOR_ENABLED: 'true' }, warn), true);
  assert.equal(readSlotGeneratorEnabled({ APP_ENV: 'development', SLOT_GENERATOR_ENABLED: 'false' }, warn), false);
  assert.equal(readSlotGeneratorEnabled({ APP_ENV: 'test', SLOT_GENERATOR_ENABLED: 'invalid' }, warn), false);
  assert.equal(warnings.length, 5);
});

test('slot generator normalizes whole-hour bounds and dates across month boundaries', () => {
  assert.deepEqual(normalizedHours('00:00:00', '24:00:00'), {
    openingMinutes: 0,
    closingMinutes: 1440
  });
  assert.deepEqual(normalizedHours('05:30:00', '00:00:00'), {
    openingMinutes: 360,
    closingMinutes: 1440
  });
  assert.deepEqual(normalizedHours('05:30:00', '22:30:00'), {
    openingMinutes: 360,
    closingMinutes: 1320
  });
  assert.deepEqual(buildServiceDates(new Date('2099-01-31T05:00:00.000Z'), 3), [
    '2099-01-31', '2099-02-01', '2099-02-02'
  ]);
});

test('slot generator logs its effective date window and inserted count, including query failures', async () => {
  const messages = [];
  const logger = {
    info: (message) => messages.push(message),
    error: (message) => messages.push(message)
  };
  const connection = {
    async execute(sql) {
      if (sql.includes('SELECT c.id AS court_id')) {
        return [[{
          court_id: 123,
          opening_time: '08:00:00',
          closing_time: '09:00:00',
          price_normal: 100,
          price_peak: 130
        }]];
      }
      if (sql.includes('SELECT service_date, starts_at')) return [[]];
      if (sql.includes('INSERT IGNORE INTO time_slots')) return [{ affectedRows: 1 }];
      throw new Error('Unexpected generator query.');
    },
    release() {}
  };
  const summary = await runSlotGenerator({ getConnection: async () => connection }, {
    daysAhead: 16,
    now: new Date('2026-11-08T05:00:00.000Z'),
    logger
  });
  assert.equal(summary.slotsInserted, 16);
  assert.match(messages[0], /Started: days=16, dates=2026-11-08\.\.2026-11-23/);
  assert.match(messages[1], /Finished: days=16, dates=2026-11-08\.\.2026-11-23, courts=1, slots_added=16/);

  await assert.rejects(runSlotGenerator({
    getConnection: async () => { throw new Error('test connection failure'); }
  }, { daysAhead: 16, now: new Date('2026-11-08T05:00:00.000Z'), logger }), /test connection failure/);
  assert.match(messages[3], /Finished: days=16, status=error.*test connection failure/);
});
