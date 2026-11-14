'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const state = require('../admin/facilities-state.js');

const frontendRoot = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(frontendRoot, 'admin', 'facilities-page.js'), 'utf8');
const html = fs.readFileSync(path.join(frontendRoot, 'quan-tri-san.html'), 'utf8');

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
});

test('facility forms reject invalid hours, unsafe URLs, and excessive amenities', () => {
  const base = {
    name: 'Cơ sở A', address: 'Đường mẫu', district: 'Quận mẫu',
    opening_time: '06:00', closing_time: '22:00', hotline: '',
    map_url: '', image_url: '', amenities: '', description: '', rules: '',
    cancellation_policy: '', is_active: true
  };
  assert.throws(() => state.normalizeFacilityForm({ ...base, closing_time: '05:00' }), /nhỏ hơn/);
  assert.throws(() => state.normalizeFacilityForm({ ...base, map_url: 'http://example.test' }), /HTTPS/);
  assert.throws(() => state.normalizeFacilityForm({
    ...base,
    amenities: Array.from({ length: 21 }, (_, index) => `Mục ${index}`).join('\n')
  }), /tối đa 20/);
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
});

test('unsupported sports filter is disabled while the API-backed status filter remains available', () => {
  assert.match(html, /id="mockupFacilitySport" disabled/);
  assert.match(html, /id="mockupFacilityActive"/);
  assert.match(html, /S&#x1EAF;p c&#xF3;|Sắp có/);
});
