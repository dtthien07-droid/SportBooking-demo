'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const state = require('../admin/slots-state.js');

const frontendRoot = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(frontendRoot, 'admin', 'slots-page.js'), 'utf8');
const html = fs.readFileSync(path.join(frontendRoot, 'quan-tri-khung-gio-gia.html'), 'utf8');

test('slot statuses have explicit accessible text labels', () => {
  assert.equal(state.statusLabel('AVAILABLE'), 'Trống');
  assert.equal(state.statusLabel('LOCKED'), 'Đang giữ chỗ');
  assert.equal(state.statusLabel('BOOKED'), 'Đã đặt');
  assert.equal(state.statusLabel('INVALID'), 'Không xác định');
});

test('price normalization requires whole VND and peak not below normal', () => {
  assert.deepEqual(state.normalizePrices('100000', '150000'), {
    price_normal: 100000,
    price_peak: 150000
  });
  assert.throws(() => state.normalizePrices('', '150000'), /số nguyên/);
  assert.throws(() => state.normalizePrices('150000', '100000'), /lớn hơn hoặc bằng/);
});

test('slot date and money formatting use Vietnam locale', () => {
  assert.equal(state.localDate(new Date('2026-03-01T18:00:00.000Z')), '2026-03-02');
  assert.equal(state.formatMoney('1250000'), '1.250.000 đ');
});

test('slot management uses shared shell, polling, and safe DOM rendering', () => {
  assert.match(html, /\/admin\/admin-shell\.js/);
  assert.match(html, /data-admin-sidebar/);
  assert.match(html, /data-admin-slot-matrix/);
  assert.match(page, /mountAdminShell\(\{ active: 'slots' \}\)/);
  assert.match(page, /getAdminTimeSlots/);
  assert.match(page, /renderMockupSlots\(slots\)/);
  assert.doesNotMatch(page, /\.innerHTML\b/);
  assert.doesNotMatch(html + page, /localStorage|\bVIP\b|bùng cọc/i);
});
