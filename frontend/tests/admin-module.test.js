'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const adminApi = require('../admin/admin-api.js');
const adminState = require('../admin/admin-state.js');
const adminShell = require('../admin/admin-shell.js');

const frontendRoot = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(frontendRoot, 'quan-tri.html'), 'utf8');
const adminCss = fs.readFileSync(path.join(frontendRoot, 'admin', 'admin.css'), 'utf8');
const mockupHtml = fs.readFileSync(path.join(frontendRoot, '..', 'docs', '02-design', 'mockups', 'danh-sach-dat-san-admin.html'), 'utf8');
const pageScript = fs.readFileSync(path.join(frontendRoot, 'admin', 'admin-page.js'), 'utf8');
const apiScript = fs.readFileSync(path.join(frontendRoot, 'admin', 'admin-api.js'), 'utf8');
const headerScript = fs.readFileSync(path.join(frontendRoot, 'shared', 'header.js'), 'utf8');
const shellScript = fs.readFileSync(path.join(frontendRoot, 'admin', 'admin-shell.js'), 'utf8');
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
  assert.match(pageScript, /cancel\.hidden = !model\.canCancel/);
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
  assert.match(html, /id="filterDraftStatus"[^>]*>Chưa áp dụng/);
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
  assert.match(html, /aria-modal="true"/);
  assert.match(apiScript, /cache: 'no-store'/);
  assert.match(apiScript, /credentials: 'same-origin'/);
  assert.match(html, /placeholder="Tìm theo mã đặt sân\.\.\."/);
  assert.match(html, /type="date"/);
  assert.match(html, /Bộ lọc nâng cao[\s\S]*?disabled/);
  assert.match(html, /id="applyBookingFilters"[\s\S]*?Tìm kiếm/);
  assert.match(pageScript, /elements\.focusBookingSearch\.addEventListener\('click', \(\) => elements\.search\.focus\(\)\)/);
  assert.match(headerScript, /const isAdmin = user\.role === 'ADMIN'/);
  assert.match(headerScript, /const showNavigation = window\.SportBookingHeaderState\.shouldShowNavigation\(user\.role\)/);
  assert.match(headerScript, /if \(showNavigation\) \{/);
  assert.match(headerScript, /if \(!isAdmin\) startNotificationPolling\(header\)/);
  assert.match(headerScript, /sb-shared-header__admin-role', 'Quản trị viên'/);
});

test('admin shell creates the shared navigation and disables only system settings', () => {
  const labels = [
    'Tổng quan',
    'Đơn đặt sân',
    'Người dùng',
    'Cơ sở & Sân',
    'Khung giờ & Giá',
    'Cài đặt hệ thống'
  ];
  const labelIndexes = labels.map((label) => shellScript.indexOf(`label: '${label}'`));
  assert.ok(labelIndexes.slice(0, -1).every((index) => index >= 0));
  assert.deepEqual(labelIndexes.slice(0, -1), labelIndexes.slice(0, -1).slice().sort((a, b) => a - b));
  assert.match(html, /data-admin-sidebar/);
  assert.match(shellScript, /settingLabel\.textContent = 'Cài đặt hệ thống'/);
  assert.match(shellScript, /soon\.textContent = 'Sắp có'/);
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
      pageSize: 50
    });
    await adminApi.getFacilities({ page: 2, pageSize: 50 });
    await adminApi.getDashboard('7d');
    await adminApi.cancelIncident('42', 'Sự cố tại sân');
    assert.equal(requests[0].url, '/api/v1/admin/bookings?page=2&page_size=50&status=CONFIRMED&q=SPB-42&date=2026-11-12&facility_id=23');
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
