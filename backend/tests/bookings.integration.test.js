'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

if (process.env.APP_ENV !== 'test' || process.env.DB_NAME !== 'sportbooking_test') {
  throw new Error('Booking integration tests require APP_ENV=test and DB_NAME=sportbooking_test.');
}

const { closePool, getPool } = require('../src/config/database');
const { createApp } = require('../src/app');

function localDateOffset(days) {
  const date = new Date(Date.now() + 7 * 60 * 60 * 1000);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function cookiePair(setCookie) {
  assert.ok(setCookie, 'Login must set a session cookie.');
  return setCookie.split(';', 1)[0];
}

async function postJson(baseUrl, path, body, cookie) {
  const headers = { 'content-type': 'application/json' };
  if (cookie) {
    headers.cookie = cookie;
  }
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
}

function createSoonSlotTime() {
  const startsAt = new Date(Date.now() + 7 * 60 * 60 * 1000 + 5 * 60 * 1000);
  return {
    date: startsAt.toISOString().slice(0, 10),
    startsAt: `${String(startsAt.getUTCHours()).padStart(2, '0')}:${String(startsAt.getUTCMinutes()).padStart(2, '0')}:00`
  };
}

test('booking holds, locking, cancellation, and expiry work on sportbooking_test', async (t) => {
  const pool = getPool();
  const userIds = [];
  let facilityId;
  let courtId;
  let server;
  let multiSlotBookingId;

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
    const password = crypto.randomBytes(24).toString('base64url');

    async function createUser() {
      const email = `booking-${crypto.randomUUID()}@example.test`;
      const registration = await postJson(baseUrl, '/api/v1/auth/register', {
        fullName: 'Booking Integration Test',
        email,
        phone: `+84${String(crypto.randomInt(100000000, 1000000000))}`,
        password,
        termsAccepted: true
      });
      assert.equal(registration.status, 201);
      const { user } = await registration.json();
      userIds.push(String(user.id));

      const login = await postJson(baseUrl, '/api/v1/auth/login', { email, password });
      assert.equal(login.status, 200);
      return { id: String(user.id), cookie: cookiePair(login.headers.get('set-cookie')) };
    }

    const users = [];
    for (let index = 0; index < 5; index += 1) {
      users.push(await createUser());
    }

    const suffix = crypto.randomUUID();
    const [facilityResult] = await pool.execute(
      `INSERT INTO facilities
         (name, address, district, amenities, is_active, is_seed, created_at, updated_at)
       VALUES (?, ?, ?, ?, TRUE, FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [`Booking test ${suffix}`, 'Integration test address', 'Test district', '[]']
    );
    facilityId = String(facilityResult.insertId);
    const [courtResult] = await pool.execute(
      `INSERT INTO courts
         (facility_id, name, sport_type, price_normal, price_peak, is_active, is_seed,
          created_at, updated_at)
       VALUES (?, ?, 'BADMINTON', 120000, 150000, TRUE, FALSE,
               UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [facilityId, `Booking test court ${suffix}`]
    );
    courtId = String(courtResult.insertId);

    const serviceDate = localDateOffset(2);
    const slotIds = [];
    for (let hour = 0; hour < 12; hour += 1) {
      const [slotResult] = await pool.execute(
        `INSERT INTO time_slots
           (court_id, service_date, starts_at, ends_at, price, status,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'AVAILABLE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [
          courtId,
          serviceDate,
          `${String(hour).padStart(2, '0')}:00:00`,
          `${String(hour + 1).padStart(2, '0')}:00:00`,
          hour === 0 ? 123456 : 120000
        ]
      );
      slotIds.push(String(slotResult.insertId));
    }
    const soonSlot = createSoonSlotTime();
    const [soonSlotResult] = await pool.execute(
      `INSERT INTO time_slots
         (court_id, service_date, starts_at, ends_at, price, status,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, 120000, 'AVAILABLE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [
        courtId,
        soonSlot.date,
        soonSlot.startsAt,
        `${String((Number(soonSlot.startsAt.slice(0, 2)) + 1) % 24).padStart(2, '0')}:${soonSlot.startsAt.slice(3, 5)}:00`
      ]
    );
    const tooSoonSlotId = String(soonSlotResult.insertId);

    await t.test('creates one-slot and contiguous multi-slot holds with server prices', async () => {
      const oneSlotResponse = await postJson(
        baseUrl,
        '/api/v1/bookings',
        { slot_ids: [slotIds[0]] },
        users[0].cookie
      );
      assert.equal(oneSlotResponse.status, 201);
      const oneSlotBooking = await oneSlotResponse.json();
      assert.match(oneSlotBooking.booking_code, /^SPB-[A-F0-9]{32}$/);
      assert.equal(oneSlotBooking.status, 'PENDING');
      assert.equal(oneSlotBooking.total_amount, '123456');
      assert.equal(oneSlotBooking.remaining_seconds, 600);
      assert.equal(oneSlotBooking.slots.length, 1);

      const multiSlotResponse = await postJson(
        baseUrl,
        '/api/v1/bookings',
        { slot_ids: [slotIds[4], slotIds[3]] },
        users[1].cookie
      );
      assert.equal(multiSlotResponse.status, 201);
      const multiSlotBooking = await multiSlotResponse.json();
      multiSlotBookingId = multiSlotBooking.booking_id;
      assert.equal(multiSlotBooking.total_amount, '240000');
      assert.equal(multiSlotBooking.slots.length, 2);
      assert.deepEqual(
        multiSlotBooking.slots.map((slot) => slot.starts_at),
        ['03:00:00', '04:00:00']
      );
      const detailResponse = await fetch(
        `${baseUrl}/api/v1/bookings/${multiSlotBooking.booking_id}`,
        { headers: { cookie: users[1].cookie } }
      );
      assert.equal(detailResponse.status, 200);
      const detail = await detailResponse.json();
      assert.equal(detail.slots[0].court_name, `Booking test court ${suffix}`);
      assert.equal(detail.slots[0].price_at_booking, '120000');
    });

    await t.test('rejects a second active booking and non-contiguous or near-term slots', async () => {
      const unauthenticated = await postJson(
        baseUrl,
        '/api/v1/bookings',
        { slot_ids: [slotIds[2]] }
      );
      assert.equal(unauthenticated.status, 401);

      const missingSlots = await postJson(
        baseUrl,
        '/api/v1/bookings',
        { slot_ids: [] },
        users[2].cookie
      );
      assert.equal(missingSlots.status, 400);

      const secondPending = await postJson(
        baseUrl,
        '/api/v1/bookings',
        { slot_ids: [slotIds[1]] },
        users[0].cookie
      );
      assert.equal(secondPending.status, 409);

      const nonContiguous = await postJson(
        baseUrl,
        '/api/v1/bookings',
        { slot_ids: [slotIds[6], slotIds[8]] },
        users[2].cookie
      );
      assert.equal(nonContiguous.status, 400);

      const tooSoon = await postJson(
        baseUrl,
        '/api/v1/bookings',
        { slot_ids: [tooSoonSlotId] },
        users[2].cookie
      );
      assert.equal(tooSoon.status, 400);

      const duplicateIds = await postJson(
        baseUrl,
        '/api/v1/bookings',
        { slot_ids: [slotIds[9], slotIds[9]] },
        users[2].cookie
      );
      assert.equal(duplicateIds.status, 400);
    });

    await t.test('allows only one concurrent hold for the same slot', async () => {
      const responses = await Promise.all([
        postJson(baseUrl, '/api/v1/bookings', { slot_ids: [slotIds[10]] }, users[3].cookie),
        postJson(baseUrl, '/api/v1/bookings', { slot_ids: [slotIds[10]] }, users[4].cookie)
      ]);
      assert.deepEqual(
        responses.map((response) => response.status).sort(),
        [201, 409]
      );
      const [slotRows] = await pool.execute(
        `SELECT status, current_booking_id
         FROM time_slots
         WHERE id = ?`,
        [slotIds[10]]
      );
      assert.equal(slotRows[0].status, 'LOCKED');
      assert.ok(slotRows[0].current_booking_id);
      const [detailRows] = await pool.execute(
        'SELECT COUNT(*) AS count FROM booking_slots WHERE time_slot_id = ?',
        [slotIds[10]]
      );
      assert.equal(Number(detailRows[0].count), 1);
      const [bookingRows] = await pool.execute(
        `SELECT COUNT(*) AS count
         FROM bookings
         WHERE id = ? AND status = 'PENDING'`,
        [slotRows[0].current_booking_id]
      );
      assert.equal(Number(bookingRows[0].count), 1);
      const [allUserBookings] = await pool.execute(
        'SELECT COUNT(*) AS count FROM bookings WHERE user_id IN (?, ?)',
        [users[3].id, users[4].id]
      );
      assert.equal(Number(allUserBookings[0].count), 1);
    });

    await t.test('cancellation frees slots and expiry job releases elapsed holds', async () => {
      const cancelResponse = await postJson(
        baseUrl,
        '/api/v1/bookings',
        { slot_ids: [slotIds[9]] },
        users[2].cookie
      );
      assert.equal(cancelResponse.status, 201);
      const cancelBooking = await cancelResponse.json();
      const cancelled = await postJson(
        baseUrl,
        `/api/v1/bookings/${cancelBooking.booking_id}/cancel`,
        {},
        users[2].cookie
      );
      assert.equal(cancelled.status, 200);
      assert.equal((await cancelled.json()).status, 'CANCELLED');
      const [cancelledSlotRows] = await pool.execute(
        'SELECT status, current_booking_id, lock_expires_at FROM time_slots WHERE id = ?',
        [slotIds[9]]
      );
      assert.equal(cancelledSlotRows[0].status, 'AVAILABLE');
      assert.equal(cancelledSlotRows[0].current_booking_id, null);
      assert.equal(cancelledSlotRows[0].lock_expires_at, null);

      const expiringResponse = await postJson(
        baseUrl,
        '/api/v1/bookings',
        { slot_ids: [slotIds[11]] },
        users[2].cookie
      );
      assert.equal(expiringResponse.status, 201);
      const expiringBooking = await expiringResponse.json();
      await pool.execute(
        `UPDATE bookings
         SET lock_expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND)
         WHERE id = ?`,
        [expiringBooking.booking_id]
      );
      await pool.execute(
        `UPDATE time_slots
         SET lock_expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND)
         WHERE current_booking_id = ?`,
        [expiringBooking.booking_id]
      );
      const released = await app.locals.bookingsService.releaseExpiredBookings();
      assert.equal(released, 1);
      const [expiredRows] = await pool.execute(
        `SELECT b.status, ts.status AS slot_status, ts.current_booking_id, ts.lock_expires_at
         FROM bookings AS b
         INNER JOIN booking_slots AS bs ON bs.booking_id = b.id
         INNER JOIN time_slots AS ts ON ts.id = bs.time_slot_id
         WHERE b.id = ?`,
        [expiringBooking.booking_id]
      );
      assert.equal(expiredRows[0].status, 'EXPIRED');
      assert.equal(expiredRows[0].slot_status, 'AVAILABLE');
      assert.equal(expiredRows[0].current_booking_id, null);
      assert.equal(expiredRows[0].lock_expires_at, null);

      const expiredRead = await fetch(
        `${baseUrl}/api/v1/bookings/${expiringBooking.booking_id}`,
        { headers: { cookie: users[2].cookie } }
      );
      assert.equal(expiredRead.status, 410);
    });

    await t.test('does not disclose bookings to a different user', async () => {
      const ownerRead = await fetch(
        `${baseUrl}/api/v1/bookings/${multiSlotBookingId}`,
        { headers: { cookie: users[1].cookie } }
      );
      assert.equal(ownerRead.status, 200);
      const otherUserRead = await fetch(
        `${baseUrl}/api/v1/bookings/${multiSlotBookingId}`,
        { headers: { cookie: users[2].cookie } }
      );
      assert.equal(otherUserRead.status, 404);
    });
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (facilityId && courtId) {
      const [bookingRows] = await pool.execute(
        `SELECT DISTINCT b.id
         FROM bookings AS b
         INNER JOIN booking_slots AS bs ON bs.booking_id = b.id
         INNER JOIN time_slots AS ts ON ts.id = bs.time_slot_id
         WHERE ts.court_id = ?`,
        [courtId]
      );
      const bookingIds = bookingRows.map((row) => String(row.id));
      if (bookingIds.length > 0) {
        const placeholders = bookingIds.map(() => '?').join(', ');
        await pool.execute(
          `DELETE FROM booking_slots WHERE booking_id IN (${placeholders})`,
          bookingIds
        );
        await pool.execute(
          `UPDATE time_slots
           SET current_booking_id = NULL, lock_expires_at = NULL
           WHERE current_booking_id IN (${placeholders})`,
          bookingIds
        );
        await pool.execute(`DELETE FROM bookings WHERE id IN (${placeholders})`, bookingIds);
      }
      await pool.execute('DELETE FROM time_slots WHERE court_id = ?', [courtId]);
      await pool.execute('DELETE FROM courts WHERE id = ?', [courtId]);
      await pool.execute('DELETE FROM facilities WHERE id = ?', [facilityId]);
    }
    for (const userId of userIds) {
      await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
    }
    await closePool();
  }
});
