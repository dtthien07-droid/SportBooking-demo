'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

if (process.env.APP_ENV !== 'test' || process.env.DB_NAME !== 'sportbooking_test') {
  throw new Error('Facilities integration tests require APP_ENV=test and DB_NAME=sportbooking_test.');
}

const { closePool, getPool } = require('../src/config/database');
const { createApp } = require('../src/app');

function randomPhone() {
  return `+84${String(crypto.randomInt(100000000, 1000000000))}`;
}

function cookiePair(setCookie) {
  assert.ok(setCookie, 'Login must set a session cookie.');
  return setCookie.split(';', 1)[0];
}

function localDateOffset(days) {
  const date = new Date(Date.now() + 7 * 60 * 60 * 1000);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function createFixture(pool) {
  const suffix = crypto.randomUUID();
  const [facilityResult] = await pool.execute(
    `INSERT INTO facilities
       (name, address, district, opening_time, closing_time, amenities,
        is_active, is_seed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [`API test ${suffix}`, 'API test address', 'API test district', '00:00:00', '24:00:00', '[]', false, false]
  );
  const facilityId = facilityResult.insertId;
  const [courtResult] = await pool.execute(
    `INSERT INTO courts
       (facility_id, name, sport_type, price_normal, price_peak, is_active, is_seed,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [facilityId, `24-hour court ${suffix}`, 'BADMINTON', 100000, 130000, false, false]
  );
  const courtId = courtResult.insertId;
  const futureDate = localDateOffset(1);
  const expiredAt = new Date(Date.now() - 60 * 1000);
  const soon = new Date(Date.now() + 7 * 60 * 60 * 1000 + 5 * 60 * 1000);
  if (soon.getUTCMinutes() === 0) {
    soon.setUTCMinutes(1);
  }
  const soonDate = soon.toISOString().slice(0, 10);
  const soonStart = `${String(soon.getUTCHours()).padStart(2, '0')}:${String(soon.getUTCMinutes()).padStart(2, '0')}:00`;
  const soonEnd = soon.getUTCHours() === 23
    ? '24:00:00'
    : `${String(soon.getUTCHours() + 1).padStart(2, '0')}:00:00`;

  for (let hour = 0; hour < 24; hour += 1) {
    const startsAt = `${String(hour).padStart(2, '0')}:00:00`;
    const endsAt = hour === 23
      ? '24:00:00'
      : `${String(hour + 1).padStart(2, '0')}:00:00`;
    const status = hour === 23 ? 'LOCKED' : 'AVAILABLE';
    const lockExpiresAt = hour === 23 ? expiredAt : null;
    await pool.execute(
      `INSERT INTO time_slots
         (court_id, service_date, starts_at, ends_at, price, status, lock_expires_at,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [courtId, futureDate, startsAt, endsAt, 100000, status, lockExpiresAt]
    );
  }
  await pool.execute(
    `INSERT INTO time_slots
       (court_id, service_date, starts_at, ends_at, price, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [courtId, localDateOffset(0), '00:00:00', '01:00:00', 100000, 'AVAILABLE']
  );
  await pool.execute(
    `INSERT INTO time_slots
       (court_id, service_date, starts_at, ends_at, price, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [courtId, soonDate, soonStart, soonEnd, 100000, 'AVAILABLE']
  );

  return { facilityId, courtId, futureDate, soonDate, soonStart };
}

test('facility listing, details, and time slots are authenticated and reflect live availability', async () => {
  const pool = getPool();
  let server;
  let fixture;
  let userId;

  try {
    const [databaseRows] = await pool.execute('SELECT DATABASE() AS database_name');
    assert.equal(databaseRows[0].database_name, 'sportbooking_test');

    const app = createApp({ pool });
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const date = localDateOffset(1);

    for (const path of [
      '/api/v1/facilities',
      '/api/v1/facilities/1',
      `/api/v1/courts/1/time-slots?date=${date}`
    ]) {
      const response = await fetch(`${baseUrl}${path}`);
      assert.equal(response.status, 401, `${path} must require authentication`);
    }

    const password = crypto.randomBytes(24).toString('base64url');
    const email = `facilities-${crypto.randomUUID()}@example.test`;
    const registration = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        fullName: 'Facilities API Test',
        email,
        phone: randomPhone(),
        password,
        termsAccepted: true
      })
    });
    assert.equal(registration.status, 201);
    userId = (await registration.json()).user.id;

    const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    assert.equal(login.status, 200);
    const cookie = cookiePair(login.headers.get('set-cookie'));
    const getJson = async (path) => fetch(`${baseUrl}${path}`, { headers: { cookie } });

    const sportTotals = [
      ['BADMINTON', 10],
      ['FOOTBALL_MINI', 8],
      ['PICKLEBALL', 11]
    ];
    for (const [sport, total] of sportTotals) {
      const response = await getJson(`/api/v1/facilities?sport=${sport}&page_size=50`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.pagination.total, total);
      assert.ok(body.facilities.every((facility) => facility.sports.includes(sport)));
    }

    const initialListResponse = await getJson('/api/v1/facilities?page_size=1');
    assert.equal(initialListResponse.status, 200);
    const firstFacility = (await initialListResponse.json()).facilities[0];
    assert.ok(firstFacility);

    const districtResponse = await getJson(
      `/api/v1/facilities?district=${encodeURIComponent(firstFacility.district)}&page_size=50`
    );
    assert.equal(districtResponse.status, 200);
    const districtBody = await districtResponse.json();
    assert.ok(districtBody.pagination.total > 0);
    assert.ok(districtBody.facilities.every((facility) => facility.district === firstFacility.district));

    const keywordResponse = await getJson(
      `/api/v1/facilities?q=${encodeURIComponent(firstFacility.name)}&page_size=50`
    );
    assert.equal(keywordResponse.status, 200);
    const keywordBody = await keywordResponse.json();
    assert.ok(keywordBody.facilities.some((facility) => facility.id === firstFacility.id));

    const paginationResponse = await getJson('/api/v1/facilities?page=2&page_size=2');
    assert.equal(paginationResponse.status, 200);
    const paginationBody = await paginationResponse.json();
    assert.equal(paginationBody.facilities.length, 2);
    assert.equal(paginationBody.pagination.page, 2);
    assert.equal(paginationBody.pagination.page_size, 2);

    const missingFacility = await getJson('/api/v1/facilities/9999999999999999999');
    assert.equal(missingFacility.status, 404);

    fixture = await createFixture(pool);
    await pool.execute('UPDATE facilities SET is_active = ? WHERE id = ?', [true, fixture.facilityId]);
    await pool.execute('UPDATE courts SET is_active = ? WHERE id = ?', [true, fixture.courtId]);

    const facilityResponse = await getJson(`/api/v1/facilities/${fixture.facilityId}`);
    assert.equal(facilityResponse.status, 200);
    const facilityBody = await facilityResponse.json();
    assert.equal(facilityBody.facility.closing_time, '24:00:00');
    assert.equal(facilityBody.courts.length, 1);

    const slotsResponse = await getJson(
      `/api/v1/courts/${fixture.courtId}/time-slots?date=${fixture.futureDate}`
    );
    assert.equal(slotsResponse.status, 200);
    const slotsBody = await slotsResponse.json();
    assert.equal(slotsBody.time_slots.length, 24);
    assert.equal(slotsBody.time_slots[23].ends_at, '24:00:00');
    const expiredLock = slotsBody.time_slots.find((slot) => slot.starts_at === '23:00:00');
    assert.equal(expiredLock.status, 'AVAILABLE');
    assert.equal(expiredLock.is_selectable, true);

    const pastSlotsResponse = await getJson(
      `/api/v1/courts/${fixture.courtId}/time-slots?date=${localDateOffset(0)}`
    );
    assert.equal(pastSlotsResponse.status, 200);
    const pastSlot = (await pastSlotsResponse.json()).time_slots[0];
    assert.equal(pastSlot.starts_at, '00:00:00');
    assert.equal(pastSlot.is_selectable, false);
    assert.equal(pastSlot.unavailable_reason, 'PAST_OR_TOO_SOON');

    const soonSlotsResponse = await getJson(
      `/api/v1/courts/${fixture.courtId}/time-slots?date=${fixture.soonDate}`
    );
    assert.equal(soonSlotsResponse.status, 200);
    const soonSlot = (await soonSlotsResponse.json()).time_slots
      .find((slot) => slot.starts_at === fixture.soonStart);
    assert.equal(soonSlot.is_selectable, false, JSON.stringify({
      serviceDate: fixture.soonDate,
      startsAt: fixture.soonStart,
      slot: soonSlot,
      now: new Date().toISOString()
    }));
    assert.equal(soonSlot.unavailable_reason, 'PAST_OR_TOO_SOON');
  } finally {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
    if (fixture) {
      await pool.execute('DELETE FROM facilities WHERE id = ?', [fixture.facilityId]);
    }
    if (userId) {
      await pool.execute('DELETE FROM user_sessions WHERE user_id = ?', [userId]);
      await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
    }
    await closePool();
  }
});
