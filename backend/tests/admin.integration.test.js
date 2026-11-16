'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ExcelJS = require('exceljs');
const test = require('node:test');

if (process.env.APP_ENV !== 'test' || process.env.DB_NAME !== 'sportbooking_test') {
  throw new Error('Admin integration tests require APP_ENV=test and DB_NAME=sportbooking_test.');
}

const { closePool, getPool } = require('../src/config/database');
const { createApp } = require('../src/app');
const {
  dateOffset,
  localDateString,
  readSlotDaysAhead
} = require('../src/facilities/slot-generator');

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
  let exportOverflowPrefix = null;
  let exportOverflowUserPrefix = null;
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
         (name, address, district, opening_time, closing_time, amenities,
          is_active, is_seed, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [
        `Admin test ${suffix}`, 'Integration test address', 'Test district',
        '00:00', '24:00', '[]', true, false
      ]
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
      const forbiddenSlotReads = await Promise.all([
        requestJson(
          baseUrl,
          `/api/v1/admin/courts/${courtId}/time-slots?from=2026-01-01&to=2026-01-07`,
          'GET',
          undefined,
          ordinaryUser.cookie
        ),
        requestJson(
          baseUrl,
          `/api/v1/admin/courts/${courtId}/time-slots/summary?month=2026-01`,
          'GET',
          undefined,
          ordinaryUser.cookie
        )
      ]);
      assert.deepEqual(forbiddenSlotReads.map((response) => response.status), [403, 403]);

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
      const unauthenticatedSlotReads = await Promise.all([
        requestJson(
          baseUrl,
          `/api/v1/admin/courts/${courtId}/time-slots?from=2026-01-01&to=2026-01-07`,
          'GET'
        ),
        requestJson(
          baseUrl,
          `/api/v1/admin/courts/${courtId}/time-slots/summary?month=2026-01`,
          'GET'
        )
      ]);
      assert.deepEqual(unauthenticatedSlotReads.map((response) => response.status), [401, 401]);
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
      assert.equal(Number.isInteger(list.summary.total_facilities), true);
      assert.equal(Number.isInteger(list.summary.active_courts), true);
      assert.equal(Number.isInteger(list.summary.inactive_courts), true);
      assert.equal(Number.isFinite(list.summary.avg_fill_rate_percent), true);
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
      const activeCourtDisable = await requestJson(
        baseUrl, `/api/v1/admin/courts/${courtId}`, 'PATCH',
        { expected_updated_at: detail.courts[0].updated_at, is_active: false }, admin.cookie
      );
      assert.equal(activeCourtDisable.status, 409);
      assert.match((await activeCourtDisable.json()).error.message, /\d+ đơn hiệu lực/);

      const suffix = crypto.randomUUID();
      const created = await requestJson(baseUrl, '/api/v1/admin/facilities', 'POST', {
        name: `Managed facility ${suffix}`,
        address: 'Địa chỉ kiểm thử',
        district: 'Quận kiểm thử',
        opening_time: '06:00',
        closing_time: '24:00',
        amenities: ['Chỗ để xe'],
        is_active: true,
        courts: [{
          name: `Bootstrap court ${suffix}`,
          sport_type: 'BADMINTON',
          price_normal: 100000,
          price_peak: 120000
        }]
      }, admin.cookie);
      assert.equal(created.status, 201);
      const createdFacility = await created.json();
      createdFacilityIds.push(createdFacility.id);
      managedFacilityId = createdFacility.id;
      const createdDetailResponse = await requestJson(
        baseUrl, `/api/v1/admin/facilities/${createdFacility.id}`, 'GET', undefined, admin.cookie
      );
      const createdDetail = await createdDetailResponse.json();
      assert.equal(createdDetail.courts.length, 1);
      createdCourtIds.push(...createdDetail.courts.map((court) => court.id));

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
        {
          expected_updated_at: courtDetail.courts.find((court) => court.id === createdCourt.id).updated_at,
          is_active: false
        }, admin.cookie
      );
      assert.equal(disabledCourt.status, 200);
      const disabledCourtDetail = await requestJson(
        baseUrl, `/api/v1/admin/facilities/${createdFacility.id}`, 'GET', undefined, admin.cookie
      );
      const refreshedCourt = (await disabledCourtDetail.json()).courts
        .find((court) => court.id === createdCourt.id);
      const reopenedCourt = await requestJson(
        baseUrl, `/api/v1/admin/courts/${createdCourt.id}`, 'PATCH',
        { expected_updated_at: refreshedCourt.updated_at, is_active: true }, admin.cookie
      );
      assert.equal(reopenedCourt.status, 200);

      const [auditRows] = await pool.execute(
        `SELECT action, resource_id FROM admin_audit_logs
         WHERE admin_user_id = ? AND resource_id IN (?, ?) ORDER BY id`,
        [admin.id, createdFacility.id, createdCourt.id]
      );
      assert.deepEqual(auditRows.map((row) => row.action),
        ['FACILITY_CREATE', 'FACILITY_UPDATE', 'COURT_CREATE', 'COURT_UPDATE', 'COURT_UPDATE']);
    });

    await t.test('facility creation generates customer-ready hourly slots and pricing', async () => {
      const suffix = crypto.randomUUID();
      const facilityName = `Hourly facility ${suffix}`;
      const beforeSummaryResponse = await requestJson(
        baseUrl, '/api/v1/admin/facilities?is_active=false&page_size=1',
        'GET', undefined, admin.cookie
      );
      const beforeSummary = (await beforeSummaryResponse.json()).summary;
      const created = await requestJson(baseUrl, '/api/v1/admin/facilities', 'POST', {
        name: facilityName,
        address: 'Địa chỉ kiểm thử',
        district: 'Quận kiểm thử',
        opening_time: '06:00',
        closing_time: '19:00',
        amenities: [],
        is_active: true,
        courts: [{
          name: `Hourly court ${suffix}`,
          sport_type: 'BADMINTON',
          price_normal: 100000,
          price_peak: 150000
        }]
      }, admin.cookie);
      assert.equal(created.status, 201);
      const facility = await created.json();
      createdFacilityIds.push(facility.id);
      const afterSummaryResponse = await requestJson(
        baseUrl, '/api/v1/admin/facilities?is_active=true&page_size=1',
        'GET', undefined, admin.cookie
      );
      const afterSummary = (await afterSummaryResponse.json()).summary;
      assert.equal(afterSummary.total_facilities, beforeSummary.total_facilities + 1);
      assert.equal(afterSummary.active_courts, beforeSummary.active_courts + 1);

      const detailResponse = await requestJson(
        baseUrl, `/api/v1/admin/facilities/${facility.id}`, 'GET', undefined, admin.cookie
      );
      const detail = await detailResponse.json();
      assert.equal(detail.courts.length, 1);
      const court = detail.courts[0];
      createdCourtIds.push(court.id);

      const customerFacilitiesResponse = await requestJson(
        baseUrl,
        `/api/v1/facilities?q=${encodeURIComponent(facilityName)}&page_size=50`,
        'GET',
        undefined,
        owner.cookie
      );
      assert.equal(customerFacilitiesResponse.status, 200);
      assert.equal(customerFacilitiesResponse.headers.get('cache-control'), 'no-store');
      const customerFacilities = await customerFacilitiesResponse.json();
      assert.ok(customerFacilities.facilities.some((item) => String(item.id) === String(facility.id)));
      const customerDetailResponse = await requestJson(
        baseUrl, `/api/v1/facilities/${facility.id}`, 'GET', undefined, owner.cookie
      );
      const customerDetail = await customerDetailResponse.json();
      assert.equal(customerDetail.facility.opening_time, '06:00:00');
      assert.equal(customerDetail.facility.closing_time, '19:00:00');

      const firstDate = localDateString();
      const slotDays = readSlotDaysAhead();
      assert.equal(slotDays, 14);
      const rangeResponse = await requestJson(
        baseUrl,
        `/api/v1/admin/courts/${court.id}/time-slots?from=${firstDate}&to=${dateOffset(firstDate, slotDays - 1)}`,
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal(rangeResponse.status, 200);
      const generatedSlots = (await rangeResponse.json()).time_slots;
      assert.equal(generatedSlots.length, 13 * slotDays);
      const slotsByDate = new Map();
      for (const slot of generatedSlots) {
        slotsByDate.set(slot.service_date, (slotsByDate.get(slot.service_date) || 0) + 1);
      }
      assert.equal(slotsByDate.size, slotDays);
      assert.ok([...slotsByDate.values()].every((count) => count === 13));
      assert.equal(Number(generatedSlots.find((slot) => slot.starts_at === '17:00:00').price), 150000);
      assert.equal(Number(generatedSlots.find((slot) => slot.starts_at === '18:00:00').price), 150000);
      assert.equal(Number(generatedSlots.find((slot) => slot.starts_at === '16:00:00').price), 100000);

      const futureDate = dateOffset(firstDate, 1);
      const bookingCustomer = await createUser(`New facility booking ${suffix}`);
      const customerSlotsResponse = await requestJson(
        baseUrl,
        `/api/v1/courts/${court.id}/time-slots?date=${futureDate}`,
        'GET',
        undefined,
        bookingCustomer.cookie
      );
      assert.equal(customerSlotsResponse.status, 200);
      const customerSlots = (await customerSlotsResponse.json()).time_slots;
      assert.equal(customerSlots.length, 13);
      const bookableSlot = customerSlots.find((slot) => slot.starts_at === '18:00:00');
      assert.equal(Number(bookableSlot.price), 150000);
      const bookingResponse = await requestJson(
        baseUrl, '/api/v1/bookings', 'POST',
        { slot_ids: [bookableSlot.id], payment_option: 'FULL' }, bookingCustomer.cookie
      );
      const bookingResult = await bookingResponse.json();
      assert.equal(bookingResponse.status, 201, JSON.stringify(bookingResult));
      bookingIds.push(bookingResult.booking_id);
    });

    await t.test('facility creation rejects partial hours and accepts a 24:00 close', async () => {
      const suffix = crypto.randomUUID();
      const base = {
        address: 'Địa chỉ kiểm thử',
        district: 'Quận kiểm thử',
        amenities: [],
        is_active: true,
        courts: [{
          name: `Boundary court ${suffix}`,
          sport_type: 'BADMINTON',
          price_normal: 100000,
          price_peak: 120000
        }]
      };
      for (const [opening_time, closing_time] of [
        ['06:00', '19:26'],
        ['19:00', '19:00'],
        ['20:00', '19:00']
      ]) {
        const response = await requestJson(baseUrl, '/api/v1/admin/facilities', 'POST', {
          ...base,
          name: `Invalid hours ${suffix} ${opening_time} ${closing_time}`,
          opening_time,
          closing_time
        }, admin.cookie);
        assert.equal(response.status, 400);
        const body = await response.json();
        assert.equal(body.error.code, 'INVALID_OPENING_HOURS');
        assert.match(body.error.message, /Giờ|phút/);
        assert.doesNotMatch(body.error.message, /server error|system error/i);
      }

      const valid = await requestJson(baseUrl, '/api/v1/admin/facilities', 'POST', {
        ...base,
        name: `24-hour close ${suffix}`,
        opening_time: '23:00',
        closing_time: '24:00',
        courts: [{
          ...base.courts[0],
          name: `Boundary court valid ${suffix}`
        }]
      }, admin.cookie);
      assert.equal(valid.status, 201);
      const facility = await valid.json();
      createdFacilityIds.push(facility.id);
      const detailResponse = await requestJson(
        baseUrl, `/api/v1/admin/facilities/${facility.id}`, 'GET', undefined, admin.cookie
      );
      const court = (await detailResponse.json()).courts[0];
      createdCourtIds.push(court.id);
      const slotsResponse = await requestJson(
        baseUrl,
        `/api/v1/admin/courts/${court.id}/time-slots?date=${dateOffset(localDateString(), 1)}`,
        'GET',
        undefined,
        admin.cookie
      );
      const slots = (await slotsResponse.json()).time_slots;
      assert.equal(slots.length, 1);
      assert.equal(slots[0].starts_at, '23:00:00');
      assert.equal(slots[0].ends_at, '24:00:00');
      const missingCourt = await requestJson(baseUrl, '/api/v1/admin/facilities', 'POST', {
        name: `Missing court ${suffix}`,
        address: 'Địa chỉ kiểm thử',
        district: 'Quận kiểm thử',
        opening_time: '06:00',
        closing_time: '19:00',
        amenities: [],
        is_active: true
      }, admin.cookie);
      assert.equal(missingCourt.status, 400);
      assert.match((await missingCourt.json()).error.message, /ít nhất một sân/);
    });

    await t.test('facility status toggles any list position and updates global court summary', async () => {
      const suffix = crypto.randomUUID();
      const ids = [];
      for (let index = 0; index < 3; index += 1) {
        const response = await requestJson(baseUrl, '/api/v1/admin/facilities', 'POST', {
          name: `Toggle position ${index} ${suffix}`,
          address: 'Địa chỉ kiểm thử',
          district: 'Quận kiểm thử',
          opening_time: '06:00',
          closing_time: '22:00',
          amenities: [],
          is_active: true,
          courts: [{
            name: `Toggle court ${index} ${suffix}`,
            sport_type: 'BADMINTON',
            price_normal: 100000,
            price_peak: 120000,
            is_active: true
          }]
        }, admin.cookie);
        assert.equal(response.status, 201);
        const facility = await response.json();
        createdFacilityIds.push(facility.id);
        ids.push(facility.id);
        const detailResponse = await requestJson(
          baseUrl, `/api/v1/admin/facilities/${facility.id}`, 'GET', undefined, admin.cookie
        );
        const detail = await detailResponse.json();
        createdCourtIds.push(...detail.courts.map((court) => court.id));
      }

      const initialListResponse = await requestJson(
        baseUrl, '/api/v1/admin/facilities?page=1&page_size=50', 'GET', undefined, admin.cookie
      );
      const initialList = await initialListResponse.json();
      const orderedIds = initialList.facilities
        .filter((facility) => ids.includes(facility.id))
        .map((facility) => facility.id);
      assert.equal(orderedIds.length, 3);
      const baselineActive = initialList.summary.active_courts;
      const baselineInactive = initialList.summary.inactive_courts;

      for (const id of [orderedIds[1], orderedIds[2], orderedIds[0]]) {
        const detailResponse = await requestJson(
          baseUrl, `/api/v1/admin/facilities/${id}`, 'GET', undefined, admin.cookie
        );
        const detail = await detailResponse.json();
        const disabled = await requestJson(
          baseUrl, `/api/v1/admin/facilities/${id}`, 'PATCH',
          { expected_updated_at: detail.facility.updated_at, is_active: false }, admin.cookie
        );
        assert.equal(disabled.status, 200);
        const disabledDetailResponse = await requestJson(
          baseUrl, `/api/v1/admin/facilities/${id}`, 'GET', undefined, admin.cookie
        );
        const disabledDetail = await disabledDetailResponse.json();
        assert.equal(disabledDetail.courts[0].is_active, true);

        const disabledListResponse = await requestJson(
          baseUrl, '/api/v1/admin/facilities?is_active=true&page_size=1',
          'GET', undefined, admin.cookie
        );
        const disabledSummary = (await disabledListResponse.json()).summary;
        assert.equal(disabledSummary.active_courts, baselineActive - 1);
        assert.equal(disabledSummary.inactive_courts, baselineInactive + 1);

        const enabled = await requestJson(
          baseUrl, `/api/v1/admin/facilities/${id}`, 'PATCH',
          { expected_updated_at: disabledDetail.facility.updated_at, is_active: true }, admin.cookie
        );
        assert.equal(enabled.status, 200);
        const enabledDetailResponse = await requestJson(
          baseUrl, `/api/v1/admin/facilities/${id}`, 'GET', undefined, admin.cookie
        );
        assert.equal((await enabledDetailResponse.json()).courts[0].is_active, true);
      }

      const finalListResponse = await requestJson(
        baseUrl, '/api/v1/admin/facilities?is_active=false&page_size=1',
        'GET', undefined, admin.cookie
      );
      const finalSummary = (await finalListResponse.json()).summary;
      assert.equal(finalSummary.active_courts, baselineActive);
      assert.equal(finalSummary.inactive_courts, baselineInactive);
    });

    await t.test('facility pauses and reopens without reactivating an individually disabled court', async () => {
      const suffix = crypto.randomUUID();
      const created = await requestJson(baseUrl, '/api/v1/admin/facilities', 'POST', {
        name: `No cascade facility ${suffix}`,
        address: 'Địa chỉ kiểm thử',
        district: 'Quận kiểm thử',
        opening_time: '06:00',
        closing_time: '19:00',
        amenities: [],
        is_active: true,
        courts: [{
          name: `Individually disabled court ${suffix}`,
          sport_type: 'BADMINTON',
          price_normal: 100000,
          price_peak: 120000,
          is_active: true
        }]
      }, admin.cookie);
      assert.equal(created.status, 201);
      const facility = await created.json();
      createdFacilityIds.push(facility.id);
      const initialResponse = await requestJson(
        baseUrl, `/api/v1/admin/facilities/${facility.id}`, 'GET', undefined, admin.cookie
      );
      const initial = await initialResponse.json();
      const court = initial.courts[0];
      createdCourtIds.push(court.id);
      const beforeToggleSummaryResponse = await requestJson(
        baseUrl, '/api/v1/admin/facilities?is_active=false&page_size=1',
        'GET', undefined, admin.cookie
      );
      const beforeToggleSummary = (await beforeToggleSummaryResponse.json()).summary;

      const disabledCourt = await requestJson(
        baseUrl,
        `/api/v1/admin/courts/${court.id}`,
        'PATCH',
        { expected_updated_at: court.updated_at, is_active: false },
        admin.cookie
      );
      assert.equal(disabledCourt.status, 200);
      const afterCourtDisableResponse = await requestJson(
        baseUrl, '/api/v1/admin/facilities?is_active=true&page_size=1',
        'GET', undefined, admin.cookie
      );
      const afterCourtDisable = (await afterCourtDisableResponse.json()).summary;
      assert.equal(afterCourtDisable.active_courts, beforeToggleSummary.active_courts - 1);
      assert.equal(afterCourtDisable.inactive_courts, beforeToggleSummary.inactive_courts + 1);

      const beforePauseResponse = await requestJson(
        baseUrl, `/api/v1/admin/facilities/${facility.id}`, 'GET', undefined, admin.cookie
      );
      const beforePause = await beforePauseResponse.json();
      const paused = await requestJson(
        baseUrl,
        `/api/v1/admin/facilities/${facility.id}`,
        'PATCH',
        { expected_updated_at: beforePause.facility.updated_at, is_active: false },
        admin.cookie
      );
      assert.equal(paused.status, 200);

      const beforeReopenResponse = await requestJson(
        baseUrl, `/api/v1/admin/facilities/${facility.id}`, 'GET', undefined, admin.cookie
      );
      const beforeReopen = await beforeReopenResponse.json();
      assert.equal(beforeReopen.courts[0].is_active, false);
      const reopened = await requestJson(
        baseUrl,
        `/api/v1/admin/facilities/${facility.id}`,
        'PATCH',
        { expected_updated_at: beforeReopen.facility.updated_at, is_active: true },
        admin.cookie
      );
      assert.equal(reopened.status, 200);

      const afterReopenResponse = await requestJson(
        baseUrl, `/api/v1/admin/facilities/${facility.id}`, 'GET', undefined, admin.cookie
      );
      const afterReopen = await afterReopenResponse.json();
      assert.equal(afterReopen.facility.is_active, true);
      assert.equal(afterReopen.courts[0].is_active, false);
      const afterReopenSummaryResponse = await requestJson(
        baseUrl, '/api/v1/admin/facilities?is_active=false&page_size=1',
        'GET', undefined, admin.cookie
      );
      const afterReopenSummary = (await afterReopenSummaryResponse.json()).summary;
      assert.equal(afterReopenSummary.active_courts, afterCourtDisable.active_courts);
      assert.equal(afterReopenSummary.inactive_courts, afterCourtDisable.inactive_courts);
    });

    await t.test('facility hour updates synchronize customer and admin slot grids', async () => {
      const suffix = crypto.randomUUID();
      const createdFacility = await requestJson(baseUrl, '/api/v1/admin/facilities', 'POST', {
        name: `Hours facility ${suffix}`,
        address: 'Địa chỉ kiểm thử',
        district: 'Quận kiểm thử',
        opening_time: '08:00',
        closing_time: '20:00',
        amenities: [],
        is_active: true,
        courts: [{
          name: `Bootstrap hours court ${suffix}`,
          sport_type: 'BADMINTON',
          price_normal: 100000,
          price_peak: 120000
        }]
      }, admin.cookie);
      assert.equal(createdFacility.status, 201);
      const facility = await createdFacility.json();
      createdFacilityIds.push(facility.id);
      const initialFacilityDetail = await requestJson(
        baseUrl, `/api/v1/admin/facilities/${facility.id}`, 'GET', undefined, admin.cookie
      );
      createdCourtIds.push(...(await initialFacilityDetail.json()).courts.map((court) => court.id));

      const createdCourt = await requestJson(baseUrl, '/api/v1/admin/courts', 'POST', {
        facility_id: facility.id,
        name: `Hours court ${suffix}`,
        sport_type: 'BADMINTON',
        price_normal: 100000,
        price_peak: 120000
      }, admin.cookie);
      assert.equal(createdCourt.status, 201);
      const court = await createdCourt.json();
      createdCourtIds.push(court.id);

      const serviceDate = dateOffset(localDateString(), 1);
      const generated = await requestJson(
        baseUrl,
        `/api/v1/admin/courts/${court.id}/generate-slots`,
        'POST',
        { from_date: serviceDate, to_date: serviceDate },
        admin.cookie
      );
      assert.equal(generated.status, 201);

      const beforeExpansionResponse = await requestJson(
        baseUrl, `/api/v1/admin/facilities/${facility.id}`, 'GET', undefined, admin.cookie
      );
      const beforeExpansion = await beforeExpansionResponse.json();
      const expanded = await requestJson(
        baseUrl,
        `/api/v1/admin/facilities/${facility.id}`,
        'PATCH',
        {
          expected_updated_at: beforeExpansion.facility.updated_at,
          opening_time: '06:00',
          closing_time: '22:00'
        },
        admin.cookie
      );
      assert.equal(expanded.status, 200);
      const expandedSlotsResponse = await requestJson(
        baseUrl,
        `/api/v1/admin/courts/${court.id}/time-slots?date=${serviceDate}`,
        'GET',
        undefined,
        admin.cookie
      );
      const expandedSlots = (await expandedSlotsResponse.json()).time_slots;
      assert.equal(expandedSlots.length, 16);
      assert.equal(expandedSlots[0].starts_at, '06:00:00');
      assert.equal(expandedSlots[15].starts_at, '21:00:00');

      const initialSlotsResponse = await requestJson(
        baseUrl,
        `/api/v1/admin/courts/${court.id}/time-slots?date=${serviceDate}`,
        'GET',
        undefined,
        admin.cookie
      );
      const initialSlots = (await initialSlotsResponse.json()).time_slots;
      const bookedSlot = initialSlots.find((slot) => slot.starts_at === '09:00:00');
      const outsideSlot = initialSlots.find((slot) => slot.starts_at === '19:00:00');
      assert.ok(bookedSlot);
      assert.ok(outsideSlot);

      async function attachBooking(slot, status) {
        const code = `SPB-HRS-${crypto.randomUUID().replaceAll('-', '')}`;
        const lockExpiresAt = status === 'PENDING'
          ? new Date(Date.now() + 10 * 60 * 1000)
          : null;
        const [bookingResult] = await pool.execute(
          `INSERT INTO bookings
             (booking_code, user_id, status, total_amount, match_preference, lock_expires_at,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [code, owner.id, status, '100000', null, lockExpiresAt]
        );
        const bookingId = String(bookingResult.insertId);
        bookingIds.push(bookingId);
        await pool.execute(
          `INSERT INTO booking_slots
             (booking_id, time_slot_id, court_id, price_at_booking, created_at)
           VALUES (?, ?, ?, ?, UTC_TIMESTAMP(3))`,
          [bookingId, slot.id, court.id, '100000']
        );
        await pool.execute(
          `UPDATE time_slots
           SET status = ?, current_booking_id = ?, lock_expires_at = ?
           WHERE id = ?`,
          [status === 'PENDING' ? 'LOCKED' : 'BOOKED', bookingId, lockExpiresAt, slot.id]
        );
        return bookingId;
      }

      await attachBooking(bookedSlot, 'CONFIRMED');
      const outsideBookingId = await attachBooking(outsideSlot, 'PENDING');
      const detailResponse = await requestJson(
        baseUrl, `/api/v1/admin/facilities/${facility.id}`, 'GET', undefined, admin.cookie
      );
      const detail = await detailResponse.json();
      const rejectedUpdate = await requestJson(
        baseUrl,
        `/api/v1/admin/facilities/${facility.id}`,
        'PATCH',
        {
          expected_updated_at: detail.facility.updated_at,
          opening_time: '06:00',
          closing_time: '18:00'
        },
        admin.cookie
      );
      assert.equal(rejectedUpdate.status, 409);
      const rejectedBody = await rejectedUpdate.json();
      assert.equal(rejectedBody.error.code, 'FACILITY_HAS_ACTIVE_BOOKINGS');
      assert.match(rejectedBody.error.message, /1 đơn hiệu lực/);
      const [unchangedHours] = await pool.execute(
        'SELECT closing_time FROM facilities WHERE id = ?',
        [facility.id]
      );
      assert.equal(String(unchangedHours[0].closing_time), '22:00:00');

      await pool.execute(
        'UPDATE bookings SET status = ? WHERE id = ?',
        ['CANCELLED', outsideBookingId]
      );
      await pool.execute(
        `UPDATE time_slots
         SET status = 'AVAILABLE', current_booking_id = NULL, lock_expires_at = NULL
         WHERE id = ?`,
        [outsideSlot.id]
      );
      const appliedUpdate = await requestJson(
        baseUrl,
        `/api/v1/admin/facilities/${facility.id}`,
        'PATCH',
        {
          expected_updated_at: detail.facility.updated_at,
          opening_time: '06:00',
          closing_time: '18:00'
        },
        admin.cookie
      );
      assert.equal(appliedUpdate.status, 200);

      const adminDetailResponse = await requestJson(
        baseUrl, `/api/v1/admin/facilities/${facility.id}`, 'GET', undefined, admin.cookie
      );
      const adminDetail = await adminDetailResponse.json();
      const customerDetailResponse = await requestJson(
        baseUrl, `/api/v1/facilities/${facility.id}`, 'GET', undefined, owner.cookie
      );
      assert.equal(customerDetailResponse.headers.get('cache-control'), 'no-store');
      const customerDetail = await customerDetailResponse.json();
      assert.equal(adminDetail.facility.opening_time, '06:00:00');
      assert.equal(adminDetail.facility.closing_time, '18:00:00');
      assert.equal(customerDetail.facility.closing_time, adminDetail.facility.closing_time);

      const customerSlotsResponse = await requestJson(
        baseUrl,
        `/api/v1/courts/${court.id}/time-slots?date=${serviceDate}`,
        'GET',
        undefined,
        owner.cookie
      );
      assert.equal(customerSlotsResponse.headers.get('cache-control'), 'no-store');
      const customerSlots = (await customerSlotsResponse.json()).time_slots;
      const adminSlotsResponse = await requestJson(
        baseUrl,
        `/api/v1/admin/courts/${court.id}/time-slots?date=${serviceDate}`,
        'GET',
        undefined,
        admin.cookie
      );
      const adminSlots = (await adminSlotsResponse.json()).time_slots;
      const expectedStarts = Array.from({ length: 12 }, (_, index) => (
        `${String(index + 6).padStart(2, '0')}:00:00`
      ));
      assert.deepEqual(customerSlots.map((slot) => slot.starts_at), expectedStarts);
      assert.deepEqual(adminSlots.map((slot) => slot.starts_at), expectedStarts);
      assert.equal(customerSlots.find((slot) => slot.starts_at === '09:00:00').status, 'BOOKED');
      assert.equal(adminSlots.find((slot) => slot.starts_at === '09:00:00').status, 'BOOKED');

      const staleCustomer = await createUser(`Hours booking ${suffix}`);
      const staleBooking = await requestJson(
        baseUrl,
        '/api/v1/bookings',
        'POST',
        { slot_ids: [outsideSlot.id], payment_option: 'FULL' },
        staleCustomer.cookie
      );
      assert.equal(staleBooking.status, 409);
      assert.equal((await staleBooking.json()).error.code, 'SLOT_OUTSIDE_OPENING_HOURS');
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

      const autoGeneratedSlotsResponse = await requestJson(
        baseUrl,
        `/api/v1/admin/courts/${generatedCourtId}/time-slots?date=${localDateString()}`,
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal(autoGeneratedSlotsResponse.status, 200);
      assert.equal((await autoGeneratedSlotsResponse.json()).time_slots.length, 18);

      const fromDate = dateOffset(localDateString(), readSlotDaysAhead());
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

      async function addSlotBooking(status, startsAt) {
        const [slotRows] = await pool.execute(
          `SELECT id FROM time_slots
           WHERE court_id = ? AND service_date = ? AND starts_at = ?`,
          [generatedCourtId, fromDate, startsAt]
        );
        assert.equal(slotRows.length, 1);
        const slotId = String(slotRows[0].id);
        const lockExpiresAt = status === 'PENDING'
          ? new Date(Date.now() + 10 * 60_000)
          : null;
        const [bookingResult] = await pool.execute(
          `INSERT INTO bookings
             (booking_code, user_id, status, total_amount, match_preference,
              lock_expires_at, created_at, updated_at)
           VALUES (?, ?, ?, '120000', NULL, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [
            `SPB-ADM-${crypto.randomUUID().replaceAll('-', '')}`,
            owner.id,
            status,
            lockExpiresAt
          ]
        );
        const bookingId = String(bookingResult.insertId);
        bookingIds.push(bookingId);
        await pool.execute(
          `INSERT INTO booking_slots
             (booking_id, time_slot_id, court_id, price_at_booking, created_at)
           VALUES (?, ?, ?, '120000', UTC_TIMESTAMP(3))`,
          [bookingId, slotId, generatedCourtId]
        );
        await pool.execute(
          `UPDATE time_slots
           SET status = ?, current_booking_id = ?, lock_expires_at = ?
           WHERE id = ?`,
          [status === 'PENDING' ? 'LOCKED' : 'BOOKED', bookingId, lockExpiresAt, slotId]
        );
        return { bookingId, slotId };
      }

      const heldSlot = await addSlotBooking('PENDING', '06:00:00');
      const bookedSlot = await addSlotBooking('CONFIRMED', '17:00:00');
      const facilityDetailResponse = await requestJson(
        baseUrl, `/api/v1/admin/facilities/${managedFacilityId}`, 'GET', undefined, admin.cookie
      );
      const courtDetail = (await facilityDetailResponse.json()).courts
        .find((court) => court.id === generatedCourtId);
      assert.ok(courtDetail);
      const slotUrl = `${baseUrl}/api/v1/admin/courts/${generatedCourtId}/time-slots?date=${fromDate}&from_date=${fromDate}`;
      const beforePriceResponse = await fetch(slotUrl, { headers: { cookie: admin.cookie } });
      assert.equal(beforePriceResponse.status, 200);
      const slotsEtag = beforePriceResponse.headers.get('etag');
      const beforePriceSlots = await beforePriceResponse.json();
      assert.equal(beforePriceSlots.price_preview.available_slots, 34);
      const unchangedSlots = await fetch(slotUrl, {
        headers: { cookie: admin.cookie, 'if-none-match': slotsEtag }
      });
      assert.equal(unchangedSlots.status, 304);
      const rangeSlots = await requestJson(
        baseUrl,
        `/api/v1/admin/courts/${generatedCourtId}/time-slots?from=${fromDate}&to=${toDate}`,
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal(rangeSlots.status, 200);
      assert.equal((await rangeSlots.json()).time_slots.length, 36);
      const invalidRange = await requestJson(
        baseUrl,
        `/api/v1/admin/courts/${generatedCourtId}/time-slots?from=${fromDate}&to=${dateOffset(fromDate, 31)}`,
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal(invalidRange.status, 400);
      const monthlySummary = await requestJson(
        baseUrl,
        `/api/v1/admin/courts/${generatedCourtId}/time-slots/summary?month=${fromDate.slice(0, 7)}`,
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal(monthlySummary.status, 200);
      const monthResult = await monthlySummary.json();
      assert.equal(monthResult.days[0].date, `${fromDate.slice(0, 7)}-01`);
      assert.ok(monthResult.days.some((day) => day.date === fromDate));
      const invalidMonth = await requestJson(
        baseUrl,
        `/api/v1/admin/courts/${generatedCourtId}/time-slots/summary?month=2026-13`,
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal(invalidMonth.status, 400);
      const previewPrices = await requestJson(
        baseUrl,
        `/api/v1/admin/courts/${generatedCourtId}/prices?dry_run=true`,
        'PATCH',
        {
          price_normal: 110000,
          price_peak: 150000,
          expected_updated_at: courtDetail.updated_at
        },
        admin.cookie
      );
      assert.equal(previewPrices.status, 200);
      const [priceAffectedRows] = await pool.execute(
        `SELECT COUNT(*) AS total
         FROM time_slots
         WHERE court_id = ? AND service_date >= ? AND status = 'AVAILABLE'`,
        [generatedCourtId, localDateString()]
      );
      assert.equal((await previewPrices.json()).affected_slots, Number(priceAffectedRows[0].total));
      const partialPreview = await requestJson(
        baseUrl,
        `/api/v1/admin/courts/${generatedCourtId}/prices?dry_run=true`,
        'PATCH',
        { price_normal: 105000, expected_updated_at: courtDetail.updated_at },
        admin.cookie
      );
      assert.equal(partialPreview.status, 200);
      assert.ok((await partialPreview.json()).affected_slots > 0);
      const unchangedCourtPrices = await pool.execute(
        'SELECT price_normal, price_peak FROM courts WHERE id = ?',
        [generatedCourtId]
      );
      assert.equal(String(unchangedCourtPrices[0][0].price_normal), '100000');
      assert.equal(String(unchangedCourtPrices[0][0].price_peak), '120000');
      const invalidPrice = await requestJson(
        baseUrl,
        `/api/v1/admin/courts/${generatedCourtId}/prices`,
        'PATCH',
        { price_normal: 999, expected_updated_at: courtDetail.updated_at },
        admin.cookie
      );
      assert.equal(invalidPrice.status, 400);
      const partialPriceUpdate = await requestJson(
        baseUrl,
        `/api/v1/admin/courts/${generatedCourtId}/prices`,
        'PATCH',
        { price_normal: 105000, expected_updated_at: courtDetail.updated_at },
        admin.cookie
      );
      assert.equal(partialPriceUpdate.status, 200);
      const partialPriceResult = await partialPriceUpdate.json();
      assert.ok(partialPriceResult.affected_slots > 0);
      const currentCourtDetailResponse = await requestJson(
        baseUrl,
        `/api/v1/admin/facilities/${managedFacilityId}`,
        'GET',
        undefined,
        admin.cookie
      );
      const currentCourtDetail = (await currentCourtDetailResponse.json()).courts
        .find((court) => court.id === generatedCourtId);
      const priceUpdate = await requestJson(
        baseUrl, `/api/v1/admin/courts/${generatedCourtId}/prices`, 'PATCH',
        {
          price_normal: 110000,
          price_peak: 150000,
          expected_updated_at: currentCourtDetail.updated_at
        }, admin.cookie
      );
      assert.equal(priceUpdate.status, 200);
      const priceResult = await priceUpdate.json();
      assert.equal(priceResult.affected_slots, Number(priceAffectedRows[0].total));
      await pool.execute(
        `UPDATE bookings
         SET lock_expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE)
         WHERE id = ?`,
        [heldSlot.bookingId]
      );
      await pool.execute(
        `UPDATE time_slots
         SET lock_expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 MINUTE)
         WHERE id = ?`,
        [heldSlot.slotId]
      );
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
      const publicFacility = await requestJson(
        baseUrl,
        `/api/v1/facilities/${managedFacilityId}`,
        'GET',
        undefined,
        owner.cookie
      );
      assert.equal(publicFacility.status, 200);
      assert.equal(publicFacility.headers.get('cache-control'), 'no-store');
      const publicFacilityResult = await publicFacility.json();
      const publicCourt = publicFacilityResult.courts.find(
        (court) => String(court.id) === String(generatedCourtId)
      );
      assert.equal(Number(publicCourt.price_normal), 110000);
      assert.equal(Number(publicCourt.price_peak), 150000);
      const publicSearch = await requestJson(
        baseUrl,
        `/api/v1/facilities?q=${encodeURIComponent('Managed facility')}&page_size=50`,
        'GET',
        undefined,
        owner.cookie
      );
      assert.equal(publicSearch.status, 200);
      assert.equal(publicSearch.headers.get('cache-control'), 'no-store');
      const searchFacility = (await publicSearch.json()).facilities.find(
        (facility) => String(facility.id) === String(managedFacilityId)
      );
      assert.ok(searchFacility);
      assert.equal(Number(searchFacility.price_max), 150000);
      const publicSlots = await requestJson(
        baseUrl,
        `/api/v1/courts/${generatedCourtId}/time-slots?date=${fromDate}`,
        'GET',
        undefined,
        owner.cookie
      );
      assert.equal(publicSlots.status, 200);
      assert.equal(publicSlots.headers.get('cache-control'), 'no-store');
      const publicSlotRows = (await publicSlots.json()).time_slots;
      assert.equal(String(publicSlotRows.find((slot) => slot.starts_at === '18:00:00').price), '150000');
      assert.equal(String(publicSlotRows.find((slot) => slot.starts_at === '06:00:00').price), '100000');
      const [newBookingSlotRows] = await pool.execute(
        `SELECT id FROM time_slots
         WHERE court_id = ? AND service_date = ? AND starts_at = '18:00:00' AND status = 'AVAILABLE'`,
        [generatedCourtId, fromDate]
      );
      assert.equal(newBookingSlotRows.length, 1);
      const newBookingUser = await createUser('Price Update Booking Integration Test');
      const newBookingResponse = await requestJson(
        baseUrl,
        '/api/v1/bookings',
        'POST',
        { slot_ids: [String(newBookingSlotRows[0].id)], payment_option: 'FULL' },
        newBookingUser.cookie
      );
      assert.equal(newBookingResponse.status, 201);
      const newBookingResult = await newBookingResponse.json();
      bookingIds.push(newBookingResult.booking_id);
      assert.equal(newBookingResult.total_amount, '150000');
      assert.equal(newBookingResult.slots[0].price, '150000');
      const updatedSlotsEtag = changedSlots.headers.get('etag');
      const slotsAfterBooking = await fetch(slotUrl, {
        headers: { cookie: admin.cookie, 'if-none-match': updatedSlotsEtag }
      });
      assert.equal(slotsAfterBooking.status, 200);
      const slotsAfterBookingResult = await slotsAfterBooking.json();
      const bookedUpdatedSlot = slotsAfterBookingResult.time_slots.find(
        (slot) => slot.starts_at === '18:00:00'
      );
      assert.ok(bookedUpdatedSlot, JSON.stringify(slotsAfterBookingResult.time_slots));
      assert.equal(bookedUpdatedSlot.status, 'LOCKED');

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
        ['COURT_CREATE', 'SLOTS_GENERATE', 'SLOTS_GENERATE', 'COURT_PRICES_UPDATE', 'COURT_PRICES_UPDATE']);
      const temporaryBookingIds = [heldSlot.bookingId, bookedSlot.bookingId];
      const placeholders = temporaryBookingIds.map(() => '?').join(', ');
      await pool.execute(
        `DELETE FROM booking_slots WHERE booking_id IN (${placeholders})`,
        temporaryBookingIds
      );
      await pool.execute(
        `UPDATE time_slots
         SET status = 'AVAILABLE', current_booking_id = NULL, lock_expires_at = NULL
         WHERE current_booking_id IN (${placeholders})`,
        temporaryBookingIds
      );
      await pool.execute(
        `DELETE FROM bookings WHERE id IN (${placeholders})`,
        temporaryBookingIds
      );
      for (const bookingId of temporaryBookingIds) {
        bookingIds.splice(bookingIds.indexOf(bookingId), 1);
      }
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
      assert.ok(listResult.summary.total_users >= listResult.pagination.total);
      assert.equal(
        listResult.summary.active_users + listResult.summary.locked_users,
        listResult.summary.total_users
      );
      assert.ok(listResult.summary.new_users_this_month >= 1);
      const unfilteredSummary = await requestJson(
        baseUrl,
        '/api/v1/admin/users?q=No%20matching%20account&page=1&page_size=5',
        'GET',
        undefined,
        admin.cookie
      );
      assert.deepEqual((await unfilteredSummary.json()).summary, listResult.summary);
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

      const secondLogin = await requestJson(
        baseUrl, '/api/v1/auth/login', 'POST',
        { email: lockTarget.email, password }, undefined
      );
      assert.equal(secondLogin.status, 200);
      const secondSessionCookie = secondLogin.headers.get('set-cookie').split(';', 1)[0];
      const lockResponses = await Promise.all([
        requestJson(baseUrl, `/api/v1/admin/users/${lockTarget.id}/lock`, 'PATCH',
          { reason: 'Kiểm tra đồng thời' }, admin.cookie),
        requestJson(baseUrl, `/api/v1/admin/users/${lockTarget.id}/lock`, 'PATCH',
          { reason: 'Yêu cầu đồng thời khác' }, admin.cookie)
      ]);
      assert.deepEqual(lockResponses.map((response) => response.status).sort(), [200, 409]);
      const expiredSession = await requestJson(baseUrl, '/api/v1/auth/me', 'GET', undefined, lockTarget.cookie);
      assert.equal(expiredSession.status, 401);
      assert.deepEqual((await expiredSession.json()).error, {
        code: 'ACCOUNT_LOCKED',
        message: 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên để được hỗ trợ.',
        details: {}
      });
      for (const [path, method, body] of [
        ['/api/v1/users/me', 'GET'],
        ['/api/v1/notifications', 'GET'],
        ['/api/v1/bookings', 'GET']
      ]) {
        const blocked = await requestJson(baseUrl, path, method, body, secondSessionCookie);
        assert.equal(blocked.status, 401, path);
        assert.equal((await blocked.json()).error.code, 'ACCOUNT_LOCKED', path);
      }
      const secondExpiredSession = await requestJson(
        baseUrl, '/api/v1/auth/me', 'GET', undefined, secondSessionCookie
      );
      assert.equal(secondExpiredSession.status, 401);
      assert.equal((await secondExpiredSession.json()).error.code, 'ACCOUNT_LOCKED');
      const blockedLogin = await requestJson(
        baseUrl, '/api/v1/auth/login', 'POST',
        { email: lockTarget.email, password }, undefined
      );
      assert.equal(blockedLogin.status, 403);
      assert.equal((await blockedLogin.json()).error.message,
        'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên để được hỗ trợ.');
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
      const newSessionCookie = loginAgain.headers.get('set-cookie').split(';', 1)[0];
      assert.equal((await requestJson(
        baseUrl, '/api/v1/auth/me', 'GET', undefined, newSessionCookie
      )).status, 200);
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
        `/api/v1/admin/bookings?status=CONFIRMED&q=${encodeURIComponent(inProgressBooking.code)}&page=1`,
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
      assert.equal(result.pagination.page_size, 10);
      assert.equal(result.bookings[0].booking_id, inProgressBooking.id);
      assert.equal(result.bookings[0].owner.full_name, owner.fullName);
      assert.equal(result.bookings[0].owner.email, owner.email);
      assert.ok(result.bookings[0].owner.phone);
      assert.equal(result.bookings[0].slots.length, 1);
      assert.equal(result.bookings[0].slots[0].time_slot_id, inProgressBooking.slotId);
      const unchanged = await fetch(
        `${baseUrl}/api/v1/admin/bookings?status=CONFIRMED&q=${encodeURIComponent(inProgressBooking.code)}&page=1`,
        { headers: { cookie: admin.cookie, 'if-none-match': etag } }
      );
      assert.equal(unchanged.status, 304);
      assert.equal(unchanged.headers.get('cache-control'), 'no-cache');

      const firstPage = await requestJson(
        baseUrl,
        '/api/v1/admin/bookings?page=1',
        'GET',
        undefined,
        admin.cookie
      );
      const firstPageResult = await firstPage.json();
      assert.equal(
        firstPageResult.bookings.length,
        Math.min(firstPageResult.pagination.page_size, firstPageResult.pagination.total)
      );
      assert.equal(firstPageResult.pagination.page_size, 10);
      assert.equal(
        Object.values(firstPageResult.status_counts).reduce((sum, count) => sum + count, 0),
        firstPageResult.pagination.total
      );
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
        '?page_size=1',
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

    await t.test('booking detail endpoint returns the full popup data behind admin authorization', async () => {
      const path = `/api/v1/admin/bookings/${inProgressBooking.id}`;
      const unauthenticated = await requestJson(baseUrl, path, 'GET');
      assert.equal(unauthenticated.status, 401);
      const forbidden = await requestJson(baseUrl, path, 'GET', undefined, ordinaryUser.cookie);
      assert.equal(forbidden.status, 403);
      const response = await requestJson(baseUrl, path, 'GET', undefined, admin.cookie);
      assert.equal(response.status, 200);
      const { booking } = await response.json();
      assert.equal(booking.booking_id, inProgressBooking.id);
      assert.equal(booking.owner.full_name, owner.fullName);
      assert.ok(booking.owner.phone);
      assert.equal(booking.owner.email, owner.email);
      assert.equal(booking.payment_option, 'FULL');
      assert.equal(booking.total_amount, '120000');
      assert.equal(booking.slots.length, 1);
      assert.equal(booking.slots[0].time_slot_id, inProgressBooking.slotId);
    });

    await t.test('admin booking list filters by facility, Vietnam service date, and both together', async () => {
      const byFacilityResponse = await requestJson(
        baseUrl,
        `/api/v1/admin/bookings?facility_id=${facilityId}&page=1`,
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal(byFacilityResponse.status, 200);
      const byFacility = await byFacilityResponse.json();
      assert.equal(byFacility.pagination.total, 5);
      assert.equal(byFacility.pagination.total_pages, 1);
      assert.equal(byFacility.bookings.length, 5);
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

    await t.test('admin booking export enforces authorization, filters rows, escapes formulas, and caps at 5000', async () => {
      const exportPath = `/api/v1/admin/bookings/export?facility_id=${facilityId}&date=${inProgressBooking.serviceDate}&q=${encodeURIComponent(inProgressBooking.code)}`;
      const unauthenticated = await requestJson(baseUrl, exportPath, 'GET');
      assert.equal(unauthenticated.status, 401);
      const forbidden = await requestJson(
        baseUrl, exportPath, 'GET', undefined, ordinaryUser.cookie
      );
      assert.equal(forbidden.status, 403);

      await pool.execute('UPDATE users SET full_name = ? WHERE id = ?', ['=1+1', owner.id]);
      try {
        const response = await requestJson(baseUrl, exportPath, 'GET', undefined, admin.cookie);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('cache-control'), 'no-store');
        assert.equal(
          response.headers.get('content-type'),
          'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        );
        assert.match(
          response.headers.get('content-disposition'),
          /filename="don-dat-san-\d{8}-\d{4}\.xlsx"/
        );
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
        const worksheet = workbook.getWorksheet('Đơn đặt sân');
        assert.ok(worksheet);
        assert.equal(worksheet.rowCount, 2);
        assert.deepEqual(worksheet.getRow(1).values.slice(1), [
          'Mã đơn', 'Khách hàng', 'SĐT', 'Email', 'Cơ sở', 'Sân', 'Ngày chơi',
          'Khung giờ', 'Trạng thái', 'Tổng tiền', 'Đã trả', 'Đã hoàn',
          'Thời điểm đặt', 'Người hủy', 'Lý do hủy'
        ]);
        assert.equal(worksheet.getCell('A2').value, inProgressBooking.code);
        assert.equal(worksheet.getCell('B2').value, "'=1+1");
        assert.ok(['Sắp tới', 'Đang trong trận', 'Hoàn thành'].includes(
          worksheet.getCell('I2').value
        ));
        assert.equal(worksheet.getCell('K2').value, 45123);
      } finally {
        await pool.execute('UPDATE users SET full_name = ? WHERE id = ?', [owner.fullName, owner.id]);
      }

      const completedResponse = await requestJson(
        baseUrl,
        `/api/v1/admin/bookings/export?status=COMPLETED&q=${encodeURIComponent(completedBooking.code)}`,
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal(completedResponse.status, 200);
      const completedWorkbook = new ExcelJS.Workbook();
      await completedWorkbook.xlsx.load(Buffer.from(await completedResponse.arrayBuffer()));
      const completedSheet = completedWorkbook.getWorksheet('Đơn đặt sân');
      assert.equal(completedSheet.rowCount, 2);
      assert.equal(completedSheet.getCell('A2').value, completedBooking.code);
      assert.equal(completedSheet.getCell('I2').value, 'Hoàn thành');

      const [auditRows] = await pool.execute(
        `SELECT action, details FROM admin_audit_logs
         WHERE admin_user_id = ? AND action = ? ORDER BY id`,
        [admin.id, 'EXPORT_BOOKINGS']
      );
      assert.equal(auditRows.length, 2);
      assert.doesNotMatch(String(auditRows[0].details), /@example\.test|=1\+1/);

      exportOverflowPrefix = `SPBX-${crypto.randomUUID().replaceAll('-', '').slice(0, 8)}-`;
      for (let offset = 0; offset < 5001; offset += 250) {
        const count = Math.min(250, 5001 - offset);
        const values = [];
        const parameters = [];
        for (let index = offset; index < offset + count; index += 1) {
          values.push("(?, ?, 'COMPLETED', 120000, NULL, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))");
          parameters.push(`${exportOverflowPrefix}${String(index).padStart(5, '0')}`, owner.id);
        }
        await pool.execute(
          `INSERT INTO bookings
             (booking_code, user_id, status, total_amount, match_preference, created_at, updated_at)
           VALUES ${values.join(', ')}`,
          parameters
        );
      }
      const overflow = await requestJson(
        baseUrl,
        `/api/v1/admin/bookings/export?q=${encodeURIComponent(exportOverflowPrefix)}`,
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal(overflow.status, 400);
      assert.equal((await overflow.json()).error.message, 'Quá nhiều dòng, hãy lọc thu hẹp');
      const [overflowAuditRows] = await pool.execute(
        `SELECT id FROM admin_audit_logs
         WHERE admin_user_id = ? AND action = ?`,
        [admin.id, 'EXPORT_BOOKINGS']
      );
      assert.equal(overflowAuditRows.length, 2);
    });

    await t.test('admin report exports enforce roles, apply filters, match dashboard data, audit safely, and cap rows', async () => {
      const originalUserRows = await pool.execute(
        'SELECT full_name, account_status FROM users WHERE id = ?',
        [lockTarget.id]
      );
      const originalFacilityRows = await pool.execute(
        'SELECT is_active FROM facilities WHERE id = ?',
        [facilityId]
      );
      const lockedName = '=2+2';
      await pool.execute(
        'UPDATE users SET full_name = ?, account_status = ? WHERE id = ?',
        [lockedName, 'ADMIN_LOCKED', lockTarget.id]
      );
      await pool.execute('UPDATE facilities SET is_active = FALSE WHERE id = ?', [facilityId]);
      try {
        const period = '7d';
        const slotRange = `/api/v1/admin/courts/${courtId}/time-slots/export?from=${inProgressBooking.serviceDate}&to=${inProgressBooking.serviceDate}`;
        const paths = [
          `/api/v1/admin/dashboard/export?period=${period}`,
          `/api/v1/admin/users/export?status=ADMIN_LOCKED&q=${encodeURIComponent(lockTarget.email)}`,
          `/api/v1/admin/facilities/export?q=${encodeURIComponent(suffix)}&is_active=false`,
          slotRange
        ];
        for (const path of paths) {
          const unauthenticated = await requestJson(baseUrl, path, 'GET');
          assert.equal(unauthenticated.status, 401, path);
          const forbidden = await requestJson(
            baseUrl,
            path,
            'GET',
            undefined,
            ordinaryUser.cookie
          );
          assert.equal(forbidden.status, 403, path);
        }

        async function readExport(path, prefix) {
          const response = await requestJson(baseUrl, path, 'GET', undefined, admin.cookie);
          assert.equal(response.status, 200, path);
          assert.equal(
            response.headers.get('content-type'),
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
          );
          assert.match(
            response.headers.get('content-disposition'),
            new RegExp(`filename="${prefix}-\\d{8}-\\d{4}\\.xlsx"`)
          );
          const workbook = new ExcelJS.Workbook();
          await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
          for (const worksheet of workbook.worksheets) {
            assert.equal(worksheet.views[0].state, 'frozen');
            assert.equal(worksheet.views[0].ySplit, 1);
            assert.equal(worksheet.getRow(1).font.bold, true);
            worksheet.eachRow((row) => {
              row.eachCell((cell) => {
                if (typeof cell.value === 'string') {
                  assert.doesNotMatch(cell.value, /password_hash|session_token/i);
                }
              });
            });
          }
          return workbook;
        }

        const dashboardResponse = await requestJson(
          baseUrl,
          `/api/v1/admin/dashboard?range=${period}`,
          'GET',
          undefined,
          admin.cookie
        );
        assert.equal(dashboardResponse.status, 200);
        const dashboard = await dashboardResponse.json();
        const dashboardWorkbook = await readExport(paths[0], 'bao-cao-tong-quan');
        assert.deepEqual(
          dashboardWorkbook.worksheets.map((sheet) => sheet.name),
          ['Tổng quan kỳ', 'Theo ngày', 'Theo trạng thái', 'Top cơ sở', 'Đơn mới nhất']
        );
        const overview = dashboardWorkbook.getWorksheet('Tổng quan kỳ');
        const metricValue = (label) => {
          const row = overview.getColumn(1).values.findIndex((value) => value === label);
          assert.ok(row > 0, `Missing dashboard metric: ${label}`);
          return overview.getCell(row, 2).value;
        };
        assert.equal(metricValue('Đơn trong kỳ'), dashboard.kpis.new_bookings);
        assert.equal(metricValue('Doanh thu thuần'), Number(dashboard.kpis.net_revenue));
        assert.equal(metricValue('Doanh thu kỳ trước'), Number(dashboard.kpis.net_revenue_prev));
        assert.equal(metricValue('Tỷ lệ lấp đầy'), dashboard.kpis.fill_rate_percent);
        const series = dashboardWorkbook.getWorksheet('Theo ngày');
        assert.equal(series.rowCount, dashboard.series.buckets.length + 1);
        dashboard.series.buckets.forEach((bucket, index) => {
          assert.equal(series.getCell(index + 2, 2).value, Number(bucket.bookings));
          assert.equal(series.getCell(index + 2, 3).value, Number(bucket.net_revenue));
        });

        const usersWorkbook = await readExport(paths[1], 'nguoi-dung');
        const usersSheet = usersWorkbook.getWorksheet('Người dùng');
        assert.equal(usersSheet.rowCount, 2);
        assert.equal(usersSheet.getCell('B2').value, "'=2+2");
        assert.equal(usersSheet.getCell('C2').value, lockTarget.email);
        assert.equal(usersSheet.getCell('E2').value, 'Bị khóa');
        assert.match(usersSheet.getCell('F2').value, /^\d{2}\/\d{2}\/\d{4}$/);
        assert.equal(usersWorkbook.getWorksheet('Tóm tắt').rowCount, 5);

        const facilityWorkbook = await readExport(paths[2], 'co-so-san');
        const facilitySheet = facilityWorkbook.getWorksheet('Cơ sở & Sân');
        assert.equal(facilitySheet.rowCount, 2);
        assert.equal(facilitySheet.getCell('A2').value, facilityId);
        assert.equal(facilitySheet.getCell('H2').value, 'Tạm khóa');
        assert.equal(facilitySheet.getCell('I2').value, 1);
        const childCourts = facilityWorkbook.getWorksheet('Sân con');
        assert.equal(childCourts.rowCount, 2);
        assert.equal(childCourts.getCell('D2').value, `Admin court ${suffix}`);
        assert.equal(childCourts.getCell('E2').value, 120000);
        assert.equal(childCourts.getCell('F2').value, 150000);
        assert.equal(facilityWorkbook.getWorksheet('Tóm tắt').rowCount, 5);

        const slotsWorkbook = await readExport(slotRange, 'khung-gio-gia');
        const slotsSheet = slotsWorkbook.getWorksheet('Khung giờ & Giá');
        assert.equal(slotsSheet.rowCount, 2);
        assert.equal(slotsSheet.getCell('A2').value, inProgressBooking.serviceDate.split('-').reverse().join('/'));
        assert.equal(slotsSheet.getCell('E2').value, 'Đã đặt');
        const slotsSummary = slotsWorkbook.getWorksheet('Tóm tắt');
        assert.equal(slotsSummary.getColumn(1).values[3], 'Sân');
        assert.equal(slotsSummary.getCell(3, 2).value, `Admin court ${suffix}`);
        assert.equal(slotsSummary.getColumn(1).values[8], 'Tổng khung');
        assert.equal(slotsSummary.getCell(8, 2).value, 1);
        assert.equal(slotsSummary.getColumn(1).values[9], 'Đã đặt');
        assert.equal(slotsSummary.getCell(9, 2).value, 1);

        const invalidRange = await requestJson(
          baseUrl,
          `/api/v1/admin/courts/${courtId}/time-slots/export?from=${inProgressBooking.serviceDate}&to=${dateOffset(inProgressBooking.serviceDate, 31)}`,
          'GET',
          undefined,
          admin.cookie
        );
        assert.equal(invalidRange.status, 400);
        assert.equal((await invalidRange.json()).error.message, 'Khoảng xem khung giờ tối đa 31 ngày.');

        const [auditRows] = await pool.execute(
          `SELECT action, details FROM admin_audit_logs
           WHERE admin_user_id = ? AND action IN (?, ?, ?, ?)
           ORDER BY id`,
          [admin.id, 'EXPORT_DASHBOARD', 'EXPORT_USERS', 'EXPORT_FACILITIES', 'EXPORT_TIME_SLOTS']
        );
        const [ownerRows] = await pool.execute(
          'SELECT phone FROM users WHERE id = ?',
          [owner.id]
        );
        assert.deepEqual(auditRows.map((row) => row.action), [
          'EXPORT_DASHBOARD', 'EXPORT_USERS', 'EXPORT_FACILITIES', 'EXPORT_TIME_SLOTS'
        ]);
        for (const audit of auditRows) {
          assert.doesNotMatch(String(audit.details), /@example\.test|password_hash|session_token/i);
          if (ownerRows[0].phone) {
            assert.doesNotMatch(
              String(audit.details),
              new RegExp(ownerRows[0].phone.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            );
          }
        }

        exportOverflowUserPrefix = `export-overflow-${crypto.randomUUID().replaceAll('-', '')}-`;
        for (let offset = 0; offset < 5001; offset += 250) {
          const count = Math.min(250, 5001 - offset);
          const values = [];
          const parameters = [];
          for (let index = offset; index < offset + count; index += 1) {
            values.push("(?, ?, 'test-hash-not-used', NULL, 'USER', 'ACTIVE', 0, NULL, NULL, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))");
            parameters.push(
              `Export overflow ${index}`,
              `${exportOverflowUserPrefix}${String(index).padStart(5, '0')}@example.test`
            );
          }
          await pool.execute(
            `INSERT INTO users
               (full_name, email, password_hash, phone, role, account_status,
                failed_login_count, login_locked_until, terms_accepted_at, created_at, updated_at)
             VALUES ${values.join(', ')}`,
            parameters
          );
        }
        const overflow = await requestJson(
          baseUrl,
          `/api/v1/admin/users/export?q=${encodeURIComponent(exportOverflowUserPrefix)}`,
          'GET',
          undefined,
          admin.cookie
        );
        assert.equal(overflow.status, 400);
        assert.equal((await overflow.json()).error.message, 'Quá nhiều dòng, hãy lọc thu hẹp');
        const [userAuditRows] = await pool.execute(
          'SELECT id FROM admin_audit_logs WHERE admin_user_id = ? AND action = ?',
          [admin.id, 'EXPORT_USERS']
        );
        assert.equal(userAuditRows.length, 1);
      } finally {
        await pool.execute(
          'UPDATE users SET full_name = ?, account_status = ? WHERE id = ?',
          [originalUserRows[0][0].full_name, originalUserRows[0][0].account_status, lockTarget.id]
        );
        await pool.execute(
          'UPDATE facilities SET is_active = ? WHERE id = ?',
          [originalFacilityRows[0][0].is_active, facilityId]
        );
        if (exportOverflowUserPrefix) {
          await pool.execute(
            'DELETE FROM users WHERE email LIKE ?',
            [`${exportOverflowUserPrefix}%`]
          );
          exportOverflowUserPrefix = null;
        }
      }
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
        `SELECT category, title, body
         FROM notifications
         WHERE resource_type = ? AND resource_id = ?
         ORDER BY id`,
        ['BOOKING', inProgressBooking.id]
      );
      assert.deepEqual(notificationRows.map((row) => row.category), ['BOOKING_HOLD', 'PAYMENT']);
      assert.equal(
        notificationRows[0].title,
        `Sân gặp sự cố, đơn ${inProgressBooking.code} bị hủy`
      );
      const serviceDateLabel = `${inProgressBooking.serviceDate.slice(8, 10)}/${inProgressBooking.serviceDate.slice(5, 7)}/${inProgressBooking.serviceDate.slice(0, 4)}`;
      const incidentSlots = await pool.execute(
        `SELECT TIME_FORMAT(starts_at, '%H:%i') AS starts_at,
                TIME_FORMAT(ends_at, '%H:%i') AS ends_at
         FROM time_slots WHERE id = ?`,
        [inProgressBooking.slotId]
      );
      assert.equal(
        notificationRows[0].body,
        `SportBooking xin lỗi vì đã phải hủy đơn ${inProgressBooking.code} tại Admin test ${suffix} / Admin court ${suffix} (${serviceDateLabel}, ${incidentSlots[0][0].starts_at}–${incidentSlots[0][0].ends_at}) do sự cố. Lý do: Sự cố trong trận.`
      );
      assert.equal(
        notificationRows[1].title,
        'Hoàn tiền 45.123 đ'
      );
      assert.equal(
        notificationRows[1].body,
        `Đã hoàn 100% số tiền đã thanh toán (45.123 đ) cho đơn ${inProgressBooking.code}.`
      );
      const customerNotifications = await requestJson(
        baseUrl,
        '/api/v1/notifications?page=1&page_size=50',
        'GET',
        undefined,
        owner.cookie
      );
      assert.equal(customerNotifications.status, 200);
      const customerBookingNotifications = (await customerNotifications.json()).notifications
        .filter((item) => item.resource_id === inProgressBooking.id)
        .map(({ category, title, body }) => ({ category, title, body }))
        .sort((left, right) => left.category.localeCompare(right.category));
      assert.deepEqual(customerBookingNotifications, notificationRows
        .map(({ category, title, body }) => ({ category, title, body }))
        .sort((left, right) => left.category.localeCompare(right.category)));
      const unreadCount = await requestJson(
        baseUrl,
        '/api/v1/notifications/unread-count',
        'GET',
        undefined,
        owner.cookie
      );
      assert.equal((await unreadCount.json()).count, 2);
      const otherNotifications = await requestJson(
        baseUrl,
        '/api/v1/notifications?page=1&page_size=50',
        'GET',
        undefined,
        ordinaryUser.cookie
      );
      assert.equal(
        (await otherNotifications.json()).notifications.some((item) => item.resource_id === inProgressBooking.id),
        false
      );
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
      const [notificationCount] = await pool.execute(
        'SELECT COUNT(*) AS total FROM notifications WHERE resource_type = ? AND resource_id = ?',
        ['BOOKING', inProgressBooking.id]
      );
      assert.equal(Number(notificationCount[0].total), 2);
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

    await t.test('incident cancellation of a pending booking creates both customer notifications', async () => {
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
        `SELECT category, title, body
         FROM notifications
         WHERE resource_type = ? AND resource_id = ?`,
        ['BOOKING', pendingBooking.id]
      );
      assert.deepEqual(notificationRows.map((row) => row.category).sort(), ['BOOKING_HOLD', 'PAYMENT']);
      assert.equal(
        notificationRows.find((row) => row.category === 'BOOKING_HOLD').body.includes('Lý do: Sân đóng cửa do sự cố.'),
        true
      );
      assert.equal(notificationRows.find((row) => row.category === 'PAYMENT').title, 'Hoàn tiền 0 đ');
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
      const previousAppEnv = process.env.APP_ENV;
      const previousConsoleError = console.error;
      const loggedErrors = [];
      process.env.APP_ENV = 'development';
      console.error = (...values) => loggedErrors.push(values.join(' '));
      let response;
      try {
        response = await requestJson(
          baseUrl,
          `/api/v1/admin/bookings/${paymentRollbackBooking.id}/incident-cancellation`,
          'POST',
          { cancellation_reason: 'Trigger payment failure' },
          admin.cookie
        );
      } finally {
        process.env.APP_ENV = previousAppEnv;
        console.error = previousConsoleError;
      }
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Không thể hoàn tất yêu cầu do lỗi hệ thống. Vui lòng thử lại.',
          details: {}
        }
      });
      assert.match(loggedErrors.join('\n'), /admin payment rollback test/);
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
      assert.equal((await response.json()).error.message,
        'Không thể hoàn tất yêu cầu do lỗi hệ thống. Vui lòng thử lại.');
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
        assert.equal(after.series.granularity, period === 'today' ? 'hour' : 'day');
        assert.equal(after.series.buckets.length, period === 'today' ? 24 : period === '7d' ? 7 : 30);
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
    if (exportOverflowPrefix) {
      await cleanup(() => pool.execute(
        'DELETE FROM bookings WHERE booking_code LIKE ?',
        [`${exportOverflowPrefix}%`]
      ));
    }
    if (exportOverflowUserPrefix) {
      await cleanup(() => pool.execute(
        'DELETE FROM users WHERE email LIKE ?',
        [`${exportOverflowUserPrefix}%`]
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
        `DELETE FROM time_slots WHERE court_id IN (${placeholders})`,
        createdCourtIds
      ));
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
