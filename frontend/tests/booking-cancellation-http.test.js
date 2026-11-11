'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

if (process.env.APP_ENV !== 'test' || process.env.DB_NAME !== 'sportbooking_test') {
  throw new Error('Booking cancellation HTTP test requires APP_ENV=test and DB_NAME=sportbooking_test.');
}

const { closePool, getPool } = require('../../backend/src/config/database');
const { createApp } = require('../../backend/src/app');

function localSlot(hoursAhead) {
  const start = new Date(Math.ceil((Date.now() + hoursAhead * 3_600_000) / 60_000) * 60_000);
  const localStart = new Date(start.getTime() + 7 * 3_600_000);
  const localEnd = new Date(localStart.getTime() + 3_600_000);
  return {
    serviceDate: localStart.toISOString().slice(0, 10),
    startsAt: localStart.toISOString().slice(11, 19),
    endsAt: localEnd.toISOString().slice(11, 19)
  };
}

function sessionCookie(setCookie) {
  assert.ok(setCookie, 'Login must set a session cookie.');
  return setCookie.split(';', 1)[0];
}

async function postJson(baseUrl, route, payload, cookie) {
  return fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(payload)
  });
}

test('create, pay, cancel, query released schedule, and rebook through HTTP', async () => {
  const pool = getPool();
  const userIds = [];
  const userEmails = [];
  const bookingIds = [];
  const timeSlotIds = [];
  let facilityId;
  let courtId;
  let server;

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
    const email = `cancel-history-${crypto.randomUUID()}@example.test`;
    userEmails.push(email);

    const registration = await postJson(baseUrl, '/api/v1/auth/register', {
      fullName: 'Booking Cancellation HTTP Test',
      email,
      phone: `+84${String(crypto.randomInt(100000000, 1000000000))}`,
      password,
      termsAccepted: true
    }, '');
    assert.equal(registration.status, 201);
    const { user } = await registration.json();
    userIds.push(String(user.id));
    const login = await postJson(baseUrl, '/api/v1/auth/login', { email, password }, '');
    assert.equal(login.status, 200);
    const cookie = sessionCookie(login.headers.get('set-cookie'));

    const suffix = crypto.randomUUID();
    const [facilityResult] = await pool.execute(
      `INSERT INTO facilities
         (name, address, district, amenities, is_active, is_seed, created_at, updated_at)
       VALUES (?, ?, ?, ?, TRUE, FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [`Cancellation HTTP test ${suffix}`, 'Integration test address', 'Test district', '[]']
    );
    facilityId = String(facilityResult.insertId);
    const [courtResult] = await pool.execute(
      `INSERT INTO courts
         (facility_id, name, sport_type, price_normal, price_peak, is_active, is_seed,
          created_at, updated_at)
       VALUES (?, ?, 'BADMINTON', 120000, 150000, TRUE, FALSE,
               UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [facilityId, `Cancellation HTTP court ${suffix}`]
    );
    courtId = String(courtResult.insertId);

    const slots = [];
    for (const hoursAhead of [40, 41]) {
      const slot = localSlot(hoursAhead);
      const [slotResult] = await pool.execute(
        `INSERT INTO time_slots
           (court_id, service_date, starts_at, ends_at, price, status,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, 120000, 'AVAILABLE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [courtId, slot.serviceDate, slot.startsAt, slot.endsAt]
      );
      const id = String(slotResult.insertId);
      timeSlotIds.push(id);
      slots.push({ ...slot, id });
    }

    const slotIds = slots.map((slot) => slot.id);
    const createResponse = await postJson(baseUrl, '/api/v1/bookings', {
      slot_ids: slotIds,
      payment_option: 'FULL'
    }, cookie);
    assert.equal(createResponse.status, 201);
    const createdBooking = await createResponse.json();
    const bookingId = String(createdBooking.booking_id);
    bookingIds.push(bookingId);

    const paymentResponse = await postJson(
      baseUrl,
      `/api/v1/bookings/${bookingId}/payment-attempts`,
      { method: 'BANK_TRANSFER', simulation_result: 'SUCCESS' },
      cookie
    );
    assert.equal(paymentResponse.status, 201);

    const previewResponse = await fetch(
      `${baseUrl}/api/v1/bookings/${bookingId}/refund-preview`,
      { headers: { cookie } }
    );
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.ok(Number.isSafeInteger(preview.seconds_until_start));
    assert.match(preview.server_time, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);

    const cancelResponse = await postJson(
      baseUrl,
      `/api/v1/bookings/${bookingId}/cancel`,
      {
        expected_refund_amount: preview.refund_amount,
        expected_refund_percent: preview.refund_percent
      },
      cookie
    );
    assert.equal(cancelResponse.status, 200);
    assert.equal((await cancelResponse.json()).status, 'CANCELLED');

    for (const slot of slots) {
      const scheduleResponse = await fetch(
        `${baseUrl}/api/v1/courts/${courtId}/time-slots?date=${slot.serviceDate}`,
        { headers: { cookie } }
      );
      assert.equal(scheduleResponse.status, 200);
      const schedule = await scheduleResponse.json();
      const released = schedule.time_slots.find((timeSlot) => String(timeSlot.id) === slot.id);
      assert.ok(released, 'Cancelled booking slot must remain in the court schedule.');
      assert.equal(released.status, 'AVAILABLE');
      assert.equal(released.is_selectable, true);
    }

    const rebookingResponse = await postJson(baseUrl, '/api/v1/bookings', {
      slot_ids: slotIds,
      payment_option: 'FULL'
    }, cookie);
    assert.equal(rebookingResponse.status, 201);
    bookingIds.push(String((await rebookingResponse.json()).booking_id));
  } finally {
    const cleanupErrors = [];
    const cleanup = async (operation) => {
      try {
        await operation();
      } catch (error) {
        cleanupErrors.push(error);
      }
    };
    if (server) {
      await cleanup(() => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      }));
    }
    const uniqueBookingIds = [...new Set(bookingIds)];
    if (uniqueBookingIds.length > 0) {
      const placeholders = uniqueBookingIds.map(() => '?').join(', ');
      await cleanup(() => pool.execute(
        `DELETE FROM booking_tickets WHERE booking_id IN (${placeholders})`,
        uniqueBookingIds
      ));
      await cleanup(() => pool.execute(
        `DELETE pa FROM payment_attempts pa
         INNER JOIN payments p ON p.id = pa.payment_id
         WHERE p.booking_id IN (${placeholders})`,
        uniqueBookingIds
      ));
      await cleanup(() => pool.execute(
        `DELETE FROM booking_slots WHERE booking_id IN (${placeholders})`,
        uniqueBookingIds
      ));
      await cleanup(() => pool.execute(
        `UPDATE time_slots SET current_booking_id = NULL, lock_expires_at = NULL
         WHERE current_booking_id IN (${placeholders})`,
        uniqueBookingIds
      ));
      await cleanup(() => pool.execute(
        `DELETE FROM payments WHERE booking_id IN (${placeholders})`,
        uniqueBookingIds
      ));
      await cleanup(() => pool.execute(
        `DELETE FROM bookings WHERE id IN (${placeholders})`,
        uniqueBookingIds
      ));
    }
    if (timeSlotIds.length > 0) {
      const placeholders = timeSlotIds.map(() => '?').join(', ');
      await cleanup(() => pool.execute(
        `DELETE FROM time_slots WHERE id IN (${placeholders})`,
        timeSlotIds
      ));
    }
    if (courtId) await cleanup(() => pool.execute('DELETE FROM courts WHERE id = ?', [courtId]));
    if (facilityId) {
      await cleanup(() => pool.execute('DELETE FROM facilities WHERE id = ?', [facilityId]));
    }
    if (userIds.length > 0) {
      const placeholders = userIds.map(() => '?').join(', ');
      await cleanup(() => pool.execute(
        `DELETE FROM user_sessions WHERE user_id IN (${placeholders})`,
        userIds
      ));
    }
    if (userEmails.length > 0) {
      const placeholders = userEmails.map(() => '?').join(', ');
      await cleanup(() => pool.execute(
        `DELETE FROM user_sessions WHERE user_id IN
         (SELECT id FROM users WHERE email IN (${placeholders}))`,
        userEmails
      ));
      await cleanup(() => pool.execute(
        `DELETE FROM users WHERE email IN (${placeholders})`,
        userEmails
      ));
    }
    await cleanup(() => closePool());
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'Booking cancellation HTTP test cleanup failed.');
    }
  }
});
