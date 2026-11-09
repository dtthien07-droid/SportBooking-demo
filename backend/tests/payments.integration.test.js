'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

if (process.env.APP_ENV !== 'test' || process.env.DB_NAME !== 'sportbooking_test') {
  throw new Error('Payment integration tests require APP_ENV=test and DB_NAME=sportbooking_test.');
}

const { closePool, getPool } = require('../src/config/database');
const { createApp } = require('../src/app');

function cookiePair(setCookie) {
  assert.ok(setCookie, 'Login must set a session cookie.');
  return setCookie.split(';', 1)[0];
}

async function requestJson(baseUrl, path, method, body, cookie) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return fetch(`${baseUrl}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
}

test('payment attempts, ticket issuance, ownership, and expiry work on sportbooking_test', async (t) => {
  const pool = getPool();
  const userIds = [];
  const userEmails = [];
  const bookingIds = [];
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

    async function createUser(index, role = 'USER') {
      const email = `payment-${crypto.randomUUID()}@example.test`;
      userEmails.push(email);
      const registration = await requestJson(baseUrl, '/api/v1/auth/register', 'POST', {
        fullName: `Payment Integration ${index}`,
        email,
        phone: `+84${String(crypto.randomInt(100000000, 1000000000))}`,
        password,
        termsAccepted: true
      });
      assert.equal(registration.status, 201);
      const { user } = await registration.json();
      userIds.push(String(user.id));
      if (role === 'ADMIN') {
        await pool.execute('UPDATE users SET role = ? WHERE id = ?', ['ADMIN', user.id]);
      }
      const login = await requestJson(baseUrl, '/api/v1/auth/login', 'POST', { email, password });
      assert.equal(login.status, 200);
      return { id: String(user.id), cookie: cookiePair(login.headers.get('set-cookie')) };
    }

    const owner = await createUser(1);
    const other = await createUser(2);
    const admin = await createUser(3, 'ADMIN');
    const suffix = crypto.randomUUID();
    const [facilityResult] = await pool.execute(
      `INSERT INTO facilities
         (name, address, district, amenities, is_active, is_seed, created_at, updated_at)
       VALUES (?, ?, ?, ?, TRUE, FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [`Payment test ${suffix}`, 'Integration test address', 'Test district', '[]']
    );
    facilityId = String(facilityResult.insertId);
    const [courtResult] = await pool.execute(
      `INSERT INTO courts
         (facility_id, name, sport_type, price_normal, price_peak, is_active, is_seed,
          created_at, updated_at)
       VALUES (?, ?, 'BADMINTON', 125000, 150000, TRUE, FALSE,
               UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [facilityId, `Payment test court ${suffix}`]
    );
    courtId = String(courtResult.insertId);

    const serviceDate = new Date(Date.now() + 7 * 86400000 + 7 * 3600000).toISOString().slice(0, 10);
    const slotIds = [];
    for (let hour = 8; hour < 14; hour += 1) {
      const [slotResult] = await pool.execute(
        `INSERT INTO time_slots
           (court_id, service_date, starts_at, ends_at, price, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 125000, 'AVAILABLE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [courtId, serviceDate, `${String(hour).padStart(2, '0')}:00:00`, `${String(hour + 1).padStart(2, '0')}:00:00`]
      );
      slotIds.push(String(slotResult.insertId));
    }

    async function createBooking(slotId) {
      const response = await requestJson(baseUrl, '/api/v1/bookings', 'POST', {
        slot_ids: [slotId], payment_option: 'FULL'
      }, owner.cookie);
      assert.equal(response.status, 201);
      const booking = await response.json();
      bookingIds.push(booking.booking_id);
      return booking;
    }

    async function pay(bookingId, cookie, simulationResult = 'SUCCESS', extra = {}) {
      return requestJson(baseUrl, `/api/v1/bookings/${bookingId}/payment-attempts`, 'POST', {
        method: 'BANK_TRANSFER', simulation_result: simulationResult, ...extra
      }, cookie);
    }

    await t.test('SUCCESS atomically confirms payment, booking, all slots, and one ticket; repeat is 409', async () => {
      const booking = await createBooking(slotIds[0]);
      const clientOverride = await pay(booking.booking_id, owner.cookie, 'SUCCESS', { amount: 1, status: 'FAILED' });
      assert.equal(clientOverride.status, 400);
      const response = await pay(booking.booking_id, owner.cookie, 'SUCCESS');
      assert.equal(response.status, 201);
      const result = await response.json();
      assert.equal(result.attempt.amount, '125000');
      assert.equal(result.attempt.result, 'SUCCEEDED');
      assert.equal(result.payment.status, 'PAID');
      assert.equal(result.booking.status, 'CONFIRMED');
      assert.match(result.ticket.qr_code, /^QR-[A-F0-9]{48}$/);
      const [rows] = await pool.execute(
        `SELECT b.status AS booking_status, p.status AS payment_status,
                COUNT(DISTINCT CASE WHEN ts.status = 'BOOKED' THEN ts.id END) AS booked_slots,
                (SELECT COUNT(*) FROM booking_tickets WHERE booking_id = b.id) AS tickets
         FROM bookings b JOIN payments p ON p.booking_id = b.id
         JOIN booking_slots bs ON bs.booking_id = b.id
         JOIN time_slots ts ON ts.id = bs.time_slot_id
         WHERE b.id = ? GROUP BY b.id, p.id`,
        [booking.booking_id]
      );
      assert.equal(rows[0].booking_status, 'CONFIRMED');
      assert.equal(rows[0].payment_status, 'PAID');
      assert.equal(Number(rows[0].booked_slots), 1);
      assert.equal(Number(rows[0].tickets), 1);

      const repeated = await pay(booking.booking_id, owner.cookie);
      assert.equal(repeated.status, 409);
      const [attemptRows] = await pool.execute(
        'SELECT COUNT(*) AS count FROM payment_attempts WHERE payment_id = (SELECT id FROM payments WHERE booking_id = ?)',
        [booking.booking_id]
      );
      assert.equal(Number(attemptRows[0].count), 1);
    });

    await t.test('FAILURE keeps the hold and a retry can succeed', async () => {
      const booking = await createBooking(slotIds[1]);
      const failure = await pay(booking.booking_id, owner.cookie, 'FAILURE');
      assert.equal(failure.status, 201);
      assert.equal((await failure.json()).attempt.result, 'FAILED');
      const [pendingRows] = await pool.execute(
        `SELECT b.status AS booking_status, p.status AS payment_status, ts.status AS slot_status
         FROM bookings b JOIN payments p ON p.booking_id = b.id
         JOIN booking_slots bs ON bs.booking_id = b.id JOIN time_slots ts ON ts.id = bs.time_slot_id
         WHERE b.id = ?`,
        [booking.booking_id]
      );
      assert.deepEqual([pendingRows[0].booking_status, pendingRows[0].payment_status, pendingRows[0].slot_status],
        ['PENDING', 'PENDING', 'LOCKED']);
      const success = await pay(booking.booking_id, owner.cookie);
      assert.equal(success.status, 201);
      const result = await success.json();
      assert.equal(result.attempt.attempt_no, 2);
      assert.equal(result.booking.status, 'CONFIRMED');
    });

    await t.test('expired hold returns 410, expires booking, releases slots, and records no attempt', async () => {
      const booking = await createBooking(slotIds[2]);
      await pool.execute(
        `UPDATE bookings SET lock_expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND) WHERE id = ?`,
        [booking.booking_id]
      );
      await pool.execute(
        `UPDATE time_slots SET lock_expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND)
         WHERE current_booking_id = ?`,
        [booking.booking_id]
      );
      const response = await pay(booking.booking_id, owner.cookie);
      assert.equal(response.status, 410);
      const [rows] = await pool.execute(
        `SELECT b.status AS booking_status, ts.status AS slot_status, ts.current_booking_id,
                (SELECT COUNT(*) FROM payment_attempts pa JOIN payments p ON p.id = pa.payment_id
                 WHERE p.booking_id = b.id) AS attempts
         FROM bookings b JOIN booking_slots bs ON bs.booking_id = b.id
         JOIN time_slots ts ON ts.id = bs.time_slot_id WHERE b.id = ?`,
        [booking.booking_id]
      );
      assert.equal(rows[0].booking_status, 'EXPIRED');
      assert.equal(rows[0].slot_status, 'AVAILABLE');
      assert.equal(rows[0].current_booking_id, null);
      assert.equal(Number(rows[0].attempts), 0);
    });

    await t.test('another user cannot pay; owner and Admin can read payment history', async () => {
      const booking = await createBooking(slotIds[3]);
      const denied = await pay(booking.booking_id, other.cookie);
      assert.equal(denied.status, 404);
      const ownerRead = await requestJson(baseUrl, `/api/v1/bookings/${booking.booking_id}/payments`, 'GET', undefined, owner.cookie);
      assert.equal(ownerRead.status, 200);
      assert.equal((await ownerRead.json()).payment.status, 'PENDING');
      const adminRead = await requestJson(baseUrl, `/api/v1/bookings/${booking.booking_id}/payments`, 'GET', undefined, admin.cookie);
      assert.equal(adminRead.status, 200);
      const otherRead = await requestJson(baseUrl, `/api/v1/bookings/${booking.booking_id}/payments`, 'GET', undefined, other.cookie);
      assert.equal(otherRead.status, 404);
      assert.equal((await pay(booking.booking_id, owner.cookie)).status, 201);
    });

    await t.test('concurrent SUCCESS calls produce one attempt and one ticket; expiry job ignores confirmed booking', async () => {
      const booking = await createBooking(slotIds[4]);
      const [first, second] = await Promise.all([
        pay(booking.booking_id, owner.cookie),
        pay(booking.booking_id, owner.cookie)
      ]);
      assert.deepEqual([first.status, second.status].sort(), [201, 409]);
      const released = await app.locals.bookingsService.releaseExpiredBookings();
      assert.ok(released >= 0);
      const [rows] = await pool.execute(
        `SELECT b.status AS booking_status, ts.status AS slot_status,
                (SELECT COUNT(*) FROM payment_attempts pa JOIN payments p ON p.id = pa.payment_id
                 WHERE p.booking_id = b.id) AS attempts,
                (SELECT COUNT(*) FROM booking_tickets WHERE booking_id = b.id) AS tickets
         FROM bookings b JOIN booking_slots bs ON bs.booking_id = b.id
         JOIN time_slots ts ON ts.id = bs.time_slot_id WHERE b.id = ?`,
        [booking.booking_id]
      );
      assert.deepEqual([rows[0].booking_status, rows[0].slot_status], ['CONFIRMED', 'BOOKED']);
      assert.equal(Number(rows[0].attempts), 1);
      assert.equal(Number(rows[0].tickets), 1);
    });
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

    if (userEmails.length > 0) {
      const emailPlaceholders = userEmails.map(() => '?').join(', ');
      await cleanup(async () => {
        const [rows] = await pool.execute(
          `SELECT id FROM users WHERE email IN (${emailPlaceholders})`, userEmails
        );
        for (const row of rows) userIds.push(String(row.id));
      });
    }
    const uniqueUserIds = [...new Set(userIds)];
    const allBookingIds = new Set(bookingIds.map(String));
    if (uniqueUserIds.length > 0) {
      const userPlaceholders = uniqueUserIds.map(() => '?').join(', ');
      await cleanup(async () => {
        const [rows] = await pool.execute(
          `SELECT id FROM bookings WHERE user_id IN (${userPlaceholders})`, uniqueUserIds
        );
        for (const row of rows) allBookingIds.add(String(row.id));
      });
    }
    const cleanupBookingIds = [...allBookingIds];
    if (cleanupBookingIds.length > 0) {
      const bookingPlaceholders = cleanupBookingIds.map(() => '?').join(', ');
      let paymentIds = [];
      await cleanup(async () => {
        const [rows] = await pool.execute(
          `SELECT id FROM payments WHERE booking_id IN (${bookingPlaceholders})`, cleanupBookingIds
        );
        paymentIds = rows.map((row) => String(row.id));
      });
      await cleanup(() => pool.execute(
        `DELETE FROM booking_tickets WHERE booking_id IN (${bookingPlaceholders})`, cleanupBookingIds
      ));
      if (paymentIds.length > 0) {
        const paymentPlaceholders = paymentIds.map(() => '?').join(', ');
        await cleanup(() => pool.execute(
          `DELETE FROM payment_attempts WHERE payment_id IN (${paymentPlaceholders})`, paymentIds
        ));
      }
      await cleanup(() => pool.execute(
        `DELETE FROM booking_slots WHERE booking_id IN (${bookingPlaceholders})`, cleanupBookingIds
      ));
      await cleanup(() => pool.execute(
        `UPDATE time_slots SET current_booking_id = NULL, lock_expires_at = NULL
         WHERE current_booking_id IN (${bookingPlaceholders})`, cleanupBookingIds
      ));
      await cleanup(() => pool.execute(
        `DELETE FROM payments WHERE booking_id IN (${bookingPlaceholders})`, cleanupBookingIds
      ));
      await cleanup(() => pool.execute(
        `DELETE FROM bookings WHERE id IN (${bookingPlaceholders})`, cleanupBookingIds
      ));
    }
    if (courtId) await cleanup(() => pool.execute('DELETE FROM time_slots WHERE court_id = ?', [courtId]));
    if (facilityId) await cleanup(() => pool.execute('DELETE FROM facilities WHERE id = ?', [facilityId]));
    if (uniqueUserIds.length > 0) {
      const userPlaceholders = uniqueUserIds.map(() => '?').join(', ');
      await cleanup(() => pool.execute(
        `DELETE FROM user_sessions WHERE user_id IN (${userPlaceholders})`, uniqueUserIds
      ));
      await cleanup(() => pool.execute(
        `DELETE FROM users WHERE id IN (${userPlaceholders})`, uniqueUserIds
      ));
    }
    if (userEmails.length > 0) {
      const emailPlaceholders = userEmails.map(() => '?').join(', ');
      await cleanup(() => pool.execute(
        `DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE email IN (${emailPlaceholders}))`,
        userEmails
      ));
      await cleanup(() => pool.execute(
        `DELETE FROM users WHERE email IN (${emailPlaceholders})`, userEmails
      ));
    }
    await cleanup(() => closePool());
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'Payment integration test cleanup failed.');
    }
  }
});
