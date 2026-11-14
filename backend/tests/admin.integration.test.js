'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

if (process.env.APP_ENV !== 'test' || process.env.DB_NAME !== 'sportbooking_test') {
  throw new Error('Admin integration tests require APP_ENV=test and DB_NAME=sportbooking_test.');
}

const { closePool, getPool } = require('../src/config/database');
const { createApp } = require('../src/app');
const { dateOffset, localDateString } = require('../src/facilities/slot-generator');

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
  const createdFacilityIds = [];
  const createdCourtIds = [];
  let managedFacilityId;
  let generatedCourtId;
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
    const lockTarget = await createUser('Lock Target Integration Test');
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
      return {
        id: bookingId,
        code: bookingCode,
        slotId: slot ? slotIds[slotIds.length - 1] : null,
        serviceDate: slot?.serviceDate || null
      };
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
        requestJson(
          baseUrl,
          `/api/v1/admin/bookings?facility_id=${facilityId}&date=${inProgressBooking.serviceDate}`,
          'GET',
          undefined,
          ordinaryUser.cookie
        ),
        requestJson(baseUrl, '/api/v1/admin/dashboard?period=today', 'GET', undefined, ordinaryUser.cookie),
        requestJson(baseUrl, '/api/v1/admin/users', 'GET', undefined, ordinaryUser.cookie),
        requestJson(
          baseUrl,
          `/api/v1/admin/users/${lockTarget.id}/lock`,
          'PATCH',
          {},
          ordinaryUser.cookie
        ),
        requestJson(
          baseUrl,
          `/api/v1/admin/bookings/${inProgressBooking.id}/incident-cancellation`,
          'POST',
          { cancellation_reason: 'User must not cancel incidents' },
          ordinaryUser.cookie
        ),
        requestJson(baseUrl, '/api/v1/admin/facilities', 'GET', undefined, ordinaryUser.cookie),
        requestJson(baseUrl, `/api/v1/admin/facilities/${facilityId}`, 'GET', undefined, ordinaryUser.cookie),
        requestJson(baseUrl, '/api/v1/admin/facilities', 'POST', {}, ordinaryUser.cookie),
        requestJson(baseUrl, `/api/v1/admin/facilities/${facilityId}`, 'PATCH', {}, ordinaryUser.cookie),
        requestJson(baseUrl, '/api/v1/admin/courts', 'POST', {}, ordinaryUser.cookie),
        requestJson(baseUrl, `/api/v1/admin/courts/${courtId}`, 'PATCH', {}, ordinaryUser.cookie),
        requestJson(baseUrl, `/api/v1/admin/courts/${courtId}/time-slots?date=2026-01-01`, 'GET', undefined, ordinaryUser.cookie),
        requestJson(baseUrl, `/api/v1/admin/courts/${courtId}/generate-slots`, 'POST', {}, ordinaryUser.cookie),
        requestJson(baseUrl, `/api/v1/admin/courts/${courtId}/prices`, 'PATCH', {}, ordinaryUser.cookie)
      ]);
      assert.deepEqual(responseRows.map((response) => response.status),
        [403, 403, 403, 403, 403, 403, 403, 403, 403, 403, 403, 403, 403, 403]);
      assert.equal(await snapshotBooking(inProgressBooking.id), before);

      const unauthenticated = await requestJson(
        baseUrl,
        `/api/v1/admin/bookings?facility_id=${facilityId}&date=${inProgressBooking.serviceDate}`,
        'GET'
      );
      assert.equal(unauthenticated.status, 401);
      const unauthenticatedDashboard = await requestJson(
        baseUrl,
        '/api/v1/admin/dashboard?range=today',
        'GET'
      );
      assert.equal(unauthenticatedDashboard.status, 401);
      const unauthenticatedUsers = await requestJson(baseUrl, '/api/v1/admin/users', 'GET');
      assert.equal(unauthenticatedUsers.status, 401);
      const unauthenticatedFacilities = await Promise.all([
        requestJson(baseUrl, '/api/v1/admin/facilities', 'GET'),
        requestJson(baseUrl, `/api/v1/admin/facilities/${facilityId}`, 'GET'),
        requestJson(baseUrl, '/api/v1/admin/facilities', 'POST', {}),
        requestJson(baseUrl, `/api/v1/admin/facilities/${facilityId}`, 'PATCH', {}),
        requestJson(baseUrl, '/api/v1/admin/courts', 'POST', {}),
        requestJson(baseUrl, `/api/v1/admin/courts/${courtId}`, 'PATCH', {}),
        requestJson(baseUrl, `/api/v1/admin/courts/${courtId}/time-slots?date=2026-01-01`, 'GET'),
        requestJson(baseUrl, `/api/v1/admin/courts/${courtId}/generate-slots`, 'POST', {}),
        requestJson(baseUrl, `/api/v1/admin/courts/${courtId}/prices`, 'PATCH', {})
      ]);
      assert.deepEqual(unauthenticatedFacilities.map((response) => response.status),
        [401, 401, 401, 401, 401, 401, 401, 401, 401]);
    });

    await t.test('facility and court management validates, checks stale data, and audits writes', async () => {
      const listResponse = await requestJson(
        baseUrl, `/api/v1/admin/facilities?q=${encodeURIComponent('Admin test')}&page=1`,
        'GET', undefined, admin.cookie
      );
      assert.equal(listResponse.status, 200);
      assert.equal(listResponse.headers.get('cache-control'), 'no-cache');
      const list = await listResponse.json();
      assert.equal(list.facilities.length, 1);
      assert.equal(list.facilities[0].id, facilityId);
      assert.equal(list.facilities[0].court_count, 1);
      assert.ok(list.facilities[0].updated_at.endsWith('Z'));
      const unchanged = await fetch(`${baseUrl}/api/v1/admin/facilities?q=Admin%20test&page=1`, {
        headers: { cookie: admin.cookie, 'if-none-match': listResponse.headers.get('etag') }
      });
      assert.equal(unchanged.status, 304);

      const detailResponse = await requestJson(
        baseUrl, `/api/v1/admin/facilities/${facilityId}`, 'GET', undefined, admin.cookie
      );
      assert.equal(detailResponse.status, 200);
      const detail = await detailResponse.json();
      assert.equal(detail.courts[0].id, courtId);
      const activeFacilityUpdate = await requestJson(
        baseUrl, `/api/v1/admin/facilities/${facilityId}`, 'PATCH',
        {
          expected_updated_at: detail.facility.updated_at,
          is_active: false,
          opening_time: '06:00',
          closing_time: '22:00'
        }, admin.cookie
      );
      const activeFacilityError = await activeFacilityUpdate.json();
      assert.equal(activeFacilityUpdate.status, 409, JSON.stringify(activeFacilityError));
      assert.match(activeFacilityError.error.message, /\d+ đơn hiệu lực/);
      const activeCourtUpdate = await requestJson(
        baseUrl, `/api/v1/admin/courts/${courtId}`, 'PATCH',
        { expected_updated_at: detail.courts[0].updated_at, sport_type: 'PICKLEBALL' }, admin.cookie
      );
      assert.equal(activeCourtUpdate.status, 409);
      assert.match((await activeCourtUpdate.json()).error.message, /\d+ đơn hiệu lực/);

      const suffix = crypto.randomUUID();
      const created = await requestJson(baseUrl, '/api/v1/admin/facilities', 'POST', {
        name: `Managed facility ${suffix}`,
        address: 'Địa chỉ kiểm thử',
        district: 'Quận kiểm thử',
        opening_time: '06:00',
        closing_time: '24:00',
        amenities: ['Chỗ để xe'],
        is_active: true
      }, admin.cookie);
      assert.equal(created.status, 201);
      const createdFacility = await created.json();
      createdFacilityIds.push(createdFacility.id);
      managedFacilityId = createdFacility.id;
      const createdDetailResponse = await requestJson(
        baseUrl, `/api/v1/admin/facilities/${createdFacility.id}`, 'GET', undefined, admin.cookie
      );
      const createdDetail = await createdDetailResponse.json();
      assert.equal(createdDetail.courts.length, 0);

      const partialUpdate = await requestJson(
        baseUrl, `/api/v1/admin/facilities/${createdFacility.id}`, 'PATCH',
        { expected_updated_at: createdDetail.facility.updated_at, address: 'Địa chỉ mới' }, admin.cookie
      );
      assert.equal(partialUpdate.status, 200, JSON.stringify(await partialUpdate.json()));
      const staleUpdate = await requestJson(
        baseUrl, `/api/v1/admin/facilities/${createdFacility.id}`, 'PATCH',
        { expected_updated_at: createdDetail.facility.updated_at, district: 'Quận cũ' }, admin.cookie
      );
      assert.equal(staleUpdate.status, 409);
      assert.match((await staleUpdate.json()).error.message,
        /Dữ liệu vừa được người khác thay đổi, hãy tải lại/);

      const newCourt = await requestJson(baseUrl, '/api/v1/admin/courts', 'POST', {
        facility_id: createdFacility.id,
        name: `Managed court ${suffix}`,
        sport_type: 'BADMINTON',
        price_normal: 100000,
        price_peak: 120000
      }, admin.cookie);
      assert.equal(newCourt.status, 201);
      const createdCourt = await newCourt.json();
      createdCourtIds.push(createdCourt.id);
      const duplicateCourt = await requestJson(baseUrl, '/api/v1/admin/courts', 'POST', {
        facility_id: createdFacility.id,
        name: `Managed court ${suffix}`,
        sport_type: 'BADMINTON',
        price_normal: 100000,
        price_peak: 120000
      }, admin.cookie);
      assert.equal(duplicateCourt.status, 409);
      const courtDetailResponse = await requestJson(
        baseUrl, `/api/v1/admin/facilities/${createdFacility.id}`, 'GET', undefined, admin.cookie
      );
      const courtDetail = await courtDetailResponse.json();
      const disabledCourt = await requestJson(
        baseUrl, `/api/v1/admin/courts/${createdCourt.id}`, 'PATCH',
        { expected_updated_at: courtDetail.courts[0].updated_at, is_active: false }, admin.cookie
      );
      assert.equal(disabledCourt.status, 200);

      const [auditRows] = await pool.execute(
        `SELECT action, resource_id FROM admin_audit_logs
         WHERE admin_user_id = ? AND resource_id IN (?, ?) ORDER BY id`,
        [admin.id, createdFacility.id, createdCourt.id]
      );
      assert.deepEqual(auditRows.map((row) => row.action),
        ['FACILITY_CREATE', 'FACILITY_UPDATE', 'COURT_CREATE', 'COURT_UPDATE']);
    });

    await t.test('slot generation is idempotent and price updates preserve held and booked slots', async () => {
      const suffix = crypto.randomUUID();
      const createdCourt = await requestJson(baseUrl, '/api/v1/admin/courts', 'POST', {
        facility_id: managedFacilityId,
        name: `Generated court ${suffix}`,
        sport_type: 'BADMINTON',
        price_normal: 100000,
        price_peak: 120000
      }, admin.cookie);
      assert.equal(createdCourt.status, 201);
      generatedCourtId = (await createdCourt.json()).id;
      createdCourtIds.push(generatedCourtId);

      const fromDate = dateOffset(localDateString(), 1);
      const toDate = dateOffset(fromDate, 1);
      const generated = await requestJson(
        baseUrl, `/api/v1/admin/courts/${generatedCourtId}/generate-slots`, 'POST',
        { from_date: fromDate, to_date: toDate }, admin.cookie
      );
      assert.equal(generated.status, 201);
      const generatedResult = await generated.json();
      assert.equal(generatedResult.inserted, 36);
      assert.equal(generatedResult.existing, 0);
      const repeated = await requestJson(
        baseUrl, `/api/v1/admin/courts/${generatedCourtId}/generate-slots`, 'POST',
        { from_date: fromDate, to_date: toDate }, admin.cookie
      );
      assert.equal(repeated.status, 201);
      assert.deepEqual(
        (({ inserted, existing }) => ({ inserted, existing }))(await repeated.json()),
        { inserted: 0, existing: 36 }
      );

      await pool.execute(
        `UPDATE time_slots SET status = 'LOCKED', lock_expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE)
         WHERE court_id = ? AND service_date = ? AND starts_at = '06:00:00'`,
        [generatedCourtId, fromDate]
      );
      await pool.execute(
        `UPDATE time_slots SET status = 'BOOKED'
         WHERE court_id = ? AND service_date = ? AND starts_at = '17:00:00'`,
        [generatedCourtId, fromDate]
      );
      const facilityDetailResponse = await requestJson(
        baseUrl, `/api/v1/admin/facilities/${managedFacilityId}`, 'GET', undefined, admin.cookie
      );
      const courtDetail = (await facilityDetailResponse.json()).courts
        .find((court) => court.id === generatedCourtId);
      assert.ok(courtDetail);
      const slotUrl = `${baseUrl}/api/v1/admin/courts/${generatedCourtId}/time-slots?date=${fromDate}&from_date=${localDateString()}`;
      const beforePriceResponse = await fetch(slotUrl, { headers: { cookie: admin.cookie } });
      assert.equal(beforePriceResponse.status, 200);
      const slotsEtag = beforePriceResponse.headers.get('etag');
      const beforePriceSlots = await beforePriceResponse.json();
      assert.equal(beforePriceSlots.price_preview.available_slots, 34);
      const unchangedSlots = await fetch(slotUrl, {
        headers: { cookie: admin.cookie, 'if-none-match': slotsEtag }
      });
      assert.equal(unchangedSlots.status, 304);
      const priceUpdate = await requestJson(
        baseUrl, `/api/v1/admin/courts/${generatedCourtId}/prices`, 'PATCH',
        {
          price_normal: 110000,
          price_peak: 150000,
          expected_updated_at: courtDetail.updated_at
        }, admin.cookie
      );
      assert.equal(priceUpdate.status, 200);
      const priceResult = await priceUpdate.json();
      assert.equal(priceResult.affected_slots, 34);
      const stalePrices = await requestJson(
        baseUrl, `/api/v1/admin/courts/${generatedCourtId}/prices`, 'PATCH',
        {
          price_normal: 120000,
          price_peak: 160000,
          expected_updated_at: courtDetail.updated_at
        }, admin.cookie
      );
      assert.equal(stalePrices.status, 409);

      const changedSlots = await fetch(slotUrl, {
        headers: { cookie: admin.cookie, 'if-none-match': slotsEtag }
      });
      assert.equal(changedSlots.status, 200);
      const slotsResult = await changedSlots.json();
      const early = slotsResult.time_slots.find((slot) => slot.starts_at === '06:00:00');
      const peak = slotsResult.time_slots.find((slot) => slot.starts_at === '17:00:00');
      const evening = slotsResult.time_slots.find((slot) => slot.starts_at === '18:00:00');
      assert.equal(early.status, 'AVAILABLE');
      assert.equal(early.price, '100000');
      assert.equal(peak.status, 'BOOKED');
      assert.equal(peak.price, '120000');
      assert.equal(evening.status, 'AVAILABLE');
      assert.equal(evening.price, '150000');
      const updatedSlotsEtag = changedSlots.headers.get('etag');
      const unchangedUpdatedSlots = await fetch(slotUrl, {
        headers: { cookie: admin.cookie, 'if-none-match': updatedSlotsEtag }
      });
      assert.equal(unchangedUpdatedSlots.status, 304);

      const existingSlots = await requestJson(
        baseUrl,
        `/api/v1/admin/courts/${courtId}/time-slots?date=${inProgressBooking.serviceDate}`,
        'GET', undefined, admin.cookie
      );
      const existingResult = await existingSlots.json();
      const booked = existingResult.time_slots.find((slot) => slot.booking_code === inProgressBooking.code);
      assert.equal(booked.status, 'BOOKED');
      assert.ok(updatedSlotsEtag);
      const [auditRows] = await pool.execute(
        `SELECT action FROM admin_audit_logs
         WHERE admin_user_id = ? AND resource_type = ? AND resource_id = ?`,
        [admin.id, 'court', generatedCourtId]
      );
      assert.deepEqual(auditRows.map((row) => row.action),
        ['COURT_CREATE', 'SLOTS_GENERATE', 'SLOTS_GENERATE', 'COURT_PRICES_UPDATE']);
    });

    await t.test('user list excludes sensitive fields and account locking revokes sessions transactionally', async () => {
      const listResponse = await requestJson(
        baseUrl,
        '/api/v1/admin/users?q=Lock%20Target&page=1&page_size=5',
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal(listResponse.status, 200);
      assert.equal(listResponse.headers.get('cache-control'), 'no-cache');
      const listResult = await listResponse.json();
      assert.equal(listResult.users.length, 1);
      assert.equal(listResult.users[0].id, lockTarget.id);
      assert.equal(listResult.users[0].stats.total_bookings, 0);
      assert.doesNotMatch(JSON.stringify(listResult), /password_hash|failed_login_count|token_hash|user_sessions/i);
      const usersEtag = listResponse.headers.get('etag');
      const usersUnchanged = await fetch(
        `${baseUrl}/api/v1/admin/users?q=Lock%20Target&page=1&page_size=5`,
        { headers: { cookie: admin.cookie, 'if-none-match': usersEtag } }
      );
      assert.equal(usersUnchanged.status, 304);

      const selfLock = await requestJson(
        baseUrl,
        `/api/v1/admin/users/${admin.id}/lock`,
        'PATCH',
        {},
        admin.cookie
      );
      assert.equal(selfLock.status, 409);

      const lockResponses = await Promise.all([
        requestJson(baseUrl, `/api/v1/admin/users/${lockTarget.id}/lock`, 'PATCH',
          { reason: 'Kiểm tra đồng thời' }, admin.cookie),
        requestJson(baseUrl, `/api/v1/admin/users/${lockTarget.id}/lock`, 'PATCH',
          { reason: 'Yêu cầu đồng thời khác' }, admin.cookie)
      ]);
      assert.deepEqual(lockResponses.map((response) => response.status).sort(), [200, 409]);
      const expiredSession = await requestJson(baseUrl, '/api/v1/auth/me', 'GET', undefined, lockTarget.cookie);
      assert.equal(expiredSession.status, 401);
      const blockedLogin = await requestJson(
        baseUrl, '/api/v1/auth/login', 'POST',
        { email: lockTarget.email, password }, undefined
      );
      assert.equal(blockedLogin.status, 403);
      assert.match((await blockedLogin.json()).error.message, /đã bị quản trị viên khóa/);
      const [auditRows] = await pool.execute(
        `SELECT action, details FROM admin_audit_logs
         WHERE admin_user_id = ? AND resource_type = ? AND resource_id = ?`,
        [admin.id, 'user', lockTarget.id]
      );
      assert.equal(auditRows.length, 1);
      assert.equal(auditRows[0].action, 'USER_LOCK');
      assert.match(auditRows[0].details, /Kiểm tra đồng thời|Yêu cầu đồng thời khác/);

      const unlock = await requestJson(
        baseUrl, `/api/v1/admin/users/${lockTarget.id}/unlock`, 'PATCH', {}, admin.cookie
      );
      assert.equal(unlock.status, 200);
      assert.equal((await unlock.json()).account_status, 'ACTIVE');
      const loginAgain = await requestJson(
        baseUrl, '/api/v1/auth/login', 'POST',
        { email: lockTarget.email, password }, undefined
      );
      assert.equal(loginAgain.status, 200);
      const oldSessionAfterUnlock = await requestJson(baseUrl, '/api/v1/auth/me', 'GET', undefined, lockTarget.cookie);
      assert.equal(oldSessionAfterUnlock.status, 401);
      const [finalAuditRows] = await pool.execute(
        `SELECT action FROM admin_audit_logs
         WHERE admin_user_id = ? AND resource_type = ? AND resource_id = ?
         ORDER BY id`,
        [admin.id, 'user', lockTarget.id]
      );
      assert.deepEqual(finalAuditRows.map((row) => row.action), ['USER_LOCK', 'USER_UNLOCK']);
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
      assert.equal(response.headers.get('cache-control'), 'no-cache');
      const etag = response.headers.get('etag');
      assert.match(etag, /^W\/".+"$/);
      const result = await response.json();
      assert.match(result.server_time, /^\d{4}-\d{2}-\d{2}T.*Z$/);
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
      const unchanged = await fetch(
        `${baseUrl}/api/v1/admin/bookings?status=CONFIRMED&q=${encodeURIComponent(inProgressBooking.code)}&page=1&page_size=1`,
        { headers: { cookie: admin.cookie, 'if-none-match': etag } }
      );
      assert.equal(unchanged.status, 304);
      assert.equal(unchanged.headers.get('cache-control'), 'no-cache');

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
      const invalidFacility = await requestJson(
        baseUrl,
        '/api/v1/admin/bookings?facility_id=not-a-number',
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal(invalidFacility.status, 400);
      assert.match((await invalidFacility.json()).error.message, /facility_id.*số nguyên dương/);
      const invalidDate = await requestJson(
        baseUrl,
        '/api/v1/admin/bookings?date=2026-02-31',
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal(invalidDate.status, 400);
      assert.match((await invalidDate.json()).error.message, /date.*ngày hợp lệ/);
      for (const query of [
        '?status=UNKNOWN',
        '?page=0',
        '?page_size=51',
        '?facility_id=0',
        '?date=2026-2-3',
        '?date=2026-02-30'
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

    await t.test('admin booking list filters by facility, Vietnam service date, and both together', async () => {
      const byFacilityResponse = await requestJson(
        baseUrl,
        `/api/v1/admin/bookings?facility_id=${facilityId}&page=1&page_size=2`,
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal(byFacilityResponse.status, 200);
      const byFacility = await byFacilityResponse.json();
      assert.equal(byFacility.pagination.total, 5);
      assert.equal(byFacility.pagination.total_pages, 3);
      assert.equal(byFacility.bookings.length, 2);
      assert.ok(byFacility.bookings.every((booking) => booking.slots.some(
        (slot) => slot.facility_id === facilityId
      )));

      const byDateResponse = await requestJson(
        baseUrl,
        `/api/v1/admin/bookings?date=${inProgressBooking.serviceDate}`,
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal(byDateResponse.status, 200);
      const byDate = await byDateResponse.json();
      assert.equal(byDate.pagination.total, 1);
      assert.equal(byDate.pagination.total_pages, 1);
      assert.ok(byDate.bookings.some((booking) => booking.booking_id === inProgressBooking.id));
      assert.ok(byDate.bookings.every((booking) => booking.slots.some(
        (slot) => slot.service_date === inProgressBooking.serviceDate
      )));

      const byBothResponse = await requestJson(
        baseUrl,
        `/api/v1/admin/bookings?facility_id=${facilityId}&date=${inProgressBooking.serviceDate}`,
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal(byBothResponse.status, 200);
      const byBoth = await byBothResponse.json();
      assert.equal(byBoth.pagination.total, 1);
      assert.equal(byBoth.bookings[0].booking_id, inProgressBooking.id);

      const blankFilterResponse = await requestJson(
        baseUrl,
        `/api/v1/admin/bookings?q=${encodeURIComponent(inProgressBooking.code)}&facility_id=&date=`,
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal(blankFilterResponse.status, 200);
      const blankFilters = await blankFilterResponse.json();
      assert.equal(blankFilters.pagination.total, 1);
      assert.equal(blankFilters.bookings[0].booking_id, inProgressBooking.id);

      const byStatusResponse = await requestJson(
        baseUrl,
        `/api/v1/admin/bookings?status=CONFIRMED&facility_id=${facilityId}&date=${inProgressBooking.serviceDate}`,
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal(byStatusResponse.status, 200);
      const byStatus = await byStatusResponse.json();
      assert.equal(byStatus.pagination.total, 1);
      assert.equal(byStatus.bookings[0].booking_id, inProgressBooking.id);
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
          { cancellation_reason: '  Sự cố trong trận  ' },
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
      const [auditRows] = await pool.execute(
        `SELECT action, resource_type, resource_id, details
         FROM admin_audit_logs
         WHERE admin_user_id = ? AND resource_type = ? AND resource_id = ?`,
        [admin.id, 'booking', inProgressBooking.id]
      );
      assert.equal(auditRows.length, 1);
      assert.equal(auditRows[0].action, 'INCIDENT_CANCELLATION');
      assert.doesNotMatch(String(auditRows[0].details), /password|Sự cố trong trận/i);
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
      const [paymentAuditRows] = await pool.execute(
        'SELECT id FROM admin_audit_logs WHERE resource_type = ? AND resource_id = ?',
        ['booking', paymentRollbackBooking.id]
      );
      assert.equal(paymentAuditRows.length, 0);
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
      const [notificationAuditRows] = await pool.execute(
        'SELECT id FROM admin_audit_logs WHERE resource_type = ? AND resource_id = ?',
        ['booking', notificationRollbackBooking.id]
      );
      assert.equal(notificationAuditRows.length, 0);
      await pool.query(`DROP TRIGGER IF EXISTS ${triggerName}`);
      triggerNames.splice(triggerNames.indexOf(triggerName), 1);
    });

    await t.test('dashboard reports four metrics for today, 7d, and 30d using event timestamps', async () => {
      const periods = ['today', '7d', '30d'];
      const before = {};
      const beforeEtags = {};
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
        const etag = response.headers.get('etag');
        assert.ok(etag);
        beforeEtags[period] = etag;
        const unchanged = await fetch(
          `${baseUrl}/api/v1/admin/dashboard?period=${period}`,
          { headers: { cookie: admin.cookie, 'if-none-match': etag } }
        );
        assert.equal(unchanged.status, 304);
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

      const expectedRevenueDeltas = { today: '12000', '7d': '12000', '30d': '32000' };
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
        assert.notEqual(response.headers.get('etag'), beforeEtags[period]);
        assert.equal(after.period, period);
        assert.ok(after.range.from);
        assert.ok(after.range.to);
        assert.equal(after.kpis.pending_match_requests, 0);
        assert.equal(after.revenue_by_day.length, period === 'today' ? 1 : period === '7d' ? 7 : 30);
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
    if (createdCourtIds.length > 0) {
      const placeholders = createdCourtIds.map(() => '?').join(', ');
      await cleanup(() => pool.execute(
        `DELETE FROM courts WHERE id IN (${placeholders})`,
        createdCourtIds
      ));
    }
    if (createdFacilityIds.length > 0) {
      const placeholders = createdFacilityIds.map(() => '?').join(', ');
      await cleanup(() => pool.execute(
        `DELETE FROM facilities WHERE id IN (${placeholders})`,
        createdFacilityIds
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
        `DELETE FROM admin_audit_logs WHERE admin_user_id IN (${placeholders})`,
        userIds
      ));
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
