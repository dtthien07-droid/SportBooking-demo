'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

if (process.env.APP_ENV !== 'test' || process.env.DB_NAME !== 'sportbooking_test') {
  throw new Error('Slot generator integration tests require APP_ENV=test and DB_NAME=sportbooking_test.');
}

const { closePool, getPool } = require('../src/config/database');
const { buildServiceDates, runSlotGenerator } = require('../src/facilities/slot-generator');

test('slot generation fills active courts idempotently without changing existing slots', async () => {
  const pool = getPool();
  const facilityIds = [];
  const now = new Date();
  const today = buildServiceDates(now, 1)[0];

  async function createCourt({ opening, closing, active = true, priceNormal = 100, pricePeak = 300 }) {
    const suffix = crypto.randomUUID();
    const [facilityResult] = await pool.execute(
      `INSERT INTO facilities
         (name, address, district, opening_time, closing_time, amenities,
          is_active, is_seed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '[]', ?, FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [`Slot generator ${suffix}`, 'Test address', 'Test district', opening, closing, active]
    );
    facilityIds.push(facilityResult.insertId);
    const [courtResult] = await pool.execute(
      `INSERT INTO courts
         (facility_id, name, sport_type, price_normal, price_peak, is_active, is_seed,
          created_at, updated_at)
       VALUES (?, ?, 'BADMINTON', ?, ?, TRUE, FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [facilityResult.insertId, `Test court ${suffix}`, priceNormal, pricePeak]
    );
    return courtResult.insertId;
  }

  try {
    const [databaseRows] = await pool.execute('SELECT DATABASE() AS database_name');
    assert.equal(databaseRows[0].database_name, 'sportbooking_test');

    const regularAndPeakCourt = await createCourt({ opening: '16:00:00', closing: '22:00:00' });
    const statefulCourt = await createCourt({ opening: '08:00:00', closing: '11:00:00' });
    const inactiveFacilityCourt = await createCourt({ opening: '07:00:00', closing: '09:00:00', active: false });
    const allDayCourt = await createCourt({ opening: '00:00:00', closing: '24:00:00' });
    const monthBoundaryCourt = await createCourt({ opening: '00:00:00', closing: '01:00:00' });

    const [preexisting] = await pool.execute(
      `INSERT INTO time_slots
         (court_id, service_date, starts_at, ends_at, price, status, lock_expires_at,
          created_at, updated_at)
       VALUES (?, ?, '08:00:00', '09:00:00', 111, 'LOCKED', '2099-01-01 00:00:00.000',
               UTC_TIMESTAMP(3), UTC_TIMESTAMP(3)),
              (?, ?, '09:00:00', '10:00:00', 222, 'BOOKED', NULL,
               UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [statefulCourt, today, statefulCourt, today]
    );
    assert.equal(preexisting.affectedRows, 2);
    const [beforeState] = await pool.execute(
      `SELECT starts_at, ends_at, price, status, current_booking_id, lock_expires_at,
              updated_at
       FROM time_slots WHERE court_id = ? AND service_date = ? ORDER BY starts_at`,
      [statefulCourt, today]
    );

    const completeRun = await runSlotGenerator(pool, {
      daysAhead: 1,
      now,
      courtIds: [regularAndPeakCourt]
    });
    assert.equal(completeRun.slotsInserted, 6);
    const [pricedSlots] = await pool.execute(
      'SELECT starts_at, price FROM time_slots WHERE court_id = ? AND service_date = ? ORDER BY starts_at',
      [regularAndPeakCourt, today]
    );
    assert.deepEqual(pricedSlots.map((slot) => Number(slot.price)), [100, 300, 300, 300, 300, 100]);
    const secondRun = await runSlotGenerator(pool, {
      daysAhead: 1,
      now,
      courtIds: [regularAndPeakCourt]
    });
    assert.equal(secondRun.slotsInserted, 0);
    assert.equal(secondRun.slotsExisting, 6);

    const statefulRun = await runSlotGenerator(pool, {
      daysAhead: 1,
      now,
      courtIds: [statefulCourt]
    });
    assert.equal(statefulRun.slotsInserted, 1);
    const [afterState] = await pool.execute(
      `SELECT starts_at, ends_at, price, status, current_booking_id, lock_expires_at,
              updated_at
       FROM time_slots WHERE court_id = ? AND service_date = ? ORDER BY starts_at`,
      [statefulCourt, today]
    );
    assert.equal(afterState.length, 3);
    assert.deepEqual(afterState.slice(0, 2), beforeState);
    assert.equal(afterState[0].status, 'LOCKED');
    assert.equal(afterState[1].status, 'BOOKED');
    assert.equal(afterState[0].current_booking_id, null);
    assert.ok(afterState[0].lock_expires_at);

    const inactiveRun = await runSlotGenerator(pool, {
      daysAhead: 1,
      now,
      courtIds: [inactiveFacilityCourt]
    });
    assert.equal(inactiveRun.courtsProcessed, 0);
    assert.equal(inactiveRun.slotsInserted, 0);

    const allDayRun = await runSlotGenerator(pool, {
      daysAhead: 1,
      now,
      courtIds: [allDayCourt]
    });
    assert.equal(allDayRun.slotsInserted, 24);
    const [allDaySlots] = await pool.execute(
      'SELECT ends_at FROM time_slots WHERE court_id = ? AND service_date = ?',
      [allDayCourt, today]
    );
    assert.equal(allDaySlots.length, 24);
    assert.equal(allDaySlots.find((slot) => String(slot.ends_at).startsWith('24:00'))?.ends_at, '24:00:00');

    const monthRun = await runSlotGenerator(pool, {
      daysAhead: 3,
      now: new Date('2099-01-31T05:00:00.000Z'),
      courtIds: [monthBoundaryCourt]
    });
    assert.equal(monthRun.slotsInserted, 3);
    assert.deepEqual(monthRun.dates, ['2099-01-31', '2099-02-01', '2099-02-02']);
    const [monthSlots] = await pool.execute(
      'SELECT service_date FROM time_slots WHERE court_id = ? ORDER BY service_date',
      [monthBoundaryCourt]
    );
    assert.deepEqual(monthSlots.map((slot) => (
      slot.service_date instanceof Date
        ? slot.service_date.toISOString().slice(0, 10)
        : String(slot.service_date).slice(0, 10)
    )), monthRun.dates);
  } finally {
    try {
      if (facilityIds.length) {
        const placeholders = facilityIds.map(() => '?').join(', ');
        await pool.execute(`DELETE FROM facilities WHERE id IN (${placeholders})`, facilityIds);
      }
    } finally {
      await closePool();
    }
  }
});
