'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const adminApi = require('../admin/admin-api.js');
const adminState = require('../admin/admin-state.js');
const bookingAdminState = require('../booking/admin-state.js');
const adminShell = require('../admin/admin-shell.js');

const frontendRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(frontendRoot, 'quan-tri.html'), 'utf8');
const adminCss = fs.readFileSync(path.join(frontendRoot, 'admin', 'admin.css'), 'utf8');
const mockupHtml = fs.readFileSync(path.join(frontendRoot, '..', 'docs', '02-design', 'mockups', 'danh-sach-dat-san-admin.html'), 'utf8');
const pageScript = fs.readFileSync(path.join(frontendRoot, 'admin', 'admin-page.js'), 'utf8');
const apiScript = fs.readFileSync(path.join(frontendRoot, 'admin', 'admin-api.js'), 'utf8');
const headerScript = fs.readFileSync(path.join(frontendRoot, 'shared', 'header.js'), 'utf8');
const shellScript = fs.readFileSync(path.join(frontendRoot, 'admin', 'admin-shell.js'), 'utf8');
const incidentDialogScript = fs.readFileSync(path.join(frontendRoot, 'admin', 'incident-cancel-dialog.js'), 'utf8');
const usersHtml = fs.readFileSync(path.join(frontendRoot, 'quan-tri-nguoi-dung.html'), 'utf8');
const usersPageScript = fs.readFileSync(path.join(frontendRoot, 'admin', 'users-page.js'), 'utf8');

test('role redirects use the shared home constants for admin, user, and unauthenticated visits', () => {
  assert.equal(adminState.USER_HOME, '/trangchu-user.html');
  assert.equal(adminState.ADMIN_HOME, '/quan-tri-tong-quan.html');
  assert.equal(adminState.getPostLoginDestination('ADMIN'), '/quan-tri-tong-quan.html');
  assert.equal(adminState.getPostLoginDestination('USER'), '/trangchu-user.html');
  assert.equal(adminState.getAdminAccessDestination(false), '/dang-nhap.html?returnTo=%2Fquan-tri-tong-quan.html');
  assert.equal(adminState.getAdminAccessDestination(true), '/trangchu-user.html');
});

test('lock confirmation allows optional reasons, enforces 300 characters, and blocks while submitting', () => {
  assert.equal(bookingAdminState.canSubmitLock('', false), true);
  assert.equal(bookingAdminState.canSubmitLock('Reason', false), true);
  assert.equal(bookingAdminState.canSubmitLock('x'.repeat(300), false), true);
  assert.equal(bookingAdminState.canSubmitLock('x'.repeat(301), false), false);
  assert.equal(bookingAdminState.canSubmitLock('', true), false);
  assert.match(usersPageScript, /el\.reason\.addEventListener\('input', updateLockDialogState\)/);
  assert.match(usersPageScript, /el\.confirm\.disabled = !state\.canSubmitLock/);
  assert.doesNotMatch(usersHtml, /name="ban-period"/);
  assert.match(usersHtml, /id="userLockReasonCount">0<\/span>\/300 ký tự/);
});

test('locked sessions redirect to the locked login notice and user summaries are rendered from API data', () => {
  assert.match(headerScript, /ACCOUNT_LOCKED/);
  assert.match(headerScript, /dang-nhap\.html\?locked=1/);
  assert.match(headerScript, /const CUSTOMER_HEADER_POLL_INTERVAL_MS = 5000;/);
  assert.match(headerScript, /}, CUSTOMER_HEADER_POLL_INTERVAL_MS\)/);
  assert.match(
    headerScript,
    /setInterval\(\s*refreshPendingHoldBanner,\s*CUSTOMER_HEADER_POLL_INTERVAL_MS\s*\)/
  );
  assert.match(usersPageScript, /data-admin-user-summary/);
  assert.match(usersHtml, /Đang hoạt động/);
  assert.match(usersHtml, /Bị khóa/);
  assert.doesNotMatch(usersHtml, /fonts\.googleapis\.com|material-symbols-outlined/);
});

test('status labels and incident cancellation visibility follow backend booking statuses', () => {
  const statuses = [
    ['PENDING', 'Chờ thanh toán', true],
    ['COMPLETED', 'Hoàn thành', false],
    ['CANCELLED', 'Đã hủy', false],
    ['EXPIRED', 'Hết hạn', false]
  ];
  for (const [status, label, canCancel] of statuses) {
    const presentation = adminState.getBookingRowPresentation({ status, slots: [] });
    assert.equal(presentation.label, label);
    assert.equal(presentation.canCancel, canCancel);
  }
  assert.equal(
    adminState.getBookingRowPresentation({
      status: 'CONFIRMED',
      slots: [{ service_date: '2026-11-12', starts_at: '09:00:00', ends_at: '11:00:00' }]
    }, new Date('2026-11-12T03:30:00Z')).label,
    'Đang trong trận'
  );
  assert.equal(adminState.getBookingStatusLabel('UNKNOWN'), 'Không xác định');
  assert.match(pageScript, /cancel\.hidden = !canCancel/);
  assert.match(pageScript, /incidentDialogApi\.mount\(/);
  assert.match(pageScript, /booking\.can_cancel_incident === true/);
});

test('confirmed booking display tabs follow the backend UTC+7 half-open slot rules', () => {
  const booking = {
    status: 'CONFIRMED',
    slots: [
      { service_date: '2026-11-12', starts_at: '09:00:00', ends_at: '10:00:00' },
      { service_date: '2026-11-12', starts_at: '10:00:00', ends_at: '11:00:00' }
    ]
  };
  assert.equal(adminState.getDisplayStatus(booking, new Date('2026-11-12T01:59:59.999Z')), 'UPCOMING');
  assert.equal(adminState.getDisplayStatus(booking, new Date('2026-11-12T02:00:00.000Z')), 'IN_PROGRESS');
  assert.equal(adminState.getDisplayStatus(booking, new Date('2026-11-12T04:00:00.000Z')), 'COMPLETED');
  assert.equal(adminState.getApiStatusForFilter('UPCOMING'), 'CONFIRMED');
  assert.equal(adminState.getApiStatusForFilter('IN_PROGRESS'), 'CONFIRMED');
  assert.equal(adminState.getApiStatusForFilter('COMPLETED'), 'COMPLETED');
  assert.deepEqual(adminState.countDisplayStatuses([booking], new Date('2026-11-12T02:00:00.000Z')),
    { UPCOMING: 0, IN_PROGRESS: 1, COMPLETED: 0 });
  assert.equal(adminState.filterBookingsByDisplayStatus([booking], 'IN_PROGRESS',
    new Date('2026-11-12T02:00:00.000Z')).length, 1);
});

test('money, schedule, and venue formatting handle normal, missing, and duplicate values', () => {
  assert.equal(adminState.formatMoney('1250000'), '1.250.000 đ');
  assert.equal(adminState.formatMoney(undefined), '0 đ');
  assert.equal(adminState.formatMoney('not-money'), '0 đ');
  assert.equal(adminState.mergeVenueNames('  Cơ sở A ', ' Sân   1 '), 'Cơ sở A — Sân 1');
  assert.equal(adminState.mergeVenueNames(' Sân A ', 'sân a'), 'Sân A');
  assert.equal(adminState.getVenueLabel({
    slots: [
      { facility_name: 'Cơ sở A', court_name: 'Sân 1' },
      { facility_name: 'Cơ sở A', court_name: 'Sân 1' }
    ]
  }), 'Cơ sở A — Sân 1');
  assert.equal(
    adminState.formatSchedule({
      slots: [
        { service_date: '2026-11-12', starts_at: '09:00:00', ends_at: '10:00:00' },
        { service_date: '2026-11-12', starts_at: '10:00:00', ends_at: '11:00:00' }
      ]
    }),
    '12/11/2026 · 09:00–11:00'
  );
  assert.equal(adminState.formatSchedule({ slots: [] }), 'Chưa có thông tin khung giờ');
});

test('table row models label every backend state and omit cancellation for terminal bookings', () => {
  const expectedRows = [
    ['PENDING', 'Chờ thanh toán', true],
    ['COMPLETED', 'Hoàn thành', false],
    ['CANCELLED', 'Đã hủy', false],
    ['EXPIRED', 'Hết hạn', false]
  ];
  for (const [status, label, canCancel] of expectedRows) {
    const row = adminState.getBookingRowModel({ status, owner: {}, slots: [] });
    assert.equal(row.label, label);
    assert.equal(row.canCancel, canCancel);
    assert.equal(typeof row.statusClass, 'string');
  }
  const confirmedRow = adminState.getBookingRowModel({
    status: 'CONFIRMED',
    owner: { full_name: 'Khách A', email: 'a@example.test' },
    slots: [{ service_date: '2026-11-12', starts_at: '09:00:00', ends_at: '10:00:00' }]
  }, new Date('2026-11-12T01:00:00.000Z'));
  assert.equal(confirmedRow.label, 'Sắp tới');
  assert.equal(confirmedRow.canCancel, true);
  assert.equal(confirmedRow.ownerName, 'Khách A');
  assert.equal(confirmedRow.ownerEmail, 'a@example.test');
});

test('cancellation reasons are required and constrained to the requested length', () => {
  assert.equal(adminState.isValidCancellationReason(' Lý do '), true);
  assert.equal(adminState.isValidCancellationReason('  '), false);
  assert.equal(adminState.isValidCancellationReason('ab'), false);
  assert.equal(adminState.isValidCancellationReason('x'.repeat(500)), true);
  assert.equal(adminState.isValidCancellationReason('x'.repeat(501)), false);
});

test('cancellation HTTP statuses each select their required handling path', () => {
  const expected = new Map([
    [400, 'reason'],
    [401, 'login'],
    [403, 'home'],
    [404, 'not-found'],
    [409, 'refresh'],
    [500, 'retry']
  ]);
  for (const [status, action] of expected) {
    assert.equal(adminState.getCancellationErrorAction(status), action);
  }
  assert.match(adminState.getCancellationErrorMessage(409, 'BOOKING_NOT_CANCELLABLE'), /đã bị hủy.*đã hoàn thành/);
  assert.match(adminState.getCancellationErrorMessage(404), /Không tìm thấy/);
  assert.equal(adminState.getCancellationErrorMessage(400, '', 'Lý do bắt buộc.'), 'Lý do bắt buộc.');
  assert.equal(
    adminState.getCancellationErrorMessage(409, 'BOOKING_NOT_CANCELLABLE', 'Lỗi chính xác từ backend.'),
    'Lỗi chính xác từ backend.'
  );
});

test('draft filters apply only on submit, reset together, and build minimal API queries', () => {
  let filters = adminState.createFilterState({
    status: 'PENDING',
    query: 'SPB-42',
    date: '2026-11-12',
    facilityId: '23',
    page: 4
  });
  filters = adminState.updateDraftFilter(filters, 'query', '  SPB-99  ');
  assert.equal(adminState.hasUnappliedFilters(filters), true);
  assert.doesNotMatch(html, /Bộ lọc nâng cao|Chưa áp dụng|filterDraftStatus/);
  assert.deepEqual(filters.applied, {
    status: 'PENDING',
    query: 'SPB-42',
    date: '2026-11-12',
    facilityId: '23',
    page: 4
  });
  assert.deepEqual(adminState.buildQuery({
    status: '',
    query: '',
    date: '',
    facilityId: '',
    page: 1
  }), { page: 1 });
  filters = adminState.applyDraftFilters(filters);
  assert.equal(filters.applied.query, 'SPB-99');
  assert.equal(filters.applied.page, 1);
  assert.equal(adminState.hasUnappliedFilters(filters), false);
  filters = adminState.setAppliedStatus(filters, 'IN_PROGRESS');
  assert.deepEqual(adminState.buildExportFilters(filters), {
    status: 'IN_PROGRESS',
    q: 'SPB-99',
    date: '2026-11-12',
    facility_id: '23'
  });
  assert.deepEqual(adminState.resetFilterState(), {
    draft: { query: '', date: '', facilityId: '' },
    applied: { status: '', query: '', date: '', facilityId: '', page: 1 }
  });
  assert.match(pageScript, /elements\.search\.addEventListener\('input', \(\) => updateDraftFilter\('query', elements\.search\.value\)\)/);
  assert.doesNotMatch(pageScript, /setTimeout\(\(\) => \{\s*listState\.query/);
});

test('facilities group and sort by Vietnamese district and facility names', () => {
  const grouped = adminState.groupFacilitiesByDistrict([
    { id: 8, name: 'Sân Z', district: 'Quận 10' },
    { id: 7, name: 'Sân Á', district: 'Quận 10' },
    { id: 6, name: 'Sân B', district: 'Quận 2' },
    { id: 5, name: 'Sân A', district: 'Quận 2' }
  ]);
  assert.deepEqual(
    grouped.map((group) => group.district),
    ['Quận 2', 'Quận 10'].sort((first, second) => first.localeCompare(second, 'vi'))
  );
  for (const group of grouped) {
    const names = group.district === 'Quận 10' ? ['Sân Z', 'Sân Á'] : ['Sân B', 'Sân A'];
    assert.deepEqual(
      group.facilities.map(({ name }) => name),
      names.sort((first, second) => first.localeCompare(second, 'vi'))
    );
  }
  assert.equal(adminState.getAllFacilitiesLabel(4), 'Tất cả cơ sở (4)');
});

test('applied filters serialize to the URL and invalid parameters are ignored', () => {
  const filters = adminState.createFilterState({
    status: 'CANCELLED',
    query: 'SPB-42',
    date: '2026-11-12',
    facilityId: '23',
    page: 3
  });
  assert.equal(
    adminState.serializeFilterState(filters.applied),
    '?status=CANCELLED&q=SPB-42&date=2026-11-12&facility=23&page=3'
  );
  assert.deepEqual(adminState.restoreFilterState(
    `?status=BOGUS&q=${'x'.repeat(101)}&date=2026-02-30&facility=0&page=0`
  ), {
    draft: { query: '', date: '', facilityId: '' },
    applied: { status: '', query: '', date: '', facilityId: '', page: 1 }
  });
  assert.deepEqual(adminState.restoreFilterState(
    '?status=CANCELLED&q=SPB-42&date=2026-11-12&facility=23&page=3'
  ), filters);
});

test('filter inputs only update draft and empty results offer a filter reset', () => {
  const initial = adminState.createFilterState();
  const draft = adminState.updateDraftFilter(initial, 'query', 'SPB-42');
  assert.equal(adminState.hasUnappliedFilters(draft), true);
  assert.match(pageScript, /elements\.filters\.addEventListener\('submit', applyFilters\)/);
  assert.match(pageScript, /elements\.date\.addEventListener\('input', \(\) => updateDraftFilter\('date', elements\.date\.value\)\)/);
  assert.match(pageScript, /elements\.facility\.addEventListener\('change', \(\) => updateDraftFilter\('facilityId', elements\.facility\.value\)\)/);
  assert.doesNotMatch(pageScript, /elements\.(?:search|date|facility)\.addEventListener\([^;]+(?:loadBookings|api\.)/);
  assert.match(pageScript, /'Không có đơn phù hợp với bộ lọc'[\s\S]*?'Đặt lại bộ lọc'/);
});

test('admin page uses safe text rendering, local SVG icons, and the required content limits', () => {
  assert.doesNotMatch(html, /\binnerHTML\b/i);
  assert.doesNotMatch(pageScript, /\.innerHTML\b/i);
  assert.doesNotMatch(html, /material-symbols-outlined|material-icons/i);
  assert.doesNotMatch(html, /check-in|\bVIP\b|\bGold\b|\bTennis\b|ưu đãi/i);
  assert.match(html, /data-sb-icon="search"/);
  assert.match(incidentDialogScript, /setAttribute\('aria-modal', 'true'\)/);
  assert.match(apiScript, /cache: 'no-store'/);
  assert.match(apiScript, /credentials: 'same-origin'/);
  assert.match(html, /placeholder="Tìm theo mã đặt sân\.\.\."/);
  assert.match(html, /type="date"/);
  assert.match(html, /id="applyBookingFilters"[\s\S]*?Tìm kiếm/);
  assert.match(html, /id="exportBookings"[\s\S]*?Xuất dữ liệu Excel/);
  assert.doesNotMatch(html, /Bộ lọc nâng cao|Chưa áp dụng/);
  assert.match(pageScript, /elements\.exportButton\.addEventListener\('click', downloadBookingsExport\)/);
  assert.match(pageScript, /state\.buildExportFilters\(filterState\)/);
  assert.match(pageScript, /showNotice\(error\.message \|\| 'Không thể xuất dữ liệu đơn đặt sân\.', 'error'\)/);
  assert.match(headerScript, /const isAdmin = user\.role === 'ADMIN'/);
  assert.match(headerScript, /const showNavigation = window\.SportBookingHeaderState\.shouldShowNavigation\(user\.role\)/);
  assert.match(headerScript, /if \(showNavigation\) \{/);
  assert.match(headerScript, /if \(!isAdmin\) startNotificationPolling\(header\)/);
  assert.match(headerScript, /sb-shared-header__admin-role', 'Quản trị viên'/);
});

test('admin shell creates the shared navigation without the system settings item', () => {
  const labels = [
    'Tổng quan',
    'Đơn đặt sân',
    'Người dùng',
    'Cơ sở & Sân',
    'Khung giờ & Giá'
  ];
  const labelIndexes = labels.map((label) => shellScript.indexOf(`label: '${label}'`));
  assert.ok(labelIndexes.every((index) => index >= 0));
  assert.deepEqual(labelIndexes, labelIndexes.slice().sort((a, b) => a - b));
  assert.match(html, /data-admin-sidebar/);
  assert.doesNotMatch(shellScript, /Cài đặt hệ thống/);
  assert.equal((shellScript.match(/href: '\/quan-tri-/g) || []).length, 4);
  assert.doesNotMatch(shellScript, /localStorage|material-symbols-outlined|check-in|\bVIP\b|\bGold\b|\bTennis\b|bùng cọc/i);
  assert.match(adminCss, /@media \(max-width: 900px\)[\s\S]*?\.admin-sidebar__list\s*\{[^}]*overflow-x: auto/);
});

test('polling backoff returns to five seconds after success and caps at thirty seconds', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 4].map(adminShell.getRetryDelay),
    [5000, 10000, 20000, 30000, 30000]
  );
  assert.match(shellScript, /controller\.signal\.aborted/);
  assert.match(shellScript, /document\.visibilityState === 'hidden'/);
  assert.match(shellScript, /document\.removeEventListener\('visibilitychange'/);
});

test('user management uses the shared guarded shell, draft filters, and safe rendering', () => {
  assert.match(usersHtml, /data-admin-sidebar/);
  assert.match(usersHtml, /id="userFilters"/);
  assert.match(usersHtml, /id="userLockModal"/);
  assert.match(usersPageScript, /shell\.startPolling/);
  assert.match(usersPageScript, /function renderMockupUsers/);
  assert.match(usersPageScript, /data-admin-page-ellipsis/);
  assert.match(usersPageScript, /String\(user\.id\) !== currentUserId/);
  assert.doesNotMatch(usersPageScript, /\.innerHTML\b|localStorage/);
  assert.equal(typeof adminApi.getUsers, 'function');
  assert.equal(typeof adminApi.setUserLock, 'function');
});

test('admin sidebar updates the active link without changing other navigation behavior', () => {
  const functionStart = pageScript.indexOf('  function renderAdminNavigation(selected) {');
  const functionEnd = pageScript.indexOf('\n  function createOption(', functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  const makeLink = (adminNav) => ({
    dataset: { adminNav },
    attributes: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    removeAttribute(name) { delete this.attributes[name]; }
  });
  const overviewLink = makeLink('overview');
  const bookingsLink = makeLink('bookings');
  const renderAdminNavigation = vm.runInNewContext(
    `(${pageScript.slice(functionStart, functionEnd).trim()})`,
    { elements: { navigationLinks: [overviewLink, bookingsLink] } }
  );
  renderAdminNavigation('overview');
  assert.equal(overviewLink.attributes.class, 'admin-sidebar__link is-active');
  assert.equal(overviewLink.attributes['aria-current'], 'location');
  assert.equal(bookingsLink.attributes.class, 'admin-sidebar__link');
  assert.equal(bookingsLink.attributes['aria-current'], undefined);
  renderAdminNavigation('bookings');
  assert.equal(bookingsLink.attributes['aria-current'], 'location');
  assert.match(pageScript, /window\.addEventListener\('hashchange', \(\) => \{\s*renderAdminNavigation/);
});

test('admin API uses the backend routes, query names, and cancellation payload', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return {
      ok: true,
      status: 200,
      async json() { return {}; }
    };
  };
  try {
    await adminApi.getBookings({
      status: 'CONFIRMED',
      query: 'SPB-42',
      date: '2026-11-12',
      facilityId: '23',
      page: 2,
      pageSize: 50,
      range: '7d'
    });
    await adminApi.getFacilities({ page: 2, pageSize: 50 });
    await adminApi.getDashboard('7d');
    await adminApi.cancelIncident('42', 'Sự cố tại sân');
    assert.equal(requests[0].url, '/api/v1/admin/bookings?page=2&status=CONFIRMED&q=SPB-42&date=2026-11-12&facility_id=23&range=7d');
    assert.equal(requests[1].url, '/api/v1/facilities?page=2&page_size=50');
    assert.equal(requests[2].url, '/api/v1/admin/dashboard?range=7d');
    assert.equal(requests[3].url, '/api/v1/admin/bookings/42/incident-cancellation');
    assert.deepEqual(JSON.parse(requests[3].options.body), { cancellation_reason: 'Sự cố tại sân' });
    for (const request of requests) {
      assert.equal(request.options.cache, 'no-store');
      assert.equal(request.options.credentials, 'same-origin');
    }
  } finally {
    global.fetch = originalFetch;
  }
});

test('admin API requests bypass caches and include same-origin session credentials', async () => {
  const originalFetch = global.fetch;
  let observed;
  global.fetch = async (url, options) => {
    observed = { url, options };
    return {
      ok: true,
      status: 200,
      async json() { return { user: { role: 'ADMIN' } }; }
    };
  };
  try {
    await adminApi.getMe();
    assert.equal(observed.url, '/api/v1/auth/me');
    assert.equal(observed.options.cache, 'no-store');
    assert.equal(observed.options.credentials, 'same-origin');
  } finally {
    global.fetch = originalFetch;
  }
});

test('a concurrent write makes an in-flight 304 fetch fresh dashboard data', async () => {
  const originalFetch = global.fetch;
  const cachedBody = { new_bookings: 4 };
  const updatedBody = { new_bookings: 5 };
  let dashboardRequests = 0;
  let resolveNotModified;
  global.fetch = (url, options) => {
    if (url === '/api/v1/admin/dashboard?range=cache-race') {
      dashboardRequests += 1;
      if (dashboardRequests === 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => '"dashboard-v1"' },
          async json() { return cachedBody; }
        });
      }
      if (dashboardRequests === 2) {
        assert.equal(options.headers['If-None-Match'], '"dashboard-v1"');
        return new Promise((resolve) => { resolveNotModified = resolve; });
      }
      assert.equal(options.headers['If-None-Match'], undefined);
      return Promise.resolve({
        ok: true,
        status: 200,
        headers: { get: () => null },
        async json() { return updatedBody; }
      });
    }
    if (url === '/api/v1/admin/facilities/999') {
      return Promise.resolve({
        ok: true,
        status: 200,
        async json() { return { facility: { id: '999' } }; }
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };
  try {
    assert.deepEqual(await adminApi.getDashboard('cache-race'), cachedBody);
    const pendingDashboard = adminApi.getDashboard('cache-race');
    await Promise.resolve();
    assert.equal(typeof resolveNotModified, 'function');
    await adminApi.updateAdminFacility('999', { is_active: false });
    resolveNotModified({
      ok: false,
      status: 304,
      headers: { get: () => null },
      async json() { throw new Error('304 has no response body'); }
    });
    assert.deepEqual(await pendingDashboard, updatedBody);
  } finally {
    global.fetch = originalFetch;
  }
});

test('admin API translates internal server errors into Vietnamese', async () => {
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 500,
    async json() {
      return { error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } };
    }
  });
  try {
    await assert.rejects(adminApi.getDashboard('today'), {
      message: 'Không thể hoàn tất thao tác do lỗi hệ thống. Vui lòng thử lại.'
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('shared report API endpoints preserve filters and pass responses through the XLSX helper', async () => {
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    const prefix = String(url).split('/').pop().split('?')[0] === 'export'
      ? 'report'
      : 'report';
    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return name === 'content-disposition'
            ? `attachment; filename="${prefix}-20261114-1200.xlsx"`
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        }
      },
      async blob() { return new Blob(['xlsx']); }
    };
  };
  try {
    await adminApi.exportDashboard('30d');
    await adminApi.exportUsers({ q: 'Locked User', status: 'ADMIN_LOCKED' });
    await adminApi.exportFacilities({
      q: 'Sân A',
      district: 'Cầu Giấy',
      is_active: 'false'
    });
    await adminApi.exportTimeSlots('42', { from: '2026-11-09', to: '2026-11-15' });
    assert.deepEqual(requests.map((request) => request.url), [
      '/api/v1/admin/dashboard/export?range=30d',
      '/api/v1/admin/users/export?q=Locked+User&status=ADMIN_LOCKED',
      '/api/v1/admin/facilities/export?q=S%C3%A2n+A&district=C%E1%BA%A7u+Gi%E1%BA%A5y&is_active=false',
      '/api/v1/admin/courts/42/time-slots/export?from=2026-11-09&to=2026-11-15'
    ]);
    assert.ok(requests.every(({ options }) => (
      options.credentials === 'same-origin' && options.cache === 'no-store'
    )));
  } finally {
    global.fetch = originalFetch;
  }
});

test('admin API never exposes unknown English errors and redirects locked accounts', async () => {
  const originalFetch = global.fetch;
  const originalWindow = global.window;
  const redirects = [];
  global.window = {
    SportBookingCurrentUser: { id: '2' },
    location: { replace: (url) => redirects.push(url) }
  };
  try {
    global.fetch = async () => ({
      ok: false,
      status: 500,
      async json() {
        return { error: { code: 'UNRECOGNIZED_SERVER_CODE', message: 'Unexpected error.' } };
      }
    });
    await assert.rejects(adminApi.getDashboard('today'), {
      message: 'Yêu cầu chưa thể hoàn tất. Vui lòng thử lại.'
    });

    global.fetch = async () => ({
      ok: false,
      status: 401,
      async json() {
        return {
          error: {
            code: 'ACCOUNT_LOCKED',
            message: 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên để được hỗ trợ.'
          }
        };
      }
    });
    await assert.rejects(adminApi.getMe(), {
      message: 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên để được hỗ trợ.'
    });
    assert.equal(global.window.SportBookingCurrentUser, null);
    assert.deepEqual(redirects, ['/dang-nhap.html?locked=1']);
  } finally {
    global.fetch = originalFetch;
    if (originalWindow === undefined) delete global.window;
    else global.window = originalWindow;
  }
});

test('admin export API downloads the applied filters as a credentialed XLSX blob', async () => {
  const originalFetch = global.fetch;
  let observed;
  global.fetch = async (url, options) => {
    observed = { url, options };
    return {
      ok: true,
      status: 200,
      headers: {
        get(name) {
          return name === 'content-disposition'
            ? 'attachment; filename="don-dat-san-20261114-1200.xlsx"'
            : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
        }
      },
      async blob() { return new Blob(['xlsx']); }
    };
  };
  try {
    const result = await adminApi.exportBookings({
      status: 'IN_PROGRESS',
      q: 'SPB 42',
      date: '2026-11-14',
      facility_id: '23'
    });
    assert.equal(
      observed.url,
      '/api/v1/admin/bookings/export?status=IN_PROGRESS&q=SPB+42&date=2026-11-14&facility_id=23'
    );
    assert.equal(observed.options.credentials, 'same-origin');
    assert.equal(observed.options.cache, 'no-store');
    assert.equal(result.filename, 'don-dat-san-20261114-1200.xlsx');
    assert.equal(result.blob.size, 4);
  } finally {
    global.fetch = originalFetch;
  }
});

test('admin page retains mockup classes except for replaced header, icons, and removed mockup actions', () => {
  const classTokens = (source) => new Set(
    [...source.matchAll(/\bclass\s*=\s*["']([^"']*)["']/g)]
      .flatMap((match) => match[1].trim().split(/\s+/))
      .filter(Boolean)
  );
  const mockupClasses = classTokens(mockupHtml);
  const pageClasses = classTokens(html);
  const intentionalOmissions = new Set([
    'animate-pulse',
    'bg-emerald-500',
    'border-[#F1F5F9]',
    'border-r',
    'bg-rose-100',
    'fixed',
    'gap-6',
    'h-16',
    'h-2',
    'h-screen',
    'hidden',
    'hover:bg-rose-50',
    'hover:bg-white',
    'hover:text-[#1E293B]',
    'leading-tight',
    'left-0',
    'material-symbols-outlined',
    'max-w-[1600px]',
    'md:block',
    'mx-auto',
    'pl-[218px]',
    'pr-3',
    'px-6',
    'py-2.5',
    'right-1.5',
    'right-2.5',
    'ring-2',
    'ring-white',
    'select-none',
    'shadow-[0_1px_2px_rgba(0,0,0,0.03)]',
    'sm:flex',
    'space-y-1',
    'sticky',
    'text-[#CBD5E1]',
    'text-[#D97706]',
    'text-[10px]',
    'text-[15px]',
    'text-[16px]',
    'text-[18px]',
    'text-[19px]',
    'text-[20px]',
    'top-0',
    'top-1.5',
    'tracking-wide',
    'w-10',
    'w-2',
    'w-64',
    'w-[218px]',
    'z-40',
    'z-30'
  ]);
  const missing = [...mockupClasses].filter((token) => !pageClasses.has(token)).sort();

  assert.deepEqual(missing, [...intentionalOmissions].sort());
});

test('admin page omits mockup demo scripts, localStorage, and text-based icon fonts', () => {
  const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .filter((match) => !/\bsrc\s*=/i.test(match[1]));

  assert.equal(inlineScripts.length, 1);
  assert.match(inlineScripts[0][2], /tailwind\.config/);
  assert.doesNotMatch(inlineScripts[0][2], /localStorage|SB-\d{4}|Nguyễn/i);
  assert.doesNotMatch(html, /\blocalStorage\b|Material\+Symbols|material-symbols-outlined/i);
  assert.doesNotMatch(html, /<span[^>]*>\s*(?:sports_soccer|notifications|search|more_vert)\s*<\/span>/i);
  assert.match(html, /<svg[^>]+data-sb-icon="search"/i);
  const filterForm = /<form id="bookingFilters"[\s\S]*?<\/form>/.exec(html)?.[0] || '';
  const lastButton = [...filterForm.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g)].at(-1)?.[0] || '';
  assert.match(lastButton, /id="applyBookingFilters"/);
  assert.match(lastButton, /Tìm kiếm/);
});

test('booking row template renders all six admin display states without errors', () => {
  const fieldNames = [
    'booking-code', 'created-at', 'owner-initials', 'owner-name', 'owner-contact',
    'venue', 'court', 'schedule', 'schedule-extra', 'paid-amount', 'refunded-label',
    'status', 'status-label', 'action-empty'
  ];
  const makeNode = () => ({
    textContent: '',
    hidden: false,
    attributes: {},
    listeners: {},
    setAttribute(name, value) { this.attributes[name] = String(value); },
    addEventListener(name, listener) { this.listeners[name] = listener; }
  });
  const makeTemplate = () => {
    const fields = new Map(fieldNames.map((name) => [name, makeNode()]));
    const cancel = makeNode();
    const row = {
      attributes: {},
      classList: {
        added: [],
        add(name) { this.added.push(name); }
      },
      setAttribute(name, value) { this.attributes[name] = String(value); },
      querySelector(selector) {
        const fieldMatch = /^\[data-field="([^"]+)"\]$/.exec(selector);
        if (fieldMatch) return fields.get(fieldMatch[1]) || null;
        if (selector === '[data-booking-row]') return this;
        if (selector === '[data-action="cancel"]') return cancel;
        return null;
      }
    };
    return {
      fields,
      cancel,
      row,
      content: {
        cloneNode() {
          return { querySelector: (selector) => row.querySelector(selector) };
        }
      }
    };
  };
  const functionStart = pageScript.indexOf('  function renderBookingRow(');
  const functionEnd = pageScript.indexOf('\n  function showSkeletonRows()', functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);

  const cases = [
    { status: 'PENDING', label: 'Chờ thanh toán', displayStatus: 'PENDING', canCancel: true },
    { status: 'CONFIRMED', label: 'Sắp tới', displayStatus: 'UPCOMING', canCancel: true, slot: {
      service_date: '2099-01-01', starts_at: '10:00:00', ends_at: '11:00:00'
    } },
    { status: 'CONFIRMED', label: 'Đang trong trận', displayStatus: 'IN_PROGRESS', canCancel: true, slot: (() => {
      const format = (timestamp) => {
        const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Ho_Chi_Minh',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hourCycle: 'h23'
        }).formatToParts(new Date(timestamp)).map(({ type, value }) => [type, value]));
        return {
          date: `${parts.year}-${parts.month}-${parts.day}`,
          time: `${parts.hour}:${parts.minute}:${parts.second}`
        };
      };
      return {
        service_date: format(Date.now()).date,
        starts_at: '00:00:00',
        ends_at: '23:59:59'
      };
    })() },
    { status: 'CONFIRMED', label: 'Hoàn thành', displayStatus: 'COMPLETED', canCancel: true, slot: {
      service_date: '2000-01-01', starts_at: '10:00:00', ends_at: '11:00:00'
    } },
    { status: 'CANCELLED', label: 'Đã hủy', displayStatus: 'CANCELLED', canCancel: false },
    { status: 'EXPIRED', label: 'Hết hạn', displayStatus: 'EXPIRED', canCancel: false }
  ];
  const elements = { rowTemplate: null };
  const renderBookingRow = vm.runInNewContext(
    `(${pageScript.slice(functionStart, functionEnd).trim()})`,
    { state: adminState, elements, openCancellation() {} }
  );

  for (const [index, item] of cases.entries()) {
    const template = makeTemplate();
    elements.rowTemplate = template;
    const row = renderBookingRow({
      booking_id: index + 1,
      booking_code: `SB-TEST-${index + 1}`,
      status: item.status,
      paid_amount: '100000',
      refunded_amount: '0',
      can_cancel_incident: item.canCancel,
      owner: { full_name: 'Khách kiểm thử', phone: '0900000000' },
      slots: item.slot ? [item.slot] : []
    }, index === 0);

    assert.equal(row.attributes['data-status'], item.displayStatus);
    assert.equal(template.fields.get('status-label').textContent, item.label);
    assert.equal(template.cancel.hidden, !item.canCancel);
    if (index === 0) {
      assert.deepEqual(row.classList.added, ['admin-booking-row--new']);
      assert.equal(row.attributes['data-new-booking'], 'true');
      assert.equal(row.attributes['aria-label'], 'Đơn đặt sân mới');
    }
  }
});
