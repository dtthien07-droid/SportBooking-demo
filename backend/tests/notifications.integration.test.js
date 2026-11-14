'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

if (process.env.APP_ENV !== 'test' || process.env.DB_NAME !== 'sportbooking_test') {
  throw new Error('Notification integration tests require APP_ENV=test and DB_NAME=sportbooking_test.');
}

const { closePool, getPool } = require('../src/config/database');
const { createApp } = require('../src/app');

const ROLLBACK_TRIGGER = 'trg_notifications_rollback_test';

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

function localDateOffset(days) {
  const date = new Date(Date.now() + 7 * 60 * 60 * 1000);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function slotAtLocalOffset(hours) {
  const localHour = Math.ceil((Date.now() + 7 * 3_600_000) / 3_600_000) * 3_600_000;
  const start = new Date(localHour + hours * 3_600_000);
  const end = new Date(start.getTime() + 3_600_000);
  return {
    serviceDate: start.toISOString().slice(0, 10),
    startsAt: start.toISOString().slice(11, 19),
    endsAt: end.toISOString().slice(11, 19)
  };
}

test('notification API and booking events work transactionally over HTTP on sportbooking_test', async (t) => {
  const pool = getPool();
  const userIds = [];
  const userEmails = [];
  const bookingIds = [];
  const slotIds = [];
  let facilityId;
  let courtId;
  let server;
  let triggerCreated = false;
  let app;
  const cleanupErrors = [];

  try {
    const [databaseRows] = await pool.execute('SELECT DATABASE() AS database_name');
    assert.equal(databaseRows[0].database_name, 'sportbooking_test');
    const appInstance = createApp({ pool });
    app = appInstance;
    server = app.listen(0, '127.0.0.1');
    await new Promise((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const password = crypto.randomBytes(24).toString('base64url');

    async function createUser(index) {
      const email = `notifications-${crypto.randomUUID()}@example.test`;
      userEmails.push(email);
      const registration = await requestJson(baseUrl, '/api/v1/auth/register', 'POST', {
        fullName: `Notification Integration ${index}`,
        email,
        phone: `+84${String(crypto.randomInt(100000000, 1000000000))}`,
        password,
        termsAccepted: true
      });
      assert.equal(registration.status, 201);
      const { user } = await registration.json();
      userIds.push(String(user.id));
      const login = await requestJson(baseUrl, '/api/v1/auth/login', 'POST', { email, password });
      assert.equal(login.status, 200);
      return { id: String(user.id), cookie: cookiePair(login.headers.get('set-cookie')) };
    }

    const owner = await createUser(1);
    const other = await createUser(2);
    const suffix = crypto.randomUUID();
    const [facilityResult] = await pool.execute(
      `INSERT INTO facilities
         (name, address, district, amenities, is_active, is_seed, created_at, updated_at)
       VALUES (?, ?, ?, ?, TRUE, FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [`Notification test ${suffix}`, 'Integration test address', 'Test district', '[]']
    );
    facilityId = String(facilityResult.insertId);
    const [courtResult] = await pool.execute(
      `INSERT INTO courts
         (facility_id, name, sport_type, price_normal, price_peak, is_active, is_seed,
          created_at, updated_at)
       VALUES (?, ?, 'BADMINTON', 120000, 150000, TRUE, FALSE,
               UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [facilityId, `Notification court ${suffix}`]
    );
    courtId = String(courtResult.insertId);

    for (let hour = 8; hour < 15; hour += 1) {
      const [slotResult] = await pool.execute(
        `INSERT INTO time_slots
           (court_id, service_date, starts_at, ends_at, price, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 120000, 'AVAILABLE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [
          courtId,
          localDateOffset(4),
          `${String(hour).padStart(2, '0')}:00:00`,
          `${String(hour + 1).padStart(2, '0')}:00:00`
        ]
      );
      slotIds.push(String(slotResult.insertId));
    }
    for (const offset of [4, 11]) {
      const nearStart = slotAtLocalOffset(offset);
      const [nearSlotResult] = await pool.execute(
        `INSERT INTO time_slots
           (court_id, service_date, starts_at, ends_at, price, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 120000, 'AVAILABLE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [courtId, nearStart.serviceDate, nearStart.startsAt, nearStart.endsAt]
      );
      slotIds.push(String(nearSlotResult.insertId));
    }

    async function createBooking(slotId, paymentOption = 'FULL', cookie = owner.cookie) {
      const response = await requestJson(baseUrl, '/api/v1/bookings', 'POST', {
        slot_ids: [slotId],
        payment_option: paymentOption
      }, cookie);
      assert.equal(response.status, 201, JSON.stringify(await response.clone().json()));
      const booking = await response.json();
      bookingIds.push(booking.booking_id);
      return booking;
    }

    async function pay(bookingId, result = 'SUCCESS') {
      return requestJson(
        baseUrl,
        `/api/v1/bookings/${encodeURIComponent(bookingId)}/payment-attempts`,
        'POST',
        { method: 'BANK_TRANSFER', simulation_result: result },
        owner.cookie
      );
    }

    async function notificationsFor(bookingId) {
      const [rows] = await pool.execute(
        `SELECT id, category, title, body, resource_type, resource_id, read_at
         FROM notifications
         WHERE user_id = ? AND resource_type = ? AND resource_id = ?
         ORDER BY id ASC`,
        [owner.id, 'BOOKING', bookingId]
      );
      return rows;
    }

    await t.test('successful payment creates PAYMENT then BOOKING_HOLD and unread count increases by two', async () => {
      const booking = await createBooking(slotIds[0], 'DEPOSIT_50');
      const before = await requestJson(
        baseUrl,
        '/api/v1/notifications/unread-count',
        'GET',
        undefined,
        owner.cookie
      );
      assert.equal((await before.json()).count, 0);
      const response = await pay(booking.booking_id);
      assert.equal(response.status, 201);
      const rows = await notificationsFor(booking.booking_id);
      assert.equal(rows.length, 2);
      assert.equal(rows[0].category, 'PAYMENT');
      assert.equal(rows[0].title, 'Thanh toán thành công');
      assert.match(rows[0].body, /60\.000 đ/);
      assert.match(rows[0].body, /đặt cọc 50%/);
      assert.match(rows[0].body, /còn thu tại sân 60\.000 đ/);
      const [year, month, day] = booking.slots[0].service_date.split('-');
      assert.ok(rows[0].body.includes(`${day}/${month}/${year}, 08:00–09:00`));
      assert.equal(rows[1].category, 'BOOKING_HOLD');
      assert.equal(rows[1].title, 'Đặt sân thành công');
      assert.ok(BigInt(rows[1].id) > BigInt(rows[0].id));
      assert.equal(rows[0].resource_type, 'BOOKING');
      assert.equal(String(rows[0].resource_id), booking.booking_id);
      const unreadResponse = await requestJson(
        baseUrl,
        '/api/v1/notifications/unread-count',
        'GET',
        undefined,
        owner.cookie
      );
      assert.equal((await unreadResponse.json()).count, 2);
      const visibleResponse = await requestJson(
        baseUrl,
        '/api/v1/notifications?page=1&page_size=50',
        'GET',
        undefined,
        owner.cookie
      );
      const visible = await visibleResponse.json();
      assert.deepEqual(
        visible.notifications.slice(0, 2).map((notification) => notification.title),
        ['Đặt sân thành công', 'Thanh toán thành công']
      );
    });

    await t.test('failed payment and user cancellation of a pending hold create no notifications', async () => {
      const failed = await createBooking(slotIds[1]);
      assert.equal((await pay(failed.booking_id, 'FAILURE')).status, 201);
      assert.equal((await notificationsFor(failed.booking_id)).length, 0);
      const failedHoldCancel = await requestJson(
        baseUrl,
        `/api/v1/bookings/${failed.booking_id}/cancel`,
        'POST',
        {},
        owner.cookie
      );
      assert.equal(failedHoldCancel.status, 200);
      assert.equal((await notificationsFor(failed.booking_id)).length, 0);

      const pending = await createBooking(slotIds[3]);
      const cancellation = await requestJson(
        baseUrl,
        `/api/v1/bookings/${pending.booking_id}/cancel`,
        'POST',
        {},
        owner.cookie
      );
      assert.equal(cancellation.status, 200);
      assert.equal((await notificationsFor(pending.booking_id)).length, 0);
    });

    await t.test('confirmed cancellation notifies separately for full, half, and zero refund', async () => {
      const refundable = await createBooking(slotIds[2]);
      assert.equal((await pay(refundable.booking_id)).status, 201);
      const refundResponse = await requestJson(
        baseUrl,
        `/api/v1/bookings/${refundable.booking_id}/cancel`,
        'POST',
        {},
        owner.cookie
      );
      assert.equal(refundResponse.status, 200, await refundResponse.clone().text());
      const refund = await refundResponse.json();
      const refundRows = await notificationsFor(refundable.booking_id);
      assert.equal(refund.refund_percent, 100);
      assert.equal(refundRows.length, 4);
      assert.equal(refundRows[2].category, 'BOOKING_HOLD');
      assert.match(refundRows[2].title, new RegExp(refundable.booking_code));
      assert.equal(refundRows[3].category, 'PAYMENT');
      assert.equal(refundRows[3].title, 'Hoàn tiền 120.000 đ');
      assert.match(refundRows[3].body, /120\.000 đ/);

      const halfRefund = await createBooking(slotIds[8]);
      assert.equal((await pay(halfRefund.booking_id)).status, 201);
      const halfResponse = await requestJson(
        baseUrl,
        `/api/v1/bookings/${halfRefund.booking_id}/cancel`,
        'POST',
        {},
        owner.cookie
      );
      assert.equal(halfResponse.status, 200);
      assert.equal((await halfResponse.json()).refund_percent, 50);
      const halfRows = await notificationsFor(halfRefund.booking_id);
      assert.equal(halfRows.length, 4);
      assert.deepEqual(halfRows.slice(2).map((row) => row.category), ['BOOKING_HOLD', 'PAYMENT']);

      const noRefund = await createBooking(slotIds[7]);
      assert.equal((await pay(noRefund.booking_id)).status, 201);
      const noRefundResponse = await requestJson(
        baseUrl,
        `/api/v1/bookings/${noRefund.booking_id}/cancel`,
        'POST',
        {},
        owner.cookie
      );
      assert.equal(noRefundResponse.status, 200);
      const noRefundResult = await noRefundResponse.json();
      assert.equal(noRefundResult.refunded_amount, '0');
      const noRefundRows = await notificationsFor(noRefund.booking_id);
      assert.equal(noRefundRows.length, 3);
      assert.deepEqual(noRefundRows.slice(2).map((row) => row.category), ['BOOKING_HOLD']);
      assert.match(noRefundRows[2].body, /Không có khoản hoàn theo chính sách hủy/);
    });

    await t.test('expiry job creates once across repeated runs', async () => {
      const booking = await createBooking(slotIds[4]);
      await pool.execute(
        `UPDATE bookings
         SET lock_expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND)
         WHERE id = ? AND user_id = ?`,
        [booking.booking_id, owner.id]
      );
      assert.equal(await app.locals.bookingsService.releaseExpiredBookings(), 1);
      assert.equal(await app.locals.bookingsService.releaseExpiredBookings(), 0);
      const rows = await notificationsFor(booking.booking_id);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].category, 'BOOKING_HOLD');
      assert.equal(rows[0].title, 'Giữ chỗ đã hết hạn, khung giờ được nhả');
      assert.match(rows[0].body, new RegExp(booking.booking_code));
    });

    await t.test('notification insert rolls back with a later payment failure', async () => {
      const booking = await createBooking(slotIds[5]);
      await pool.query(
        `CREATE TRIGGER ${ROLLBACK_TRIGGER}
         BEFORE INSERT ON booking_tickets
         FOR EACH ROW
         SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'notification rollback test'`
      );
      triggerCreated = true;
      const response = await pay(booking.booking_id);
      assert.equal(response.status, 500);
      const rows = await notificationsFor(booking.booking_id);
      assert.equal(rows.length, 0);
      const [bookingRows] = await pool.execute(
        `SELECT b.status, p.status AS payment_status
         FROM bookings AS b
         INNER JOIN payments AS p ON p.booking_id = b.id
         WHERE b.id = ? AND b.user_id = ?`,
        [booking.booking_id, owner.id]
      );
      assert.equal(bookingRows[0].status, 'PENDING');
      assert.equal(bookingRows[0].payment_status, 'PENDING');
      await pool.query(`DROP TRIGGER IF EXISTS ${ROLLBACK_TRIGGER}`);
      triggerCreated = false;
    });

    await t.test('API enforces ownership, unread count, read operations, paging, and no-store', async () => {
      const missingAuth = await requestJson(
        baseUrl,
        '/api/v1/notifications/unread-count',
        'GET'
      );
      assert.equal(missingAuth.status, 401);
      assert.equal(missingAuth.headers.get('cache-control'), 'no-store');

      const listResponse = await requestJson(
        baseUrl,
        '/api/v1/notifications?category=PAYMENT&page=1&page_size=50',
        'GET',
        undefined,
        owner.cookie
      );
      assert.equal(listResponse.status, 200);
      assert.equal(listResponse.headers.get('cache-control'), 'no-store');
      const list = await listResponse.json();
      assert.ok(list.notifications.every((notification) => notification.category === 'PAYMENT'));
      assert.ok(list.notifications.length > 0);
      assert.ok(list.pagination.total >= list.notifications.length);
      assert.ok(BigInt(list.notifications[0].id) > BigInt(list.notifications[1].id));
      const holdResponse = await requestJson(
        baseUrl,
        '/api/v1/notifications?category=BOOKING_HOLD&page=1&page_size=50',
        'GET',
        undefined,
        owner.cookie
      );
      const holds = await holdResponse.json();
      assert.ok(holds.notifications.every((notification) => notification.category === 'BOOKING_HOLD'));

      const otherList = await requestJson(
        baseUrl,
        '/api/v1/notifications?page=1&page_size=50',
        'GET',
        undefined,
        other.cookie
      );
      assert.equal(otherList.status, 200);
      assert.deepEqual((await otherList.json()).notifications, []);
      const foreignRead = await requestJson(
        baseUrl,
        `/api/v1/notifications/${list.notifications[0].id}/read`,
        'PATCH',
        undefined,
        other.cookie
      );
      assert.equal(foreignRead.status, 404);

      const unreadResponse = await requestJson(
        baseUrl,
        '/api/v1/notifications/unread-count',
        'GET',
        undefined,
        owner.cookie
      );
      assert.equal(unreadResponse.status, 200);
      const unread = await unreadResponse.json();
      const allResponse = await requestJson(
        baseUrl,
        '/api/v1/notifications?page=1&page_size=50',
        'GET',
        undefined,
        owner.cookie
      );
      const all = await allResponse.json();
      assert.equal(unread.count, all.notifications.length);
      assert.ok(all.notifications.every((notification) => notification.resource_type === 'BOOKING'));
      assert.equal(typeof unread.server_time, 'string');

      const markRead = await requestJson(
        baseUrl,
        `/api/v1/notifications/${list.notifications[0].id}/read`,
        'PATCH',
        undefined,
        owner.cookie
      );
      assert.equal(markRead.status, 200);
      assert.ok((await markRead.json()).read_at);
      const afterMarkRead = await requestJson(
        baseUrl,
        '/api/v1/notifications/unread-count',
        'GET',
        undefined,
        owner.cookie
      );
      assert.equal((await afterMarkRead.json()).count, unread.count - 1);

      const readAll = await requestJson(
        baseUrl,
        '/api/v1/notifications/read-all',
        'POST',
        {},
        owner.cookie
      );
      assert.equal(readAll.status, 200);
      assert.equal((await readAll.json()).updated, unread.count - 1);
      const afterReadAll = await requestJson(
        baseUrl,
        '/api/v1/notifications/unread-count',
        'GET',
        undefined,
        owner.cookie
      );
      assert.equal((await afterReadAll.json()).count, 0);
    });
  } finally {
    const cleanup = async (operation) => {
      try {
        await operation();
      } catch (error) {
        cleanupErrors.push(error);
      }
    };
    if (triggerCreated) {
      await cleanup(() => pool.query(`DROP TRIGGER IF EXISTS ${ROLLBACK_TRIGGER}`));
    }
    if (server) {
      await cleanup(() => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      }));
    }
    const uniqueBookingIds = [...new Set(bookingIds.map(String))];
    if (uniqueBookingIds.length > 0) {
      const placeholders = uniqueBookingIds.map(() => '?').join(', ');
      await cleanup(() => pool.execute(
        `DELETE FROM notifications
         WHERE resource_type = 'BOOKING' AND resource_id IN (${placeholders})`,
        uniqueBookingIds
      ));
      await cleanup(() => pool.execute(
        `DELETE FROM booking_tickets WHERE booking_id IN (${placeholders})`,
        uniqueBookingIds
      ));
      const [paymentRows] = await pool.execute(
        `SELECT id FROM payments WHERE booking_id IN (${placeholders})`,
        uniqueBookingIds
      );
      const paymentIds = paymentRows.map((row) => String(row.id));
      if (paymentIds.length > 0) {
        const paymentPlaceholders = paymentIds.map(() => '?').join(', ');
        await cleanup(() => pool.execute(
          `DELETE FROM payment_attempts WHERE payment_id IN (${paymentPlaceholders})`,
          paymentIds
        ));
      }
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
    if (slotIds.length > 0) {
      const placeholders = slotIds.map(() => '?').join(', ');
      await cleanup(() => pool.execute(
        `DELETE FROM time_slots WHERE id IN (${placeholders})`,
        slotIds
      ));
    }
    if (courtId) await cleanup(() => pool.execute('DELETE FROM courts WHERE id = ?', [courtId]));
    if (facilityId) await cleanup(() => pool.execute('DELETE FROM facilities WHERE id = ?', [facilityId]));
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
      throw new AggregateError(cleanupErrors, 'Notification integration test cleanup failed.');
    }
  }
});
