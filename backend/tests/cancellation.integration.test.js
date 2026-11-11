'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

if (process.env.APP_ENV !== 'test' || process.env.DB_NAME !== 'sportbooking_test') {
  throw new Error('Cancellation integration tests require APP_ENV=test and DB_NAME=sportbooking_test.');
}

const { closePool, getPool } = require('../src/config/database');
const { createApp } = require('../src/app');

function localSlot(hoursAhead, minuteOffset = 0) {
  const start = new Date(Math.ceil((Date.now() + hoursAhead * 3_600_000) / 60_000) * 60_000
    + minuteOffset * 60_000);
  let localStart = new Date(start.getTime() + 7 * 3_600_000);
  let localEnd = new Date(localStart.getTime() + 3_600_000);
  let endsAt = localEnd.toISOString().slice(11, 19);
  if (localEnd.toISOString().slice(0, 10) !== localStart.toISOString().slice(0, 10)) {
    const localDate = localStart.toISOString().slice(0, 10);
    if (hoursAhead > 0) {
      localStart = new Date(`${localDate}T23:00:00.000Z`);
      localStart.setUTCMinutes(minuteOffset);
      endsAt = '24:00:00';
    } else if (hoursAhead >= -1) {
      const currentLocal = new Date(Date.now() + 7 * 3_600_000);
      const currentDate = currentLocal.toISOString().slice(0, 10);
      if (currentLocal.getUTCHours() >= 23) {
        localStart = new Date(`${currentDate}T23:00:00.000Z`);
        localStart.setUTCMinutes(minuteOffset);
        endsAt = '24:00:00';
      } else {
        localStart = new Date(`${currentDate}T00:00:00.000Z`);
        localStart.setUTCMinutes(minuteOffset);
        localEnd = new Date(localStart.getTime() + 3_600_000);
        endsAt = localEnd.toISOString().slice(11, 19);
      }
    } else {
      localStart = new Date(`${localDate}T22:00:00.000Z`);
      localStart.setUTCMinutes(minuteOffset);
      localEnd = new Date(localStart.getTime() + 3_600_000);
      endsAt = localEnd.toISOString().slice(11, 19);
    }
  }
  return {
    serviceDate: localStart.toISOString().slice(0, 10),
    startsAt: localStart.toISOString().slice(11, 19),
    endsAt,
    hoursAhead: (localStart.getTime() - 7 * 3_600_000 - Date.now()) / 3_600_000
  };
}

function cookiePair(setCookie) {
  assert.ok(setCookie, 'Login must set a session cookie.');
  return setCookie.split(';', 1)[0];
}

async function postJson(baseUrl, path, body, cookie) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie
    },
    body: JSON.stringify(body)
  });
}

test('cancellation and refunds work through HTTP on sportbooking_test', async (t) => {
  const pool = getPool();
  const userIds = [];
  const userEmails = [];
  const bookingIds = [];
  const timeSlotIds = [];
  let facilityId;
  let courtId;
  let server;
  let app;
  let summaryExpected = 0n;

  try {
    const [databaseRows] = await pool.execute('SELECT DATABASE() AS database_name');
    assert.equal(databaseRows[0].database_name, 'sportbooking_test');
    const [columnRows] = await pool.execute(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = ? AND table_name = ? AND column_name IN (?, ?)`,
      ['sportbooking_test', 'bookings', 'cancelled_by', 'cancellation_reason']
    );
    assert.equal(columnRows.length, 2, 'migration 006 must be applied to sportbooking_test');

    app = createApp({ pool });
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const password = crypto.randomBytes(24).toString('base64url');

    async function createUser() {
      const email = `cancel-${crypto.randomUUID()}@example.test`;
      userEmails.push(email);
      const registration = await postJson(baseUrl, '/api/v1/auth/register', {
        fullName: 'Cancellation Integration Test',
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
      return { id: String(user.id), cookie: cookiePair(login.headers.get('set-cookie')) };
    }

    const owner = await createUser();
    const other = await createUser();
    const suffix = crypto.randomUUID();
    const [facilityResult] = await pool.execute(
      `INSERT INTO facilities
         (name, address, district, amenities, is_active, is_seed, created_at, updated_at)
       VALUES (?, ?, ?, ?, TRUE, FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [`Cancellation test ${suffix}`, 'Integration test address', 'Test district', '[]']
    );
    facilityId = String(facilityResult.insertId);
    const [courtResult] = await pool.execute(
      `INSERT INTO courts
         (facility_id, name, sport_type, price_normal, price_peak, is_active, is_seed,
          created_at, updated_at)
       VALUES (?, ?, 'BADMINTON', 120000, 150000, TRUE, FALSE,
               UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [facilityId, `Cancellation court ${suffix}`]
    );
    courtId = String(courtResult.insertId);

    async function addBooking({
      status = 'CONFIRMED',
      hoursAhead,
      minuteOffset = 0,
      paymentStatus = 'PAID',
      paidAmount = '101001',
      paymentOption = 'DEPOSIT_50',
      lockExpired = false,
      matchPreference = null
    } = {}) {
      let slot = null;
      if (hoursAhead !== undefined) {
        slot = localSlot(hoursAhead, minuteOffset);
        const [slotResult] = await pool.execute(
          `INSERT INTO time_slots
             (court_id, service_date, starts_at, ends_at, price, status,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, 120000, 'AVAILABLE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [courtId, slot.serviceDate, slot.startsAt, slot.endsAt]
        );
        timeSlotIds.push(String(slotResult.insertId));
      }

      const [bookingResult] = await pool.execute(
        `INSERT INTO bookings
           (booking_code, user_id, status, total_amount, match_preference, lock_expires_at,
            created_at, updated_at)
         VALUES (?, ?, ?, 300000, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [
          `SPB-CANCEL-${crypto.randomUUID()}`,
          owner.id,
          status,
          matchPreference ? JSON.stringify(matchPreference) : null,
          status === 'PENDING'
            ? lockExpired
              ? new Date(Date.now() - 60_000)
              : new Date(Date.now() + 10 * 60_000)
            : null
        ]
      );
      const bookingId = String(bookingResult.insertId);
      bookingIds.push(bookingId);
      if (slot) {
        await pool.execute(
          `INSERT INTO booking_slots
             (booking_id, time_slot_id, court_id, price_at_booking, created_at)
           VALUES (?, ?, ?, 120000, UTC_TIMESTAMP(3))`,
          [bookingId, String(timeSlotIds[timeSlotIds.length - 1]), courtId]
        );
        await pool.execute(
          `UPDATE time_slots
           SET status = ?, current_booking_id = ?,
               lock_expires_at = CASE WHEN ? = ? THEN ? ELSE NULL END,
               updated_at = UTC_TIMESTAMP(3)
           WHERE id = ?`,
          [
            status === 'PENDING' ? 'LOCKED' : 'BOOKED',
            bookingId,
            status,
            'PENDING',
            lockExpired ? new Date(Date.now() - 60_000) : new Date(Date.now() + 10 * 60_000),
            String(timeSlotIds[timeSlotIds.length - 1])
          ]
        );
      }
      await pool.execute(
        `INSERT INTO payments
           (booking_id, status, amount_due, paid_amount, refunded_amount, payment_option,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [bookingId, paymentStatus, paidAmount, paidAmount, paymentOption]
      );
      if (paymentStatus === 'PAID') summaryExpected += BigInt(paidAmount);
      return { bookingId, slot };
    }

    const cases = [];
    for (const [hoursAhead, percent] of [[25, 100], [10, 50], [3, 0]]) {
      for (const [paymentOption, paidAmount] of [
        ['DEPOSIT_50', '101001'],
        ['FULL', '203005']
      ]) {
        const booking = await addBooking({
          hoursAhead,
          minuteOffset: cases.length,
          paidAmount,
          paymentOption,
          matchPreference: cases.length === 0 ? { mode: 'RANDOM' } : null
        });
        cases.push({
          ...booking,
          hoursAhead: booking.slot.hoursAhead,
          percent,
          paidAmount
        });
      }
    }

    const activeGame = await addBooking({ hoursAhead: -0.5 });
    const pending = await addBooking({
      status: 'PENDING',
      paymentStatus: 'PENDING',
      paidAmount: '0',
      hoursAhead: 30
    });
    const expiredPending = await addBooking({
      status: 'PENDING',
      paymentStatus: 'PENDING',
      paidAmount: '0',
      hoursAhead: 32,
      lockExpired: true
    });
    const completed = await addBooking({ status: 'COMPLETED', hoursAhead: -3 });
    const cancelled = await addBooking({ status: 'CANCELLED', hoursAhead: -5 });
    const expired = await addBooking({ status: 'EXPIRED', hoursAhead: 36 });
    void completed;

    await t.test('preview and cancel calculate three refund tiers for deposits and full payments', async () => {
      for (const item of cases) {
        const previewResponse = await fetch(
          `${baseUrl}/api/v1/bookings/${item.bookingId}/refund-preview`,
          { headers: { cookie: owner.cookie } }
        );
        assert.equal(
          previewResponse.status,
          200,
          JSON.stringify({ hoursAhead: item.hoursAhead, slot: item.slot, error: await previewResponse.clone().text() })
        );
        assert.match(previewResponse.headers.get('cache-control'), /no-store/);
        const preview = await previewResponse.json();
        const expectedRefund = item.percent === 100
          ? BigInt(item.paidAmount)
          : item.percent === 50 ? BigInt(item.paidAmount) / 2n : 0n;
        assert.equal(preview.refund_percent, item.percent);
        assert.equal(preview.refund_amount, expectedRefund.toString());
        assert.equal(preview.paid_amount, item.paidAmount);
        assert.ok(Number.isSafeInteger(preview.seconds_until_start));
        assert.match(preview.server_time, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
        assert.ok(Math.abs(preview.hours_until_start - item.hoursAhead) < 0.2);
        assert.match(preview.message, /hoàn|không hoàn/);

        const stalePreviewResponse = await postJson(
          baseUrl,
          `/api/v1/bookings/${item.bookingId}/cancel`,
          {
            expected_refund_amount: '0',
            expected_refund_percent: item.percent === 0 ? 50 : 0
          },
          owner.cookie
        );
        assert.equal(stalePreviewResponse.status, 409);
        const stalePreview = await stalePreviewResponse.json();
        assert.equal(stalePreview.error.code, 'REFUND_PREVIEW_CHANGED');
        assert.equal(stalePreview.error.details.refund_preview.refund_amount, preview.refund_amount);
        const [unchangedRows] = await pool.execute(
          `SELECT b.status, p.status AS payment_status, p.refunded_amount
           FROM bookings b
           INNER JOIN payments p ON p.booking_id = b.id
           WHERE b.id = ?`,
          [item.bookingId]
        );
        assert.equal(unchangedRows[0].status, 'CONFIRMED');
        assert.equal(unchangedRows[0].payment_status, 'PAID');
        assert.equal(unchangedRows[0].refunded_amount, '0');

        const cancelResponse = await postJson(
          baseUrl,
          `/api/v1/bookings/${item.bookingId}/cancel`,
          {
            cancellation_reason: 'Đổi kế hoạch',
            expected_refund_amount: preview.refund_amount,
            expected_refund_percent: preview.refund_percent
          },
          owner.cookie
        );
        assert.equal(cancelResponse.status, 200);
        const cancelledResult = await cancelResponse.json();
        assert.equal(cancelledResult.status, 'CANCELLED');
        assert.equal(cancelledResult.refund_percent, preview.refund_percent);
        assert.equal(cancelledResult.refunded_amount, preview.refund_amount);

        const [paymentRows] = await pool.execute(
          `SELECT status, paid_amount, refunded_amount
           FROM payments WHERE booking_id = ?`,
          [item.bookingId]
        );
        assert.equal(paymentRows[0].refunded_amount, preview.refund_amount);
        assert.equal(paymentRows[0].status, item.percent === 0 ? 'PAID' : 'REFUNDED');
        summaryExpected -= expectedRefund;
      }
    });

    await t.test('ownership, duplicate cancellation, slot release, and match preference cleanup', async () => {
      const item = cases[0];
      const otherPreview = await fetch(
        `${baseUrl}/api/v1/bookings/${item.bookingId}/refund-preview`,
        { headers: { cookie: other.cookie } }
      );
      assert.equal(otherPreview.status, 404);
      const otherCancel = await postJson(
        baseUrl,
        `/api/v1/bookings/${item.bookingId}/cancel`,
        {},
        other.cookie
      );
      assert.equal(otherCancel.status, 404);

      const repeated = await postJson(
        baseUrl,
        `/api/v1/bookings/${item.bookingId}/cancel`,
        {},
        owner.cookie
      );
      assert.equal(repeated.status, 409);

      const [stateRows] = await pool.execute(
        `SELECT b.status, b.cancelled_by, b.cancellation_reason, b.match_preference,
                ts.status AS slot_status, ts.current_booking_id
         FROM bookings AS b
         INNER JOIN booking_slots AS bs ON bs.booking_id = b.id
         INNER JOIN time_slots AS ts ON ts.id = bs.time_slot_id
         WHERE b.id = ?`,
        [item.bookingId]
      );
      assert.equal(stateRows[0].status, 'CANCELLED');
      assert.equal(stateRows[0].cancelled_by, 'USER');
      assert.equal(stateRows[0].cancellation_reason, 'Đổi kế hoạch');
      assert.equal(stateRows[0].match_preference, null);
      assert.equal(stateRows[0].slot_status, 'AVAILABLE');
      assert.equal(stateRows[0].current_booking_id, null);

      const rescheduled = await postJson(
        baseUrl,
        '/api/v1/bookings',
        { slot_ids: [String(timeSlotIds[0])], payment_option: 'DEPOSIT_50' },
        other.cookie
      );
      assert.equal(rescheduled.status, 201);
      const rebooking = await rescheduled.json();
      bookingIds.push(String(rebooking.booking_id));
    });

    await t.test('in-progress, terminal, and expired bookings reject cancellation with 409', async () => {
      for (const bookingId of [activeGame.bookingId, completed.bookingId, cancelled.bookingId, expired.bookingId]) {
        const response = await postJson(
          baseUrl,
          `/api/v1/bookings/${bookingId}/cancel`,
          {},
          owner.cookie
        );
        assert.equal(response.status, 409);
      }
      const expiredResponse = await postJson(
        baseUrl,
        `/api/v1/bookings/${expiredPending.bookingId}/cancel`,
        {},
        owner.cookie
      );
      assert.equal(expiredResponse.status, 409);
      const [expiredRows] = await pool.execute(
        `SELECT b.status, ts.status AS slot_status
         FROM bookings b
         INNER JOIN booking_slots bs ON bs.booking_id = b.id
         INNER JOIN time_slots ts ON ts.id = bs.time_slot_id
         WHERE b.id = ?`,
        [expiredPending.bookingId]
      );
      assert.equal(expiredRows[0].status, 'EXPIRED');
      assert.equal(expiredRows[0].slot_status, 'AVAILABLE');
    });

    await t.test('unpaid PENDING cancellation remains unpaid and the completion job is idempotent', async () => {
      const pendingResponse = await postJson(
        baseUrl,
        `/api/v1/bookings/${pending.bookingId}/cancel`,
        {},
        owner.cookie
      );
      assert.equal(pendingResponse.status, 200);
      assert.equal((await pendingResponse.json()).refunded_amount, '0');
      const [paymentRows] = await pool.execute(
        'SELECT status, refunded_amount FROM payments WHERE booking_id = ?',
        [pending.bookingId]
      );
      assert.equal(paymentRows[0].status, 'PENDING');
      assert.equal(paymentRows[0].refunded_amount, '0');

      const pastBooking = await addBooking({
        status: 'CONFIRMED',
        hoursAhead: -4,
        paidAmount: '0'
      });
      const [pastSlotRows] = await pool.execute(
        `SELECT CONCAT(DATE_FORMAT(ts.service_date, '%Y-%m-%d'), 'T',
                       TIME_FORMAT(ts.starts_at, '%H:%i:%s')) AS slot_start,
                CONCAT(DATE_FORMAT(ts.service_date, '%Y-%m-%d'), 'T',
                       TIME_FORMAT(ts.ends_at, '%H:%i:%s')) AS slot_end
         FROM booking_slots bs
         INNER JOIN time_slots ts ON ts.id = bs.time_slot_id
         WHERE bs.booking_id = ?`,
        [pastBooking.bookingId]
      );
      assert.equal(pastSlotRows.length, 1);
      assert.ok(pastSlotRows[0].slot_end > pastSlotRows[0].slot_start, JSON.stringify(pastSlotRows[0]));
      const before = await app.locals.bookingsService.completeDueBookings();
      assert.ok(before >= 1);
      const [completedRows] = await pool.execute(
        'SELECT status FROM bookings WHERE id = ?',
        [pastBooking.bookingId]
      );
      assert.equal(completedRows[0].status, 'COMPLETED');
      const [cancelledRows] = await pool.execute(
        'SELECT status FROM bookings WHERE id = ?',
        [cancelled.bookingId]
      );
      assert.equal(cancelledRows[0].status, 'CANCELLED');
      const after = await app.locals.bookingsService.completeDueBookings();
      assert.equal(after, 0);
    });

    await t.test('summary total_spent is reduced by the refunds', async () => {
      const response = await fetch(`${baseUrl}/api/v1/bookings/summary`, {
        headers: { cookie: owner.cookie }
      });
      assert.equal(response.status, 200);
      const summary = await response.json();
      assert.equal(summary.total_spent, summaryExpected.toString());
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

    const uniqueBookingIds = [...new Set(bookingIds)];
    if (uniqueBookingIds.length > 0) {
      const bookingPlaceholders = uniqueBookingIds.map(() => '?').join(', ');
      await cleanup(() => pool.execute(
        `DELETE FROM booking_tickets WHERE booking_id IN (${bookingPlaceholders})`,
        uniqueBookingIds
      ));
      await cleanup(() => pool.execute(
        `DELETE pa FROM payment_attempts pa
         INNER JOIN payments p ON p.id = pa.payment_id
         WHERE p.booking_id IN (${bookingPlaceholders})`,
        uniqueBookingIds
      ));
      await cleanup(() => pool.execute(
        `DELETE FROM booking_slots WHERE booking_id IN (${bookingPlaceholders})`,
        uniqueBookingIds
      ));
      await cleanup(() => pool.execute(
        `UPDATE time_slots SET current_booking_id = NULL, lock_expires_at = NULL
         WHERE current_booking_id IN (${bookingPlaceholders})`,
        uniqueBookingIds
      ));
      await cleanup(() => pool.execute(
        `DELETE FROM payments WHERE booking_id IN (${bookingPlaceholders})`,
        uniqueBookingIds
      ));
      await cleanup(() => pool.execute(
        `DELETE FROM bookings WHERE id IN (${bookingPlaceholders})`,
        uniqueBookingIds
      ));
    }
    if (timeSlotIds.length > 0) {
      const slotPlaceholders = timeSlotIds.map(() => '?').join(', ');
      await cleanup(() => pool.execute(
        `DELETE FROM time_slots WHERE id IN (${slotPlaceholders})`,
        timeSlotIds
      ));
    }
    if (courtId) await cleanup(() => pool.execute('DELETE FROM courts WHERE id = ?', [courtId]));
    if (facilityId) await cleanup(() => pool.execute('DELETE FROM facilities WHERE id = ?', [facilityId]));
    if (userIds.length > 0) {
      const userPlaceholders = userIds.map(() => '?').join(', ');
      await cleanup(() => pool.execute(
        `DELETE FROM user_sessions WHERE user_id IN (${userPlaceholders})`,
        userIds
      ));
    }
    if (userEmails.length > 0) {
      const emailPlaceholders = userEmails.map(() => '?').join(', ');
      await cleanup(() => pool.execute(
        `DELETE FROM user_sessions WHERE user_id IN
         (SELECT id FROM users WHERE email IN (${emailPlaceholders}))`,
        userEmails
      ));
      await cleanup(() => pool.execute(
        `DELETE FROM users WHERE email IN (${emailPlaceholders})`,
        userEmails
      ));
    }
    await cleanup(() => closePool());
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'Cancellation integration test cleanup failed.');
    }
  }
});
