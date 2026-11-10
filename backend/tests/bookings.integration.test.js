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
  const payload = path === '/api/v1/bookings' && body
    && !Object.hasOwn(body, 'payment_option')
    ? { ...body, payment_option: 'DEPOSIT_50' }
    : body;
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  });
}

function createSoonSlotTime(minutes = 5) {
  const startsAt = new Date(Date.now() + 7 * 60 * 60 * 1000 + minutes * 60 * 1000);
  return {
    date: startsAt.toISOString().slice(0, 10),
    startsAt: `${String(startsAt.getUTCHours()).padStart(2, '0')}:${String(startsAt.getUTCMinutes()).padStart(2, '0')}:00`
  };
}

test('booking holds, locking, cancellation, and expiry work on sportbooking_test', async (t) => {
  const pool = getPool();
  const userIds = [];
  const userEmails = [];
  let facilityId;
  let courtId;
  let footballCourtId;
  let server;
  let multiSlotBookingId;
  let oneSlotBookingId;
  let rollbackTriggerName;

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
      userEmails.push(email);
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
    for (let index = 0; index < 8; index += 1) {
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
    const [footballCourtResult] = await pool.execute(
      `INSERT INTO courts
         (facility_id, name, sport_type, price_normal, price_peak, is_active, is_seed,
          created_at, updated_at)
       VALUES (?, ?, 'FOOTBALL_MINI', 500000, 600000, TRUE, FALSE,
               UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [facilityId, `Booking test football ${suffix}`]
    );
    footballCourtId = String(footballCourtResult.insertId);

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
          hour === 0 ? 123455 : 120000
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
    const matchSoonSlot = createSoonSlotTime(20);
    const [matchSoonSlotResult] = await pool.execute(
      `INSERT INTO time_slots
         (court_id, service_date, starts_at, ends_at, price, status,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, 120001, 'AVAILABLE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [
        courtId,
        matchSoonSlot.date,
        matchSoonSlot.startsAt,
        `${String((Number(matchSoonSlot.startsAt.slice(0, 2)) + 1) % 24).padStart(2, '0')}:${matchSoonSlot.startsAt.slice(3, 5)}:00`
      ]
    );
    const matchTooSoonSlotId = String(matchSoonSlotResult.insertId);
    const [footballSlotResult] = await pool.execute(
      `INSERT INTO time_slots
         (court_id, service_date, starts_at, ends_at, price, status,
          created_at, updated_at)
       VALUES (?, ?, '10:00:00', '11:00:00', 500000, 'AVAILABLE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
      [footballCourtId, localDateOffset(3)]
    );
    const footballSlotId = String(footballSlotResult.insertId);

    await t.test('creates one-slot and contiguous multi-slot holds with server prices', async () => {
      const oneSlotResponse = await postJson(
        baseUrl,
        '/api/v1/bookings',
        {
          slot_ids: [slotIds[0]],
          payment_option: 'DEPOSIT_50',
          match_preference: {
            mode: 'CRITERIA',
            gender: 'ANY',
            skill: 'BEGINNER',
            format: 'SINGLES',
            message: 'Test preference'
          }
        },
        users[0].cookie
      );
      assert.equal(oneSlotResponse.status, 201);
      const oneSlotBooking = await oneSlotResponse.json();
      oneSlotBookingId = oneSlotBooking.booking_id;
      assert.match(oneSlotBooking.booking_code, /^SPB-\d{8}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
      assert.equal(oneSlotBooking.status, 'PENDING');
      assert.equal(oneSlotBooking.total_amount, '123455');
      assert.equal(oneSlotBooking.payment.status, 'PENDING');
      assert.equal(oneSlotBooking.payment.payment_option, 'DEPOSIT_50');
      assert.equal(oneSlotBooking.deposit_amount, '61728');
      assert.equal(oneSlotBooking.amount_due_at_venue, '61727');
      assert.deepEqual(oneSlotBooking.match_preference, {
        mode: 'CRITERIA',
        gender: 'ANY',
        skill: 'BEGINNER',
        format: 'SINGLES',
        message: 'Test preference'
      });
      assert.equal(oneSlotBooking.remaining_seconds, 600);
      assert.equal(oneSlotBooking.slots.length, 1);
      const [paymentRows] = await pool.execute(
        'SELECT status, payment_option, amount_due FROM payments WHERE booking_id = ?',
        [oneSlotBooking.booking_id]
      );
      assert.equal(paymentRows.length, 1);
      assert.equal(paymentRows[0].status, 'PENDING');
      assert.equal(paymentRows[0].payment_option, 'DEPOSIT_50');
      assert.equal(String(paymentRows[0].amount_due), '61728');
      const oneSlotDetailResponse = await fetch(
        `${baseUrl}/api/v1/bookings/${oneSlotBooking.booking_id}`,
        { headers: { cookie: users[0].cookie } }
      );
      assert.equal(oneSlotDetailResponse.status, 200);
      const oneSlotDetail = await oneSlotDetailResponse.json();
      assert.deepEqual(oneSlotDetail.match_preference, oneSlotBooking.match_preference);
      assert.equal(oneSlotDetail.display_status_code, 'PENDING');
      assert.equal(oneSlotDetail.display_status, 'Chờ thanh toán');
      assert.ok(oneSlotDetail.created_at);
      assert.equal(oneSlotDetail.total_amount, '123455');
      assert.equal(oneSlotDetail.facility_id, facilityId);
      assert.equal(oneSlotDetail.court_id, courtId);
      assert.equal(oneSlotDetail.sport_type, 'BADMINTON');

      const multiSlotResponse = await postJson(
        baseUrl,
        '/api/v1/bookings',
        { slot_ids: [slotIds[4], slotIds[3]] },
        users[1].cookie
      );
      assert.equal(multiSlotResponse.status, 201);
      const multiSlotBooking = await multiSlotResponse.json();
      multiSlotBookingId = multiSlotBooking.booking_id;
      assert.match(multiSlotBooking.booking_code, /^SPB-\d{8}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
      assert.notEqual(multiSlotBooking.booking_code, oneSlotBooking.booking_code);
      const [distinctBookingCodes] = await pool.execute(
        `SELECT COUNT(DISTINCT booking_code) AS count
         FROM bookings
         WHERE id IN (?, ?)`,
        [oneSlotBooking.booking_id, multiSlotBooking.booking_id]
      );
      assert.equal(Number(distinctBookingCodes[0].count), 2);
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
      assert.equal(detailResponse.headers.get('cache-control'), 'no-store');
      const detail = await detailResponse.json();
      assert.equal(detail.slots[0].court_name, `Booking test court ${suffix}`);
      assert.equal(detail.slots[0].price_at_booking, '120000');
      assert.equal(detail.payment.status, 'PENDING');
      assert.equal(detail.payment.payment_option, 'DEPOSIT_50');
      assert.equal(detail.deposit_amount, '120000');
      assert.equal(detail.amount_due_at_venue, '120000');
      assert.equal(detail.display_status_code, 'PENDING');
      assert.ok(detail.created_at);
      assert.equal(detail.facility_id, facilityId);
      assert.equal(detail.court_id, courtId);
      assert.equal(detail.sport_type, 'BADMINTON');
    });

    await t.test('booking fixed routes and IDs resolve through the mounted HTTP app', async () => {
      const headers = { cookie: users[0].cookie };

      const summaryResponse = await fetch(`${baseUrl}/api/v1/bookings/summary`, { headers });
      assert.equal(summaryResponse.status, 200);
      const summary = await summaryResponse.json();
      assert.equal(typeof summary.upcoming_count, 'number');
      assert.equal(typeof summary.completed_count, 'number');
      assert.ok(Object.hasOwn(summary, 'total_spent'));
      assert.ok(summary.counts_by_status);

      const pendingResponse = await fetch(`${baseUrl}/api/v1/bookings/pending`, { headers });
      assert.equal(pendingResponse.status, 200);

      const bookingResponse = await fetch(
        `${baseUrl}/api/v1/bookings/${oneSlotBookingId}`,
        { headers }
      );
      assert.equal(bookingResponse.status, 200);

      const invalidIdResponse = await fetch(`${baseUrl}/api/v1/bookings/abc`, { headers });
      assert.equal(invalidIdResponse.status, 404);
      assert.equal((await invalidIdResponse.json()).error.code, 'NOT_FOUND');
    });

    await t.test('lists only the owner bookings with status filtering and pagination', async () => {
      const unauthenticated = await fetch(`${baseUrl}/api/v1/bookings?mine=true`);
      assert.equal(unauthenticated.status, 401);

      const paid = await postJson(
        baseUrl,
        `/api/v1/bookings/${multiSlotBookingId}/payment-attempts`,
        { method: 'MOMO', simulation_result: 'SUCCESS' },
        users[1].cookie
      );
      assert.equal(paid.status, 201);

      const nextBookingResponse = await postJson(
        baseUrl,
        '/api/v1/bookings',
        { slot_ids: [slotIds[2]] },
        users[1].cookie
      );
      assert.equal(nextBookingResponse.status, 201);
      const nextBooking = await nextBookingResponse.json();

      const firstPageResponse = await fetch(
        `${baseUrl}/api/v1/bookings?mine=true&page=1&page_size=1`,
        { headers: { cookie: users[1].cookie } }
      );
      assert.equal(firstPageResponse.status, 200);
      assert.equal(firstPageResponse.headers.get('cache-control'), 'no-store');
      const firstPage = await firstPageResponse.json();
      assert.equal(firstPage.pagination.total, 2);
      assert.equal(firstPage.pagination.total_pages, 2);
      assert.equal(firstPage.pagination.page, 1);
      assert.equal(firstPage.pagination.page_size, 1);
      assert.equal(firstPage.bookings.length, 1);
      assert.equal(firstPage.bookings[0].booking_id, nextBooking.booking_id);
      assert.equal(firstPage.bookings[0].display_status_code, 'PENDING');
      assert.ok(firstPage.bookings[0].created_at);
      assert.equal(firstPage.bookings[0].facility_id, facilityId);
      assert.equal(firstPage.bookings[0].court_id, courtId);
      assert.equal(firstPage.bookings[0].sport_type, 'BADMINTON');

      const secondPageResponse = await fetch(
        `${baseUrl}/api/v1/bookings?mine=true&page=2&page_size=1`,
        { headers: { cookie: users[1].cookie } }
      );
      const secondPage = await secondPageResponse.json();
      assert.equal(secondPage.bookings.length, 1);
      assert.equal(secondPage.bookings[0].booking_id, multiSlotBookingId);
      assert.equal(secondPage.bookings[0].payment_status, 'PAID');
      assert.equal(secondPage.bookings[0].paid_amount, '120000');
      assert.equal(secondPage.bookings[0].slots.length, 2);

      const confirmedFilterResponse = await fetch(
        `${baseUrl}/api/v1/bookings?mine=true&status=CONFIRMED`,
        { headers: { cookie: users[1].cookie } }
      );
      const confirmedFilter = await confirmedFilterResponse.json();
      assert.equal(confirmedFilter.pagination.total, 1);
      assert.equal(confirmedFilter.bookings[0].booking_id, multiSlotBookingId);

      const codeSearchResponse = await fetch(
        `${baseUrl}/api/v1/bookings?mine=true&q=${encodeURIComponent(nextBooking.booking_code.slice(-6))}`,
        { headers: { cookie: users[1].cookie } }
      );
      const codeSearch = await codeSearchResponse.json();
      assert.equal(codeSearch.pagination.total, 1);
      assert.equal(codeSearch.bookings[0].booking_id, nextBooking.booking_id);

      const facilitySearchResponse = await fetch(
        `${baseUrl}/api/v1/bookings?mine=true&q=${encodeURIComponent(`Booking test ${suffix}`)}`,
        { headers: { cookie: users[1].cookie } }
      );
      const facilitySearch = await facilitySearchResponse.json();
      assert.equal(facilitySearch.pagination.total, 2);

      const badmintonFilterResponse = await fetch(
        `${baseUrl}/api/v1/bookings?mine=true&sport=BADMINTON`,
        { headers: { cookie: users[1].cookie } }
      );
      const badmintonFilter = await badmintonFilterResponse.json();
      assert.equal(badmintonFilter.pagination.total, 2);
      const footballFilterResponse = await fetch(
        `${baseUrl}/api/v1/bookings?mine=true&sport=FOOTBALL_MINI`,
        { headers: { cookie: users[1].cookie } }
      );
      assert.equal((await footballFilterResponse.json()).pagination.total, 0);

      for (const wildcard of ['%', '_']) {
        const escapedSearchResponse = await fetch(
          `${baseUrl}/api/v1/bookings?mine=true&q=${encodeURIComponent(wildcard)}`,
          { headers: { cookie: users[1].cookie } }
        );
        assert.equal((await escapedSearchResponse.json()).pagination.total, 0);
      }

      const emptyOwnerResponse = await fetch(
        `${baseUrl}/api/v1/bookings?mine=true`,
        { headers: { cookie: users[5].cookie } }
      );
      const emptyOwner = await emptyOwnerResponse.json();
      assert.equal(emptyOwner.pagination.total, 0);
      assert.equal(emptyOwner.pagination.total_pages, 0);
      assert.deepEqual(emptyOwner.bookings, []);

      const invalidSport = await fetch(
        `${baseUrl}/api/v1/bookings?mine=true&sport=UNKNOWN`,
        { headers: { cookie: users[1].cookie } }
      );
      assert.equal(invalidSport.status, 400);

      const badPage = await fetch(
        `${baseUrl}/api/v1/bookings?mine=true&page=0`,
        { headers: { cookie: users[1].cookie } }
      );
      assert.equal(badPage.status, 400);
      const oversizedPage = await fetch(
        `${baseUrl}/api/v1/bookings?mine=true&page_size=51`,
        { headers: { cookie: users[1].cookie } }
      );
      assert.equal(oversizedPage.status, 400);
    });

    await t.test('returns owner-only status summary counts and net paid totals', async () => {
      async function addSummaryBooking({
        userId,
        status,
        serviceDate,
        startsAt,
        endsAt,
        paymentStatus,
        paidAmount,
        refundedAmount
      }) {
        const [slotResult] = await pool.execute(
          `INSERT INTO time_slots
             (court_id, service_date, starts_at, ends_at, price, status,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, 120000, 'AVAILABLE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [courtId, serviceDate, startsAt, endsAt]
        );
        const [bookingResult] = await pool.execute(
          `INSERT INTO bookings
             (booking_code, user_id, status, total_amount, lock_expires_at,
              created_at, updated_at)
           VALUES (?, ?, ?, 120000, ?, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [
            `SPB-SUMMARY-${crypto.randomUUID()}`,
            userId,
            status,
            status === 'PENDING' ? new Date(Date.now() + 10 * 60 * 1000) : null
          ]
        );
        const bookingId = String(bookingResult.insertId);
        await pool.execute(
          `INSERT INTO booking_slots (booking_id, time_slot_id, court_id, price_at_booking, created_at)
           VALUES (?, ?, ?, 120000, UTC_TIMESTAMP(3))`,
          [bookingId, String(slotResult.insertId), courtId]
        );
        await pool.execute(
          `INSERT INTO payments
             (booking_id, status, amount_due, paid_amount, refunded_amount,
              payment_option, created_at, updated_at)
           VALUES (?, ?, 120000, ?, ?, 'FULL', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [bookingId, paymentStatus, paidAmount, refundedAmount]
        );
        return bookingId;
      }

      await addSummaryBooking({
        userId: users[6].id,
        status: 'CONFIRMED',
        serviceDate: localDateOffset(10),
        startsAt: '10:00:00',
        endsAt: '11:00:00',
        paymentStatus: 'PAID',
        paidAmount: 120000,
        refundedAmount: 0
      });
      const pastConfirmedBookingId = await addSummaryBooking({
        userId: users[6].id,
        status: 'CONFIRMED',
        serviceDate: localDateOffset(-1),
        startsAt: '00:00:00',
        endsAt: '01:00:00',
        paymentStatus: 'REFUNDED',
        paidAmount: 100000,
        refundedAmount: 25000
      });
      await addSummaryBooking({
        userId: users[6].id,
        status: 'PENDING',
        serviceDate: localDateOffset(10),
        startsAt: '12:00:00',
        endsAt: '13:00:00',
        paymentStatus: 'PENDING',
        paidAmount: 0,
        refundedAmount: 0
      });
      await addSummaryBooking({
        userId: users[6].id,
        status: 'EXPIRED',
        serviceDate: localDateOffset(10),
        startsAt: '14:00:00',
        endsAt: '15:00:00',
        paymentStatus: 'PENDING',
        paidAmount: 0,
        refundedAmount: 0
      });
      await addSummaryBooking({
        userId: users[6].id,
        status: 'CANCELLED',
        serviceDate: localDateOffset(10),
        startsAt: '16:00:00',
        endsAt: '17:00:00',
        paymentStatus: 'PAID',
        paidAmount: 50000,
        refundedAmount: 50000
      });
      await addSummaryBooking({
        userId: users[6].id,
        status: 'COMPLETED',
        serviceDate: localDateOffset(-1),
        startsAt: '02:00:00',
        endsAt: '03:00:00',
        paymentStatus: 'PAID',
        paidAmount: 0,
        refundedAmount: 0
      });
      await addSummaryBooking({
        userId: users[7].id,
        status: 'CONFIRMED',
        serviceDate: localDateOffset(10),
        startsAt: '20:00:00',
        endsAt: '21:00:00',
        paymentStatus: 'PAID',
        paidAmount: 999999,
        refundedAmount: 0
      });

      const unauthenticatedSummary = await fetch(`${baseUrl}/api/v1/bookings/summary`);
      assert.equal(unauthenticatedSummary.status, 401);

      const summaryResponse = await fetch(`${baseUrl}/api/v1/bookings/summary`, {
        headers: { cookie: users[6].cookie }
      });
      assert.equal(summaryResponse.status, 200);
      assert.equal(summaryResponse.headers.get('cache-control'), 'no-store');
      assert.deepEqual(await summaryResponse.json(), {
        upcoming_count: 1,
        completed_count: 2,
        total_spent: '195000',
        counts_by_status: {
          'Chờ thanh toán': 1,
          'Sắp tới/Đang trong trận': 1,
          'Hoàn thành': 2,
          'Đã hủy': 1,
          'Hết hạn': 1
        }
      });

      const otherUserSummaryResponse = await fetch(`${baseUrl}/api/v1/bookings/summary`, {
        headers: { cookie: users[7].cookie }
      });
      const otherUserSummary = await otherUserSummaryResponse.json();
      assert.equal(otherUserSummary.upcoming_count, 1);
      assert.equal(otherUserSummary.completed_count, 0);
      assert.equal(otherUserSummary.total_spent, '999999');
      assert.equal(otherUserSummary.counts_by_status['Sắp tới/Đang trong trận'], 1);
      await pool.execute(
        `UPDATE bookings
         SET status = 'COMPLETED', updated_at = UTC_TIMESTAMP(3)
         WHERE id = ? AND status = 'CONFIRMED'`,
        [pastConfirmedBookingId]
      );
    });

    await t.test('completion job waits for slot end and is idempotent', async () => {
      assert.equal(await app.locals.bookingsService.completeDueBookings(), 0);
      const [beforeRows] = await pool.execute(
        'SELECT status FROM bookings WHERE id = ?',
        [multiSlotBookingId]
      );
      assert.equal(beforeRows[0].status, 'CONFIRMED');

      const yesterday = `DATE_SUB(DATE(DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 HOUR)), INTERVAL 1 DAY)`;
      await pool.execute(
        `UPDATE time_slots
         SET service_date = ${yesterday}, starts_at = '10:00:00', ends_at = '11:00:00'
         WHERE id = ?`,
        [slotIds[3]]
      );
      await pool.execute(
        `UPDATE time_slots
         SET service_date = ${yesterday}, starts_at = '11:00:00', ends_at = '12:00:00'
         WHERE id = ?`,
        [slotIds[4]]
      );

      assert.equal(await app.locals.bookingsService.completeDueBookings(), 1);
      assert.equal(await app.locals.bookingsService.completeDueBookings(), 0);
      const [afterRows] = await pool.execute(
        'SELECT status FROM bookings WHERE id = ?',
        [multiSlotBookingId]
      );
      assert.equal(afterRows[0].status, 'COMPLETED');
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
      const secondPendingError = await secondPending.json();
      assert.equal(secondPendingError.error.code, 'PENDING_BOOKING_EXISTS');
      assert.equal(secondPendingError.error.details.pending_booking_id, oneSlotBookingId);
      assert.ok(Number(secondPendingError.error.details.remaining_seconds) > 0);

      const ownerPending = await fetch(`${baseUrl}/api/v1/bookings/pending`, {
        headers: { cookie: users[0].cookie }
      });
      assert.equal(ownerPending.status, 200);
      assert.equal(ownerPending.headers.get('cache-control'), 'no-store');
      const ownerPendingBooking = await ownerPending.json();
      assert.equal(ownerPendingBooking.id, oneSlotBookingId);
      assert.equal(ownerPendingBooking.booking_id, oneSlotBookingId);
      assert.equal(ownerPendingBooking.slots[0].facility_name, `Booking test ${suffix}`);
      assert.equal(ownerPendingBooking.slots[0].court_name, `Booking test court ${suffix}`);
      assert.equal(ownerPendingBooking.slots[0].service_date, serviceDate);
      assert.equal(ownerPendingBooking.slots[0].starts_at, '00:00:00');
      assert.equal(ownerPendingBooking.slots[0].ends_at, '01:00:00');
      assert.ok(Number(ownerPendingBooking.remaining_seconds) > 0);
      const otherUserPending = await fetch(`${baseUrl}/api/v1/bookings/pending`, {
        headers: { cookie: users[5].cookie }
      });
      assert.equal(otherUserPending.status, 200);
      assert.equal(await otherUserPending.json(), null);

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

      const tooLateForMatching = await postJson(
        baseUrl,
        '/api/v1/bookings',
        {
          slot_ids: [matchTooSoonSlotId],
          payment_option: 'FULL',
          match_preference: { mode: 'RANDOM' }
        },
        users[2].cookie
      );
      assert.equal(tooLateForMatching.status, 400);
      assert.equal((await tooLateForMatching.json()).error.code, 'MATCH_PREFERENCE_TOO_LATE');

      const unsupportedFormat = await postJson(
        baseUrl,
        '/api/v1/bookings',
        {
          slot_ids: [footballSlotId],
          payment_option: 'FULL',
          match_preference: { mode: 'CRITERIA', format: 'DOUBLES' }
        },
        users[2].cookie
      );
      assert.equal(unsupportedFormat.status, 400);
      assert.equal((await unsupportedFormat.json()).error.code, 'MATCH_FORMAT_NOT_SUPPORTED');

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

    await t.test('rolls back booking and slot writes when payment creation fails', async () => {
      rollbackTriggerName = `test_payment_fail_${crypto.randomUUID().replaceAll('-', '')}`;
      const [paymentCountBeforeRows] = await pool.execute(
        'SELECT COUNT(*) AS count FROM payments'
      );
      await pool.query(
        `CREATE TRIGGER ${rollbackTriggerName}
         BEFORE INSERT ON payments FOR EACH ROW
         SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'intentional integration test failure'`
      );
      try {
        const failed = await postJson(
          baseUrl,
          '/api/v1/bookings',
          { slot_ids: [slotIds[7]], payment_option: 'FULL' },
          users[2].cookie
        );
        assert.equal(failed.status, 500);
        const [bookingRows] = await pool.execute(
          'SELECT COUNT(*) AS count FROM bookings WHERE user_id = ?',
          [users[2].id]
        );
        assert.equal(Number(bookingRows[0].count), 0);
        const [paymentCountAfterRows] = await pool.execute(
          'SELECT COUNT(*) AS count FROM payments'
        );
        assert.equal(Number(paymentCountAfterRows[0].count), Number(paymentCountBeforeRows[0].count));
        const [slotRows] = await pool.execute(
          'SELECT status, current_booking_id FROM time_slots WHERE id = ?',
          [slotIds[7]]
        );
        assert.equal(slotRows[0].status, 'AVAILABLE');
        assert.equal(slotRows[0].current_booking_id, null);
        const [bookingSlotRows] = await pool.execute(
          'SELECT COUNT(*) AS count FROM booking_slots WHERE time_slot_id = ?',
          [slotIds[7]]
        );
        assert.equal(Number(bookingSlotRows[0].count), 0);
      } finally {
        await pool.query(`DROP TRIGGER IF EXISTS ${rollbackTriggerName}`);
        rollbackTriggerName = null;
      }
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
      const stalePendingRead = await fetch(
        `${baseUrl}/api/v1/bookings/${expiringBooking.booking_id}`,
        { headers: { cookie: users[2].cookie } }
      );
      assert.equal(stalePendingRead.status, 200);
      const stalePendingDetail = await stalePendingRead.json();
      assert.equal(stalePendingDetail.status, 'PENDING');
      assert.equal(stalePendingDetail.display_status_code, 'EXPIRED');

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
      assert.equal(expiredRead.status, 200);
      const expiredDetail = await expiredRead.json();
      assert.equal(expiredDetail.status, 'EXPIRED');
      assert.equal(expiredDetail.display_status_code, 'EXPIRED');
      assert.equal(expiredDetail.display_status, 'Đã hết hạn');

      const staleBookingResponse = await postJson(
        baseUrl,
        '/api/v1/bookings',
        { slot_ids: [slotIds[11]] },
        users[2].cookie
      );
      assert.equal(staleBookingResponse.status, 201);
      const staleBooking = await staleBookingResponse.json();
      await pool.execute(
        `UPDATE bookings SET lock_expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND)
         WHERE id = ?`,
        [staleBooking.booking_id]
      );
      await pool.execute(
        `UPDATE time_slots SET lock_expires_at = DATE_SUB(UTC_TIMESTAMP(3), INTERVAL 1 SECOND)
         WHERE current_booking_id = ?`,
        [staleBooking.booking_id]
      );
      const afterExpiredPending = await postJson(
        baseUrl,
        '/api/v1/bookings',
        { slot_ids: [slotIds[6]] },
        users[2].cookie
      );
      assert.equal(afterExpiredPending.status, 201);
      const replacementBooking = await afterExpiredPending.json();
      assert.notEqual(replacementBooking.booking_id, staleBooking.booking_id);
      const [staleStateRows] = await pool.execute(
        `SELECT b.status, ts.status AS slot_status, ts.current_booking_id, ts.lock_expires_at
         FROM bookings AS b
         INNER JOIN booking_slots AS bs ON bs.booking_id = b.id
         INNER JOIN time_slots AS ts ON ts.id = bs.time_slot_id
         WHERE b.id = ?`,
        [staleBooking.booking_id]
      );
      assert.equal(staleStateRows[0].status, 'EXPIRED');
      assert.equal(staleStateRows[0].slot_status, 'AVAILABLE');
      assert.equal(staleStateRows[0].current_booking_id, null);
      assert.equal(staleStateRows[0].lock_expires_at, null);
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
    const cleanupErrors = [];
    const cleanup = async (operation) => {
      try {
        await operation();
      } catch (error) {
        cleanupErrors.push(error);
      }
    };
    if (rollbackTriggerName) {
      await cleanup(() => pool.query(`DROP TRIGGER IF EXISTS ${rollbackTriggerName}`));
    }
    if (server) {
      await cleanup(() => new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      }));
    }

    let bookingIds = [];
    if (courtId) {
      await cleanup(async () => {
        const [bookingRows] = await pool.execute(
          `SELECT DISTINCT b.id
           FROM bookings AS b
           INNER JOIN booking_slots AS bs ON bs.booking_id = b.id
           INNER JOIN time_slots AS ts ON ts.id = bs.time_slot_id
           WHERE ts.court_id IN (?, ?)`,
          [courtId, footballCourtId || courtId]
        );
        bookingIds = bookingRows.map((row) => String(row.id));
      });
    }
    if (bookingIds.length > 0) {
      const placeholders = bookingIds.map(() => '?').join(', ');
      let paymentIds = [];
      await cleanup(async () => {
        const [rows] = await pool.execute(
          `SELECT id FROM payments WHERE booking_id IN (${placeholders})`, bookingIds
        );
        paymentIds = rows.map((row) => String(row.id));
      });
      await cleanup(() => pool.execute(
        `DELETE FROM booking_tickets WHERE booking_id IN (${placeholders})`, bookingIds
      ));
      if (paymentIds.length > 0) {
        const paymentPlaceholders = paymentIds.map(() => '?').join(', ');
        await cleanup(() => pool.execute(
          `DELETE FROM payment_attempts WHERE payment_id IN (${paymentPlaceholders})`, paymentIds
        ));
      }
      await cleanup(() => pool.execute(
        `DELETE FROM booking_slots WHERE booking_id IN (${placeholders})`, bookingIds
      ));
      await cleanup(() => pool.execute(
        `UPDATE time_slots SET current_booking_id = NULL, lock_expires_at = NULL
         WHERE current_booking_id IN (${placeholders})`, bookingIds
      ));
      await cleanup(() => pool.execute(
        `DELETE FROM payments WHERE booking_id IN (${placeholders})`, bookingIds
      ));
      await cleanup(() => pool.execute(
        `DELETE FROM bookings WHERE id IN (${placeholders})`, bookingIds
      ));
    }
    if (courtId) await cleanup(() => pool.execute('DELETE FROM time_slots WHERE court_id = ?', [courtId]));
    if (footballCourtId) await cleanup(() => pool.execute('DELETE FROM time_slots WHERE court_id = ?', [footballCourtId]));
    if (facilityId) await cleanup(() => pool.execute('DELETE FROM facilities WHERE id = ?', [facilityId]));

    if (userIds.length > 0) {
      const placeholders = userIds.map(() => '?').join(', ');
      await cleanup(() => pool.execute(
        `DELETE FROM user_sessions WHERE user_id IN (${placeholders})`, userIds
      ));
    }
    if (userEmails.length > 0) {
      const placeholders = userEmails.map(() => '?').join(', ');
      await cleanup(() => pool.execute(
        `DELETE FROM user_sessions WHERE user_id IN (SELECT id FROM users WHERE email IN (${placeholders}))`,
        userEmails
      ));
      await cleanup(() => pool.execute(
        `DELETE FROM users WHERE email IN (${placeholders})`, userEmails
      ));
    }
    await cleanup(() => closePool());
    if (cleanupErrors.length > 0) {
      throw new AggregateError(cleanupErrors, 'Booking integration test cleanup failed.');
    }
  }
});
