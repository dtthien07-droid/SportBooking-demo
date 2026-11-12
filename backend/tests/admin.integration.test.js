'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

if (process.env.APP_ENV !== 'test' || process.env.DB_NAME !== 'sportbooking_test') {
  throw new Error('Admin integration tests require APP_ENV=test and DB_NAME=sportbooking_test.');
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

function slotTime({ active = false, dayOffset = 1, hourOffset = 0 }) {
  const localNow = new Date(Date.now() + 7 * 60 * 60 * 1000);
  const date = new Date(Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate()
  ));
  let hour;
  if (active) {
    date.setUTCDate(localNow.getUTCDate());
    hour = localNow.getUTCHours();
  } else {
    date.setUTCDate(date.getUTCDate() + dayOffset);
    hour = (10 + hourOffset) % 22;
  }
  return {
    serviceDate: date.toISOString().slice(0, 10),
    startsAt: `${String(hour).padStart(2, '0')}:00:00`,
    endsAt: hour === 23
      ? '24:00:00'
      : `${String(hour + 1).padStart(2, '0')}:00:00`
  };
}

function timestampDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

test('admin APIs enforce roles, cancel incidents transactionally, and report dashboard metrics on sportbooking_test', async (t) => {
  const pool = getPool();
  const userIds = [];
  const userEmails = [];
  const bookingIds = [];
  const slotIds = [];
  const triggerNames = [];
  let facilityId;
  let courtId;
  let server;
  const cleanupErrors = [];

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

    const app = createApp({ pool });
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const password = crypto.randomBytes(24).toString('base64url');

    async function createUser(name, role = 'USER') {
      const email = `admin-${crypto.randomUUID()}@example.test`;
      userEmails.push(email);
      const registration = await requestJson(baseUrl, '/api/v1/auth/register', 'POST', {
        fullName: name,
        email,
        phone: `+84${String(crypto.randomInt(100000000, 1000000000))}`,
        password,
        termsAccepted: true
      });
      assert.equal(registration.status, 201);
      const { user } = await registration.json();
      userIds.push(String(user.id));
      if (role === 'ADMIN') {
        await pool.execute('UPDATE users SET role = ? WHERE id = ?', [role, user.id]);
      }
      const login = await requestJson(
        baseUrl,
        '/api/v1/auth/login',
        'POST',
        { email, password }
      );
      assert.equal(login.status, 200);
      return {
        id: String(user.id),
        email,
        fullName: name,
        cookie: cookiePair(login.headers.get('set-cookie'))
      };
    }

    const admin = await createUser('Admin Integration Test', 'ADMIN');
    const owner = await createUser('Booking Owner Integration Test');
    const ordinaryUser = await createUser('Ordinary Integration Test');
    const suffix = crypto.randomUUID();
    const [facilityResult] = await pool.execute(
      `INSERT INTO facilities
         (name, address, district, amenities, is_active, is_seed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [`Admin test ${suffix}`, 'Integration test address', 'Test district', '[]', true, false]
    );
    facilityId = String(facilityResult.insertId);
    const [courtResult] = await pool.execute(
      `INSERT INTO courts
         (facility_id, name, sport_type, price_normal, price_peak, is_active, is_seed,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [facilityId, `Admin court ${suffix}`, 'BADMINTON', 120000, 150000, true, false]
    );
    courtId = String(courtResult.insertId);

    async function addBooking({
      status,
      paymentStatus = 'PENDING',
      paidAmount = '0',
      refundedAmount = '0',
      paidAt = null,
      refundedAt = null,
      createdAt = new Date(),
      withSlot = false,
      activeSlot = false,
      dayOffset = 1,
      hourOffset = 0,
      expiredLock = false
    }) {
      let slot = null;
      if (withSlot) {
        slot = slotTime({ active: activeSlot, dayOffset, hourOffset });
        const [slotResult] = await pool.execute(
          `INSERT INTO time_slots
             (court_id, service_date, starts_at, ends_at, price, status,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [courtId, slot.serviceDate, slot.startsAt, slot.endsAt, 120000, 'AVAILABLE']
        );
        slotIds.push(String(slotResult.insertId));
      }

      const bookingCode = `SPB-ADM-${crypto.randomUUID().replaceAll('-', '')}`;
      const lockExpiresAt = status === 'PENDING'
        ? new Date(Date.now() + (expiredLock ? -60_000 : 10 * 60_000))
        : null;
      const [bookingResult] = await pool.execute(
        `INSERT INTO bookings
           (booking_code, user_id, status, total_amount, match_preference, lock_expires_at,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3))`,
        [bookingCode, owner.id, status, '120000', null, lockExpiresAt, createdAt]
      );
      const bookingId = String(bookingResult.insertId);
      bookingIds.push(bookingId);

      if (slot) {
        await pool.execute(
          `INSERT INTO booking_slots
             (booking_id, time_slot_id, court_id, price_at_booking, created_at)
           VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`,
          [bookingId, slotIds[slotIds.length - 1], courtId, '120000']
        );
        await pool.execute(
          `UPDATE time_slots
           SET status = ?, current_booking_id = ?, lock_expires_at = ?, updated_at = UTC_TIMESTAMP(3)
           WHERE id = ?`,
          [
            status === 'PENDING' ? 'LOCKED' : 'BOOKED',
            bookingId,
            status === 'PENDING' ? lockExpiresAt : null,
            slotIds[slotIds.length - 1]
          ]
        );
      }

      await pool.execute(
        `INSERT INTO payments
           (booking_id, status, amount_due, paid_amount, refunded_amount, payment_option,
            paid_at, refunded_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [bookingId, paymentStatus, paidAmount, paidAmount, refundedAmount, 'FULL', paidAt, refundedAt]
      );
      return { id: bookingId, code: bookingCode, slotId: slot ? slotIds[slotIds.length - 1] : null };
    }

    const inProgressBooking = await addBooking({
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      paidAmount: '45123',
      paidAt: new Date(),
      withSlot: true,
      activeSlot: true
    });
    const pendingBooking = await addBooking({
      status: 'PENDING',
      withSlot: true,
      dayOffset: 2,
      hourOffset: 1
    });
    const paymentRollbackBooking = await addBooking({
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      paidAmount: '33000',
      paidAt: new Date(),
      withSlot: true,
      dayOffset: 3
    });
    const notificationRollbackBooking = await addBooking({
      status: 'CONFIRMED',
      paymentStatus: 'PAID',
      paidAmount: '22000',
      paidAt: new Date(),
      withSlot: true,
      dayOffset: 4
    });
    const expiredPendingBooking = await addBooking({
      status: 'PENDING',
      withSlot: true,
      dayOffset: 5,
      expiredLock: true
    });
    const completedBooking = await addBooking({ status: 'COMPLETED' });
    const expiredBooking = await addBooking({ status: 'EXPIRED' });
    const cancelledBooking = await addBooking({ status: 'CANCELLED' });

    async function snapshotBooking(bookingId) {
      const [bookingRows] = await pool.execute(
        `SELECT b.status, b.cancelled_by, b.cancellation_reason,
                p.status AS payment_status, p.paid_amount, p.refunded_amount,
                p.refunded_at
         FROM bookings AS b
         INNER JOIN payments AS p ON p.booking_id = b.id
         WHERE b.id = ?`,
        [bookingId]
      );
      const [slotRows] = await pool.execute(
        `SELECT ts.status, ts.current_booking_id, ts.lock_expires_at
         FROM booking_slots AS bs
         INNER JOIN time_slots AS ts ON ts.id = bs.time_slot_id
         WHERE bs.booking_id = ?
         ORDER BY ts.id`,
        [bookingId]
      );
      const [notificationRows] = await pool.execute(
        `SELECT category, title, body
         FROM notifications
         WHERE resource_type = ? AND resource_id = ?
         ORDER BY id`,
        ['BOOKING', bookingId]
      );
      return JSON.stringify({ booking: bookingRows[0], slots: slotRows, notifications: notificationRows });
    }

    await t.test('ordinary users receive 403 for every admin route without changing data', async () => {
      const before = await snapshotBooking(inProgressBooking.id);
      const responseRows = await Promise.all([
        requestJson(baseUrl, '/api/v1/admin/bookings', 'GET', undefined, ordinaryUser.cookie),
        requestJson(baseUrl, '/api/v1/admin/dashboard?period=today', 'GET', undefined, ordinaryUser.cookie),
        requestJson(
          baseUrl,
          `/api/v1/admin/bookings/${inProgressBooking.id}/incident-cancellation`,
          'POST',
          { cancellation_reason: 'User must not cancel incidents' },
          ordinaryUser.cookie
        )
      ]);
      assert.deepEqual(responseRows.map((response) => response.status), [403, 403, 403]);
      assert.equal(await snapshotBooking(inProgressBooking.id), before);

      const unauthenticated = await requestJson(
        baseUrl,
        '/api/v1/admin/dashboard?period=today',
        'GET'
      );
      assert.equal(unauthenticated.status, 401);
    });

    await t.test('admin booking list filters by status and code, paginates, and includes owner and slots', async () => {
      const response = await requestJson(
        baseUrl,
        `/api/v1/admin/bookings?status=CONFIRMED&q=${encodeURIComponent(inProgressBooking.code)}&page=1&page_size=1`,
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      const result = await response.json();
      assert.equal(result.bookings.length, 1);
      assert.equal(result.pagination.total, 1);
      assert.equal(result.pagination.page, 1);
      assert.equal(result.pagination.page_size, 1);
      assert.equal(result.bookings[0].booking_id, inProgressBooking.id);
      assert.equal(result.bookings[0].owner.full_name, owner.fullName);
      assert.equal(result.bookings[0].owner.email, owner.email);
      assert.ok(result.bookings[0].owner.phone);
      assert.equal(result.bookings[0].slots.length, 1);
      assert.equal(result.bookings[0].slots[0].time_slot_id, inProgressBooking.slotId);

      const firstPage = await requestJson(
        baseUrl,
        '/api/v1/admin/bookings?page=1&page_size=1',
        'GET',
        undefined,
        admin.cookie
      );
      const firstPageResult = await firstPage.json();
      assert.equal(firstPageResult.bookings.length, 1);
      assert.ok(firstPageResult.pagination.total_pages > 1);
      for (const query of [
        '?status=UNKNOWN',
        '?page=0',
        '?page_size=51'
      ]) {
        const invalid = await requestJson(
          baseUrl,
          `/api/v1/admin/bookings${query}`,
          'GET',
          undefined,
          admin.cookie
        );
        assert.equal(invalid.status, 400, query);
      }
      const longSearch = await requestJson(
        baseUrl,
        `/api/v1/admin/bookings?q=${'x'.repeat(101)}`,
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal(longSearch.status, 400);
    });

    await t.test('incident cancellation validates reason and refunds a confirmed booking in progress once', async () => {
      for (const body of [
        {},
        { cancellation_reason: '   ' },
        { cancellation_reason: 'x'.repeat(501) }
      ]) {
        const invalid = await requestJson(
          baseUrl,
          `/api/v1/admin/bookings/${inProgressBooking.id}/incident-cancellation`,
          'POST',
          body,
          admin.cookie
        );
        assert.equal(invalid.status, 400);
      }

      const before = await snapshotBooking(inProgressBooking.id);
      const responses = await Promise.all([
        requestJson(
          baseUrl,
          `/api/v1/admin/bookings/${inProgressBooking.id}/incident-cancellation`,
          'POST',
          { cancellation_reason: '  Sự cố trong trận  ' },
          admin.cookie
        ),
        requestJson(
          baseUrl,
          `/api/v1/admin/bookings/${inProgressBooking.id}/incident-cancellation`,
          'POST',
          { cancellation_reason: 'Yêu cầu lặp' },
          admin.cookie
        )
      ]);
      const statuses = responses.map((response) => response.status).sort();
      assert.deepEqual(statuses, [200, 409]);
      const successfulResponse = responses.find((response) => response.status === 200);
      assert.equal(successfulResponse.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await successfulResponse.json(), {
        booking_id: inProgressBooking.id,
        status: 'CANCELLED',
        cancelled_by: 'ADMIN',
        refund_percent: 100,
        paid_amount: '45123',
        refunded_amount: '45123'
      });

      const [stateRows] = await pool.execute(
        `SELECT b.status, b.cancelled_by, b.cancellation_reason,
                p.status AS payment_status, p.paid_amount, p.refunded_amount,
                p.refunded_at, ts.status AS slot_status, ts.current_booking_id
         FROM bookings AS b
         INNER JOIN payments AS p ON p.booking_id = b.id
         INNER JOIN booking_slots AS bs ON bs.booking_id = b.id
         INNER JOIN time_slots AS ts ON ts.id = bs.time_slot_id
         WHERE b.id = ?`,
        [inProgressBooking.id]
      );
      assert.equal(stateRows[0].status, 'CANCELLED');
      assert.equal(stateRows[0].cancelled_by, 'ADMIN');
      assert.equal(stateRows[0].cancellation_reason, 'Sự cố trong trận');
      assert.equal(stateRows[0].payment_status, 'REFUNDED');
      assert.equal(String(stateRows[0].refunded_amount), '45123');
      assert.ok(stateRows[0].refunded_at);
      assert.equal(stateRows[0].slot_status, 'AVAILABLE');
      assert.equal(stateRows[0].current_booking_id, null);

      const [notificationRows] = await pool.execute(
        `SELECT category, title
         FROM notifications
         WHERE resource_type = ? AND resource_id = ?
         ORDER BY id`,
        ['BOOKING', inProgressBooking.id]
      );
      assert.deepEqual(notificationRows.map((row) => row.category), ['BOOKING_HOLD', 'PAYMENT']);
      const duplicate = await requestJson(
        baseUrl,
        `/api/v1/admin/bookings/${inProgressBooking.id}/incident-cancellation`,
        'POST',
        { cancellation_reason: 'Lặp lại sau hoàn tất' },
        admin.cookie
      );
      assert.equal(duplicate.status, 409);
      assert.notEqual(await snapshotBooking(inProgressBooking.id), before);
      assert.equal((await snapshotBooking(inProgressBooking.id)).includes('Lặp lại sau hoàn tất'), false);
    });

    await t.test('incident cancellation of a pending booking refunds zero and writes one booking notification', async () => {
      const response = await requestJson(
        baseUrl,
        `/api/v1/admin/bookings/${pendingBooking.id}/incident-cancellation`,
        'POST',
        { cancellation_reason: 'Sân đóng cửa do sự cố' },
        admin.cookie
      );
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        booking_id: pendingBooking.id,
        status: 'CANCELLED',
        cancelled_by: 'ADMIN',
        refund_percent: 0,
        paid_amount: '0',
        refunded_amount: '0'
      });
      const [paymentRows] = await pool.execute(
        `SELECT status, paid_amount, refunded_amount
         FROM payments
         WHERE booking_id = ?`,
        [pendingBooking.id]
      );
      assert.equal(paymentRows[0].status, 'PENDING');
      assert.equal(String(paymentRows[0].paid_amount), '0');
      assert.equal(String(paymentRows[0].refunded_amount), '0');
      const [notificationRows] = await pool.execute(
        `SELECT category, title
         FROM notifications
         WHERE resource_type = ? AND resource_id = ?`,
        ['BOOKING', pendingBooking.id]
      );
      assert.deepEqual(notificationRows, [{
        category: 'BOOKING_HOLD',
        title: 'Đơn đã bị hủy do sự cố'
      }]);
      const [slotRows] = await pool.execute(
        `SELECT ts.status, ts.current_booking_id
         FROM booking_slots AS bs
         INNER JOIN time_slots AS ts ON ts.id = bs.time_slot_id
         WHERE bs.booking_id = ?`,
        [pendingBooking.id]
      );
      assert.equal(slotRows[0].status, 'AVAILABLE');
      assert.equal(slotRows[0].current_booking_id, null);
    });

    await t.test('expired pending and terminal booking states return 409 without changes', async () => {
      for (const booking of [completedBooking, expiredBooking, cancelledBooking, expiredPendingBooking]) {
        const before = await snapshotBooking(booking.id);
        const response = await requestJson(
          baseUrl,
          `/api/v1/admin/bookings/${booking.id}/incident-cancellation`,
          'POST',
          { cancellation_reason: 'Sự cố' },
          admin.cookie
        );
        assert.equal(response.status, 409, booking.id);
        assert.equal(await snapshotBooking(booking.id), before);
      }
    });

    await t.test('payment failures roll back cancellation, slots, and notifications', async () => {
      const triggerName = `trg_admin_payment_${crypto.randomUUID().replaceAll('-', '')}`;
      triggerNames.push(triggerName);
      await pool.query(
        `CREATE TRIGGER ${triggerName}
         BEFORE UPDATE ON payments FOR EACH ROW
         SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'admin payment rollback test'`
      );
      const before = await snapshotBooking(paymentRollbackBooking.id);
      const response = await requestJson(
        baseUrl,
        `/api/v1/admin/bookings/${paymentRollbackBooking.id}/incident-cancellation`,
        'POST',
        { cancellation_reason: 'Trigger payment failure' },
        admin.cookie
      );
      assert.equal(response.status, 500);
      assert.equal(await snapshotBooking(paymentRollbackBooking.id), before);
      await pool.query(`DROP TRIGGER IF EXISTS ${triggerName}`);
      triggerNames.splice(triggerNames.indexOf(triggerName), 1);
    });

    await t.test('notification failures roll back cancellation, payment, and slots', async () => {
      const triggerName = `trg_admin_notification_${crypto.randomUUID().replaceAll('-', '')}`;
      triggerNames.push(triggerName);
      await pool.query(
        `CREATE TRIGGER ${triggerName}
         BEFORE INSERT ON notifications FOR EACH ROW
         SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'admin notification rollback test'`
      );
      const before = await snapshotBooking(notificationRollbackBooking.id);
      const response = await requestJson(
        baseUrl,
        `/api/v1/admin/bookings/${notificationRollbackBooking.id}/incident-cancellation`,
        'POST',
        { cancellation_reason: 'Trigger notification failure' },
        admin.cookie
      );
      assert.equal(response.status, 500);
      assert.equal(await snapshotBooking(notificationRollbackBooking.id), before);
      await pool.query(`DROP TRIGGER IF EXISTS ${triggerName}`);
      triggerNames.splice(triggerNames.indexOf(triggerName), 1);
    });

    await t.test('dashboard reports four metrics for today, 7d, and 30d using event timestamps', async () => {
      const periods = ['today', '7d', '30d'];
      const before = {};
      for (const period of periods) {
        const response = await requestJson(
          baseUrl,
          `/api/v1/admin/dashboard?period=${period}`,
          'GET',
          undefined,
          admin.cookie
        );
        assert.equal(response.status, 200);
        before[period] = await response.json();
      }

      await addBooking({ status: 'PENDING' });
      await addBooking({
        status: 'CANCELLED',
        paymentStatus: 'REFUNDED',
        paidAmount: '5000',
        refundedAmount: '5000',
        paidAt: timestampDaysAgo(31),
        refundedAt: new Date()
      });
      await addBooking({
        status: 'COMPLETED',
        paymentStatus: 'PAID',
        paidAmount: '12000',
        paidAt: new Date()
      });
      await addBooking({
        status: 'CONFIRMED',
        paymentStatus: 'PAID',
        paidAmount: '20000',
        paidAt: timestampDaysAgo(8)
      });

      const expectedRevenueDeltas = { today: '7000', '7d': '7000', '30d': '27000' };
      for (const period of periods) {
        const response = await requestJson(
          baseUrl,
          `/api/v1/admin/dashboard?period=${period}`,
          'GET',
          undefined,
          admin.cookie
        );
        assert.equal(response.status, 200);
        const after = await response.json();
        assert.equal(after.period, period);
        assert.equal(after.new_bookings, before[period].new_bookings + 4);
        assert.equal(after.cancelled_bookings, before[period].cancelled_bookings + 1);
        assert.equal(after.completed_bookings, before[period].completed_bookings + 1);
        assert.equal(
          (BigInt(after.net_revenue) - BigInt(before[period].net_revenue)).toString(),
          expectedRevenueDeltas[period]
        );
      }
      const invalid = await requestJson(
        baseUrl,
        '/api/v1/admin/dashboard?period=90d',
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal(invalid.status, 400);
    });
  } finally {
    const cleanup = async (operation) => {
      try {
        await operation();
      } catch (error) {
        cleanupErrors.push(error);
      }
    };
    for (const triggerName of triggerNames) {
      await cleanup(() => pool.query(`DROP TRIGGER IF EXISTS ${triggerName}`));
    }
    if (server) {
      await cleanup(() => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      }));
    }
    if (bookingIds.length > 0) {
      const placeholders = bookingIds.map(() => '?').join(', ');
      await cleanup(() => pool.execute(
        `DELETE FROM notifications
         WHERE resource_type = ? AND resource_id IN (${placeholders})`,
        ['BOOKING', ...bookingIds]
      ));
      await cleanup(() => pool.execute(
        `DELETE FROM booking_tickets WHERE booking_id IN (${placeholders})`,
        bookingIds
      ));
      await cleanup(() => pool.execute(
        `DELETE pa FROM payment_attempts AS pa
         INNER JOIN payments AS p ON p.id = pa.payment_id
         WHERE p.booking_id IN (${placeholders})`,
        bookingIds
      ));
      await cleanup(() => pool.execute(
        `DELETE FROM booking_slots WHERE booking_id IN (${placeholders})`,
        bookingIds
      ));
      await cleanup(() => pool.execute(
        `UPDATE time_slots SET current_booking_id = NULL, lock_expires_at = NULL
         WHERE current_booking_id IN (${placeholders})`,
        bookingIds
      ));
      await cleanup(() => pool.execute(
        `DELETE FROM payments WHERE booking_id IN (${placeholders})`,
        bookingIds
      ));
      await cleanup(() => pool.execute(
        `DELETE FROM bookings WHERE id IN (${placeholders})`,
        bookingIds
      ));
    }
    if (slotIds.length > 0) {
      const placeholders = slotIds.map(() => '?').join(', ');
      await cleanup(() => pool.execute(
        `DELETE FROM time_slots WHERE id IN (${placeholders})`,
        slotIds
      ));
    }
    if (courtId) {
      await cleanup(() => pool.execute('DELETE FROM courts WHERE id = ?', [courtId]));
    }
    if (facilityId) {
      await cleanup(() => pool.execute('DELETE FROM facilities WHERE id = ?', [facilityId]));
    }
    if (userIds.length > 0) {
      const placeholders = userIds.map(() => '?').join(', ');
      await cleanup(() => pool.execute(
        `DELETE FROM user_sessions WHERE user_id IN (${placeholders})`,
        userIds
      ));
      await cleanup(() => pool.execute(
        `DELETE FROM users WHERE id IN (${placeholders})`,
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
      throw new AggregateError(cleanupErrors, 'Admin integration test cleanup failed.');
    }
  }
});
