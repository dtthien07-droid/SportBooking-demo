'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const state = require('../admin/facilities-state.js');

const frontendRoot = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(frontendRoot, 'admin', 'facilities-page.js'), 'utf8');
const html = fs.readFileSync(path.join(frontendRoot, 'quan-tri-san.html'), 'utf8');
const searchPage = fs.readFileSync(path.join(frontendRoot, 'tim-san.js'), 'utf8');
const detailPage = fs.readFileSync(path.join(frontendRoot, 'chi-tiet-san.js'), 'utf8');
const homePage = fs.readFileSync(path.join(frontendRoot, 'trangchu-user.js'), 'utf8');
const customerApi = fs.readFileSync(path.join(frontendRoot, 'shared', 'facilities-api.js'), 'utf8');

test('facility form normalizes amenities and permits 24:00 close time', () => {
  const result = state.normalizeFacilityForm({
    name: ' Cơ sở A ',
    address: 'Đường mẫu',
    district: 'Quận mẫu',
    opening_time: '06:00',
    closing_time: '24:00',
    hotline: '',
    map_url: '/assets/map.png',
    image_url: '',
    amenities: 'Bãi xe\nPhòng thay đồ\n',
    description: '',
    rules: '',
    cancellation_policy: '',
    is_active: true
  });
  assert.deepEqual(result.amenities, ['Bãi xe', 'Phòng thay đồ']);
  assert.equal(result.name, 'Cơ sở A');
  assert.equal(result.closing_time, '24:00');
  assert.match(html, /data-facility-field="closing_time" type="text"[^>]*24:00/);
});

test('facility forms reject invalid hours, unsafe URLs, and excessive amenities', () => {
  const base = {
    name: 'Cơ sở A', address: 'Đường mẫu', district: 'Quận mẫu',
    opening_time: '06:00', closing_time: '22:00', hotline: '',
    map_url: '', image_url: '', amenities: '', description: '', rules: '',
    cancellation_policy: '', is_active: true
  };
  assert.throws(() => state.normalizeFacilityForm({ ...base, closing_time: '05:00' }), /nhỏ hơn/);
  assert.throws(
    () => state.normalizeFacilityForm({ ...base, opening_time: '06:26' }),
    (error) => error.field === 'opening_time' && /giờ tròn/.test(error.message)
  );
  assert.throws(
    () => state.normalizeFacilityForm({ ...base, closing_time: '19:26' }),
    (error) => error.field === 'closing_time' && /giờ tròn/.test(error.message)
  );
  assert.throws(() => state.normalizeFacilityForm({ ...base, map_url: 'http://example.test' }), /HTTPS/);
  assert.throws(() => state.normalizeFacilityForm({
    ...base,
    amenities: Array.from({ length: 21 }, (_, index) => `Mục ${index}`).join('\n')
  }), /tối đa 20/);
});

test('facility toggle events resolve the facility attached to the clicked control', () => {
  const facilities = [
    { id: '11', name: 'Cơ sở đầu' },
    { id: '22', name: 'Cơ sở giữa' },
    { id: '33', name: 'Cơ sở cuối' }
  ];
  assert.equal(state.facilityIdFromToggleEvent({
    currentTarget: { dataset: { facilityId: '22' } }
  }), '22');
  assert.equal(state.findFacilityForToggleEvent({
    currentTarget: { dataset: { facilityId: '11' } }
  }, facilities), facilities[0]);
  assert.equal(state.findFacilityForToggleEvent({
    currentTarget: { dataset: { facilityId: '22' } }
  }, facilities), facilities[1]);
  assert.equal(state.findFacilityForToggleEvent({
    currentTarget: { dataset: { facilityId: '33' } }
  }, facilities), facilities[2]);
  assert.equal(state.findFacilityForToggleEvent({
    currentTarget: { dataset: { facilityId: '999' } }
  }, facilities), null);
});

test('facility row model and summary use the exact facility and keep zero values', () => {
  assert.deepEqual(state.buildFacilityRowModel({
    id: '22',
    name: 'Cơ sở giữa',
    address: 'Địa chỉ',
    district: 'Quận',
    opening_time: '06:00:00',
    closing_time: '19:00:00',
    active_court_count: 2,
    court_count: 3,
    active_booking_count: 0,
    is_active: false
  }), {
    id: '22',
    name: 'Cơ sở giữa',
    address: 'Địa chỉ',
    district: 'Quận',
    hours: '06:00 - 19:00',
    active_court_count: 2,
    court_count: 3,
    active_booking_count: 0,
    is_active: false,
    no_courts: false,
    status_text: 'Tạm khóa',
    toggle_label: 'Mở lại Cơ sở giữa'
  });
  assert.deepEqual(state.updateFacilitySummary({
    total_facilities: 0,
    active_facilities: 0,
    inactive_facilities: 0,
    avg_fill_rate_percent: 0
  }), {
    total_facilities: 0,
    active_facilities: 0,
    inactive_facilities: 0,
    avg_fill_rate_percent: 0
  });
  assert.equal(state.buildFacilityRowModel({
    id: '23', name: 'Chưa có sân', court_count: 0, active_court_count: 0
  }).no_courts, true);
});

test('facility deletion confirmation, no-court status, and facility summary are pure models', () => {
  assert.deepEqual(state.buildFacilityDeleteConfirmation({ name: 'Sân mẫu' }), {
    title: 'Xóa cơ sở Sân mẫu?',
    description: 'Hành động này không thể hoàn tác.',
    keep_label: 'Giữ lại',
    confirm_label: 'Xóa cơ sở'
  });
  assert.deepEqual(state.updateFacilitySummary({
    total_facilities: 5,
    active_facilities: 3,
    inactive_facilities: 2,
    avg_fill_rate_percent: 25
  }), {
    total_facilities: 5,
    active_facilities: 3,
    inactive_facilities: 2,
    avg_fill_rate_percent: 25
  });
  assert.equal(
    state.buildFacilityRowModel({ name: 'Trống', court_count: 0 }).no_courts,
    true
  );
});

test('court form accepts supported sports and integer prices only', () => {
  assert.deepEqual(state.normalizeCourtForm({
    name: 'Sân A', sport_type: 'BADMINTON', price_normal: '100000',
    price_peak: '120000', description: '', is_active: true
  }), {
    name: 'Sân A', sport_type: 'BADMINTON', price_normal: 100000,
    price_peak: 120000, description: '', is_active: true
  });
  assert.throws(() => state.normalizeCourtForm({
    name: 'Sân A', sport_type: 'BADMINTON', price_normal: '',
    price_peak: '120000', description: '', is_active: true
  }), /giá/);
  assert.throws(() => state.normalizeCourtForm({
    name: 'Sân A', sport_type: 'TENNIS', price_normal: '100000',
    price_peak: '120000', description: '', is_active: true
  }), /môn thể thao/);
});

test('facility page uses the shared admin shell and builds API data with DOM methods', () => {
  assert.match(html, /\/admin\/admin-shell\.js/);
  assert.match(html, /data-admin-sidebar/);
  assert.match(page, /mountAdminShell\(\{ active: 'facilities' \}\)/);
  assert.doesNotMatch(page, /\.innerHTML\b/);
  assert.match(page, /polling\?\.refreshNow\(\)/);
  assert.match(page, /courts: \[firstCourt\]/);
  assert.match(page, /Đang lưu\.\.\./);
  assert.match(html, /data-facility-field="opening_time" type="time" step="3600"/);
  assert.match(html, /data-facility-error="closing_time"/);
  assert.match(html, /id="firstCourtNormalPrice"/);
  assert.match(html, /id="firstCourtPeakPrice"/);
});

test('facility filters retain search, district, and status with balanced widths', () => {
  assert.doesNotMatch(html + page, /mockupFacilitySport/);
  assert.match(html, /md:col-span-6 relative[\s\S]*?id="mockupFacilitySearch"/);
  assert.match(html, /md:col-span-3[\s\S]*?id="mockupFacilityDistrict"/);
  assert.match(html, /id="mockupFacilityActive"/);
  assert.doesNotMatch(page, /sport_type.*filter|filter.*sport_type/i);
});

test('facility summary, table order, statuses, and actions use live admin data', () => {
  const tableHead = html.match(/<thead>[\s\S]*?<\/thead>/)?.[0] || '';
  assert.match(page, /renderSummary\(\{/);
  assert.match(page, /result\.summary\.avg_fill_rate_percent/);
  const headingIndex = html.indexOf('<!-- Header Action & Filter Panel -->');
  const summaryIndex = html.indexOf('<!-- Top Stat Highlights Bar -->');
  const tableIndex = html.indexOf('<!-- Facilities Data Table -->');
  assert.ok(headingIndex < summaryIndex && summaryIndex < tableIndex);
  assert.doesNotMatch(page, /data-facility-table'\)\?\.(?:before|after)/);
  assert.match(html, /Cơ sở đang mở/);
  assert.match(html, /Cơ sở tạm khóa/);
  assert.match(html, /data-admin-facility-active-facilities/);
  assert.match(html, /data-admin-facility-inactive-facilities/);
  assert.match(html, /data-admin-facility-fill-rate/);
  assert.match(html, /Tạm khóa/);
  assert.doesNotMatch(tableHead, /Môn thể thao|Đơn giá TB/);
  assert.match(page, /Xóa cơ sở/);
  assert.match(page, /SportBookingIcons\.createIcon\('delete'/);
  assert.match(page, /expected_updated_at: facility\.updated_at/);
  assert.match(page, /function confirmStatusChange/);
  assert.doesNotMatch(page, /window\.confirm/);
  assert.match(page, /expected_updated_at: facility\.updated_at/);
  assert.match(page, /Đã tạm khóa/);
  assert.match(page, /Đã mở lại/);
  assert.match(page, /function updateFacilityRow/);
  assert.match(page, /row\.replaceWith\(buildMockupFacilityRow\(facility\)\)/);
  assert.match(page, /expected_updated_at: el\.courtForm\.dataset\.updatedAt/);
  assert.match(page, /data-no-courts/);
  assert.match(html, /id="facilityMutationBanner"[^>]*role="status"/);
});

test('customer facility APIs avoid cache and inactive venues remain unbookable', () => {
  assert.match(searchPage, /facility\.is_active === false/);
  assert.match(searchPage, /bookButton\.disabled = true/);
  assert.match(detailPage, /const selectable = !inactive/);
  assert.match(homePage, /facility\.is_active === false/);
  assert.match(customerApi, /cache:\s*'no-store'/);
  assert.match(detailPage, /cache:\s*'no-store'/);
  assert.doesNotMatch(html, /fonts\.googleapis\.com/);
  assert.match(page, /SportBookingIcons\.setIcon\(icon/);
});
