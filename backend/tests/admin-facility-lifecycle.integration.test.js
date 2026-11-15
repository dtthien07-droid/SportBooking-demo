'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

if (process.env.APP_ENV !== 'test' || process.env.DB_NAME !== 'sportbooking_test') {
  throw new Error('Facility lifecycle tests require APP_ENV=test and DB_NAME=sportbooking_test.');
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

test('facility listing, summary, and deletion follow lifecycle rules over HTTP', async (t) => {
  const pool = getPool();
  const facilityIds = [];
  const bookingIds = [];
  const userIds = [];
  const userEmails = [];
  const triggerNames = [];
  let server;

  async function cleanup() {
    for (const triggerName of triggerNames) {
      await pool.query(`DROP TRIGGER IF EXISTS ${triggerName}`);
    }
    for (const bookingId of bookingIds) {
      await pool.execute('DELETE FROM booking_slots WHERE booking_id = ?', [bookingId]);
      await pool.execute(
        'UPDATE time_slots SET current_booking_id = NULL WHERE current_booking_id = ?',
        [bookingId]
      );
      await pool.execute('DELETE FROM bookings WHERE id = ?', [bookingId]);
    }
    for (const facilityId of facilityIds) {
      const [courtRows] = await pool.execute(
        'SELECT id FROM courts WHERE facility_id = ?',
        [facilityId]
      );
      const courtIds = courtRows.map((row) => String(row.id));
      if (courtIds.length) {
        const placeholders = courtIds.map(() => '?').join(', ');
        await pool.execute(
          `DELETE FROM booking_slots WHERE court_id IN (${placeholders})`,
          courtIds
        );
        await pool.execute(
          `UPDATE time_slots SET current_booking_id = NULL
           WHERE court_id IN (${placeholders})`,
          courtIds
        );
        await pool.execute(
          `DELETE FROM time_slots WHERE court_id IN (${placeholders})`,
          courtIds
        );
      }
      await pool.execute('DELETE FROM courts WHERE facility_id = ?', [facilityId]);
      await pool.execute('DELETE FROM facilities WHERE id = ?', [facilityId]);
      await pool.execute(
        'DELETE FROM admin_audit_logs WHERE resource_type = ? AND resource_id = ?',
        ['facility', facilityId]
      );
    }
    for (const userId of userIds) {
      await pool.execute('DELETE FROM admin_audit_logs WHERE admin_user_id = ?', [userId]);
      await pool.execute('DELETE FROM user_sessions WHERE user_id = ?', [userId]);
      await pool.execute('DELETE FROM users WHERE id = ?', [userId]);
    }
    if (userEmails.length) {
      const placeholders = userEmails.map(() => '?').join(', ');
      await pool.execute(`DELETE FROM users WHERE email IN (${placeholders})`, userEmails);
    }
  }

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

    async function createUser(name, role = 'USER') {
      const email = `facility-lifecycle-${crypto.randomUUID()}@example.test`;
      userEmails.push(email);
      const registration = await fetch(`${baseUrl}/api/v1/auth/register`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fullName: name,
          email,
          phone: `+84${String(crypto.randomInt(100000000, 1000000000))}`,
          password,
          termsAccepted: true
        })
      });
      assert.equal(registration.status, 201);
      const { user } = await registration.json();
      userIds.push(String(user.id));
      if (role === 'ADMIN') {
        await pool.execute('UPDATE users SET role = ? WHERE id = ?', [role, user.id]);
      }
      const login = await fetch(`${baseUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      assert.equal(login.status, 200);
      return {
        id: String(user.id),
        cookie: cookiePair(login.headers.get('set-cookie'))
      };
    }

    const admin = await createUser('Facility Lifecycle Admin', 'ADMIN');
    const user = await createUser('Facility Lifecycle User');

    async function request(path, method = 'GET', body, cookie) {
      const headers = {};
      if (cookie) headers.cookie = cookie;
      if (body !== undefined) headers['content-type'] = 'application/json';
      return fetch(`${baseUrl}${path}`, {
        method,
        headers,
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
    }

    async function createFacility(name, {
      openingTime = '06:00',
      closingTime = '19:00',
      isActive = true,
      withCourt = true
    } = {}) {
      const body = {
        name,
        address: 'Địa chỉ kiểm thử',
        district: 'Quận kiểm thử',
        opening_time: openingTime,
        closing_time: closingTime,
        is_active: isActive,
        courts: withCourt ? [{
          name: `Sân ${name}`,
          sport_type: 'BADMINTON',
          price_normal: 120000,
          price_peak: 150000,
          is_active: true
        }] : []
      };
      const response = await request('/api/v1/admin/facilities', 'POST', body, admin.cookie);
      return { response, body };
    }

    async function createSqlFacility(name, { isActive = true, withCourt = false } = {}) {
      const [facilityResult] = await pool.execute(
        `INSERT INTO facilities
           (name, address, district, opening_time, closing_time, amenities,
            is_active, is_seed, created_at, updated_at)
         VALUES (?, ?, ?, '06:00:00', '19:00:00', '[]', ?, FALSE,
                 UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [name, 'SQL test address', 'Quận kiểm thử', isActive]
      );
      const facilityId = String(facilityResult.insertId);
      facilityIds.push(facilityId);
      let courtId = null;
      if (withCourt) {
        const [courtResult] = await pool.execute(
          `INSERT INTO courts
             (facility_id, name, sport_type, price_normal, price_peak, is_active, is_seed,
              created_at, updated_at)
           VALUES (?, ?, 'BADMINTON', 120000, 150000, TRUE, FALSE,
                   UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [facilityId, `Sân ${name}`]
        );
        courtId = String(courtResult.insertId);
        const [slotResult] = await pool.execute(
          `INSERT INTO time_slots
             (court_id, service_date, starts_at, ends_at, price, status,
              created_at, updated_at)
           VALUES (?, ?, '06:00:00', '07:00:00', 120000, 'AVAILABLE',
                   UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [courtId, localDateOffset(1)]
        );
        return { facilityId, courtId, slotId: String(slotResult.insertId), name };
      }
      return { facilityId, courtId, name };
    }

    await t.test('new form facility is public immediately and exposes 13 one-hour slots', async () => {
      const before = await request('/api/v1/facilities?page_size=50', 'GET', undefined, admin.cookie);
      assert.equal(before.status, 200);
      assert.equal(before.headers.get('cache-control'), 'no-store');
      const beforeBody = await before.json();
      const summaryBefore = (await (await request(
        '/api/v1/admin/facilities?district=Quận%20không%20tồn%20tại&page_size=1',
        'GET',
        undefined,
        admin.cookie
      )).json()).summary;
      const name = `Immediate facility ${crypto.randomUUID()}`;
      const { response } = await createFacility(name);
      assert.equal(response.status, 201);
      const created = await response.json();
      facilityIds.push(String(created.id));

      const after = await request('/api/v1/facilities?page_size=50', 'GET', undefined, admin.cookie);
      assert.equal(after.status, 200);
      assert.equal(after.headers.get('cache-control'), 'no-store');
      const afterBody = await after.json();
      assert.equal(afterBody.pagination.total, beforeBody.pagination.total + 1);
      assert.ok(afterBody.facilities.some((facility) => String(facility.id) === String(created.id)));

      const search = await request(
        `/api/v1/facilities?q=${encodeURIComponent(name)}&sport=BADMINTON&district=${encodeURIComponent('Quận kiểm thử')}&page_size=50`,
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal(search.status, 200);
      assert.equal((await search.json()).facilities[0].name, name);

      const detail = await request(
        `/api/v1/facilities/${created.id}`,
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal(detail.status, 200);
      assert.equal(detail.headers.get('cache-control'), 'no-store');
      const courtId = (await detail.json()).courts[0].id;
      const slots = await request(
        `/api/v1/courts/${courtId}/time-slots?date=${localDateOffset(1)}`,
        'GET',
        undefined,
        admin.cookie
      );
      const timeSlots = (await slots.json()).time_slots;
      assert.equal(timeSlots.length, 13);
      assert.ok(timeSlots.every((slot) => {
        const startHour = Number(slot.starts_at.slice(0, 2));
        const endHour = Number(slot.ends_at.slice(0, 2));
        return endHour - startHour === 1;
      }));

      const adminList = await request('/api/v1/admin/facilities?page_size=50', 'GET', undefined, admin.cookie);
      const adminBody = await adminList.json();
      assert.equal(adminBody.summary.total_facilities, summaryBefore.total_facilities + 1);
      assert.equal(adminBody.summary.active_facilities, summaryBefore.active_facilities + 1);
      assert.equal(adminBody.summary.inactive_facilities, summaryBefore.inactive_facilities);
      assert.equal(adminBody.summary.active_courts >= 1, true);
      assert.equal(adminBody.summary.total_facilities,
        adminBody.summary.active_facilities + adminBody.summary.inactive_facilities);
      const eligibleAdminCount = adminBody.facilities.filter(
        (facility) => facility.is_active && facility.active_court_count > 0
      ).length;
      assert.equal(afterBody.pagination.total, eligibleAdminCount);
    });

    await t.test('a facility with no courts stays in admin but is not public', async () => {
      const name = `No court facility ${crypto.randomUUID()}`;
      const { facilityId } = await createSqlFacility(name);
      const publicList = await request(
        `/api/v1/facilities?q=${encodeURIComponent(name)}&page_size=50`,
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal(publicList.status, 200);
      assert.equal((await publicList.json()).pagination.total, 0);

      const adminList = await request(
        `/api/v1/admin/facilities?q=${encodeURIComponent(name)}&page_size=50`,
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal(adminList.status, 200);
      const adminFacility = (await adminList.json()).facilities[0];
      assert.equal(String(adminFacility.id), facilityId);
      assert.equal(adminFacility.court_count, 0);
    });

    await t.test('facility summary counts facilities across filters and after status changes', async () => {
      const name = `Summary facility ${crypto.randomUUID()}`;
      const { response } = await createFacility(name, { isActive: false });
      assert.equal(response.status, 201);
      const created = await response.json();
      facilityIds.push(String(created.id));

      const filtered = await request(
        '/api/v1/admin/facilities?is_active=true&page_size=1',
        'GET',
        undefined,
        admin.cookie
      );
      const before = (await filtered.json()).summary;
      assert.equal(before.total_facilities, before.active_facilities + before.inactive_facilities);
      assert.equal(before.inactive_facilities >= 1, true);

      const detail = await request(
        `/api/v1/admin/facilities/${created.id}`,
        'GET',
        undefined,
        admin.cookie
      );
      const current = (await detail.json()).facility;
      const reopened = await request(
        `/api/v1/admin/facilities/${created.id}`,
        'PATCH',
        { expected_updated_at: current.updated_at, is_active: true },
        admin.cookie
      );
      assert.equal(reopened.status, 200);
      const after = await request('/api/v1/admin/facilities?page_size=1', 'GET', undefined, admin.cookie);
      const afterSummary = (await after.json()).summary;
      assert.equal(afterSummary.total_facilities, before.total_facilities);
      assert.equal(afterSummary.active_facilities, before.active_facilities + 1);
      assert.equal(afterSummary.inactive_facilities, before.inactive_facilities - 1);
    });

    await t.test('deletion enforces authentication, role, existence, and optimistic locking', async () => {
      const { facilityId } = await createSqlFacility(`Delete guards ${crypto.randomUUID()}`);
      const detailResponse = await request(
        `/api/v1/admin/facilities/${facilityId}`,
        'GET',
        undefined,
        admin.cookie
      );
      const { facility } = await detailResponse.json();
      const endpoint = `/api/v1/admin/facilities/${facilityId}`;
      assert.equal((await request(endpoint, 'DELETE', {
        expected_updated_at: facility.updated_at
      })).status, 401);
      assert.equal((await request(endpoint, 'DELETE', {
        expected_updated_at: facility.updated_at
      }, user.cookie)).status, 403);
      const missing = await request('/api/v1/admin/facilities/9999999999999999999', 'DELETE', {
        expected_updated_at: facility.updated_at
      }, admin.cookie);
      assert.equal(missing.status, 404);

      await pool.execute(
        'UPDATE facilities SET updated_at = TIMESTAMPADD(SECOND, 1, updated_at) WHERE id = ?',
        [facilityId]
      );
      const stale = await request(endpoint, 'DELETE', {
        expected_updated_at: facility.updated_at
      }, admin.cookie);
      assert.equal(stale.status, 409);
      const remains = await pool.execute('SELECT id FROM facilities WHERE id = ?', [facilityId]);
      assert.equal(remains[0].length, 1);
    });

    await t.test('deleting a facility is atomic and removes its dependent data and public listing', async () => {
      const { facilityId, courtId, name } = await createSqlFacility(
        `Delete rollback ${crypto.randomUUID()}`,
        { withCourt: true }
      );
      const [slotRows] = await pool.execute(
        'SELECT id FROM time_slots WHERE court_id = ?',
        [courtId]
      );
      assert.equal(slotRows.length, 1);
      const detailResponse = await request(
        `/api/v1/admin/facilities/${facilityId}`,
        'GET',
        undefined,
        admin.cookie
      );
      const facility = (await detailResponse.json()).facility;

      const triggerName = `fail_facility_delete_${crypto.randomBytes(6).toString('hex')}`;
      triggerNames.push(triggerName);
      await pool.query(
        `CREATE TRIGGER ${triggerName} BEFORE DELETE ON courts
         FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'facility delete rollback test'`
      );
      const failedDelete = await request(
        `/api/v1/admin/facilities/${facilityId}`,
        'DELETE',
        { expected_updated_at: facility.updated_at },
        admin.cookie
      );
      assert.equal(failedDelete.status, 500);
      await pool.query(`DROP TRIGGER IF EXISTS ${triggerName}`);
      triggerNames.splice(triggerNames.indexOf(triggerName), 1);
      const afterRollback = await pool.execute(
        `SELECT (SELECT COUNT(*) FROM facilities WHERE id = ?) AS facilities,
                (SELECT COUNT(*) FROM courts WHERE id = ?) AS courts,
                (SELECT COUNT(*) FROM time_slots WHERE court_id = ?) AS slots`,
        [facilityId, courtId, courtId]
      );
      assert.deepEqual(
        Object.values(afterRollback[0][0]).map(Number),
        [1, 1, 1]
      );

      const summaryBeforeDelete = (await (await request(
        '/api/v1/admin/facilities?page_size=1',
        'GET',
        undefined,
        admin.cookie
      )).json()).summary;
      const deleted = await request(
        `/api/v1/admin/facilities/${facilityId}`,
        'DELETE',
        { expected_updated_at: facility.updated_at },
        admin.cookie
      );
      assert.equal(deleted.status, 200);
      assert.deepEqual(await deleted.json(), { id: facilityId, name });
      const persisted = await pool.execute(
        'SELECT action, details FROM admin_audit_logs WHERE action = ? AND resource_id = ?',
        ['DELETE_FACILITY', facilityId]
      );
      assert.equal(persisted[0].length, 1);
      assert.equal(JSON.parse(persisted[0][0].details).facility_name, name);
      const summaryAfterDelete = (await (await request(
        '/api/v1/admin/facilities?page_size=1',
        'GET',
        undefined,
        admin.cookie
      )).json()).summary;
      assert.equal(summaryAfterDelete.total_facilities, summaryBeforeDelete.total_facilities - 1);
      assert.equal(summaryAfterDelete.active_facilities, summaryBeforeDelete.active_facilities - 1);

      const list = await request(
        `/api/v1/facilities?q=${encodeURIComponent(name)}&page_size=50`,
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal((await list.json()).pagination.total, 0);
      const detail = await request(
        `/api/v1/facilities/${facilityId}`,
        'GET',
        undefined,
        admin.cookie
      );
      assert.equal(detail.status, 404);
      const noDependents = await pool.execute(
        `SELECT (SELECT COUNT(*) FROM facilities WHERE id = ?) AS facilities,
                (SELECT COUNT(*) FROM courts WHERE id = ?) AS courts,
                (SELECT COUNT(*) FROM time_slots WHERE court_id = ?) AS slots`,
        [facilityId, courtId, courtId]
      );
      assert.deepEqual(Object.values(noDependents[0][0]).map(Number), [0, 0, 0]);
    });

    await t.test('a cancelled booking history blocks deletion and preserves all records', async () => {
      const name = `Historical facility ${crypto.randomUUID()}`;
      const { facilityId, courtId, slotId } = await createSqlFacility(name, { withCourt: true });
      const [bookingResult] = await pool.execute(
        `INSERT INTO bookings
           (booking_code, user_id, status, total_amount, created_at, updated_at)
         VALUES (?, ?, 'CANCELLED', 120000, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [`SPB-DEL-${crypto.randomUUID().replaceAll('-', '')}`, user.id]
      );
      const bookingId = String(bookingResult.insertId);
      bookingIds.push(bookingId);
      await pool.execute(
        `INSERT INTO booking_slots
           (booking_id, time_slot_id, court_id, price_at_booking, created_at)
         VALUES (?, ?, ?, 120000, UTC_TIMESTAMP(3))`,
        [bookingId, slotId, courtId]
      );
      const detailResponse = await request(
        `/api/v1/admin/facilities/${facilityId}`,
        'GET',
        undefined,
        admin.cookie
      );
      const facility = (await detailResponse.json()).facility;
      const deletion = await request(
        `/api/v1/admin/facilities/${facilityId}`,
        'DELETE',
        { expected_updated_at: facility.updated_at },
        admin.cookie
      );
      assert.equal(deletion.status, 409);
      const error = (await deletion.json()).error;
      assert.equal(error.message,
        'Cơ sở đã có lịch sử đặt sân (1 đơn) nên không thể xóa. Hãy tạm khóa cơ sở thay vì xóa.');
      const intact = await pool.execute(
        `SELECT (SELECT COUNT(*) FROM facilities WHERE id = ?) AS facilities,
                (SELECT COUNT(*) FROM courts WHERE id = ?) AS courts,
                (SELECT COUNT(*) FROM time_slots WHERE id = ?) AS slots,
                (SELECT COUNT(*) FROM booking_slots WHERE booking_id = ?) AS booking_slots,
                (SELECT COUNT(*) FROM bookings WHERE id = ?) AS bookings`,
        [facilityId, courtId, slotId, bookingId, bookingId]
      );
      assert.deepEqual(Object.values(intact[0][0]).map(Number), [1, 1, 1, 1, 1]);
    });
  } finally {
    if (server) {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
    await cleanup();
    await closePool();
  }
});
