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

test('week and month ranges use Vietnam calendar dates', () => {
  assert.deepEqual(state.getWeekRange('2026-11-14'), {
    from: '2026-11-09',
    to: '2026-11-15',
    dates: [
      '2026-11-09',
      '2026-11-10',
      '2026-11-11',
      '2026-11-12',
      '2026-11-13',
      '2026-11-14',
      '2026-11-15'
    ]
  });
  const month = state.getMonthRange('2026-02');
  assert.equal(month.from, '2026-02-01');
  assert.equal(month.to, '2026-02-28');
  assert.equal(month.firstWeekday, 6);
  assert.equal(month.days.length, 28);
  assert.throws(() => state.getWeekRange('2026-02-30'), /Ngày xem không hợp lệ/);
});

test('partial price validation uses unchanged prices and enforces VND bounds', () => {
  assert.deepEqual(
    state.getPriceErrors('', '151000', { price_normal: 150000, price_peak: 150000 }),
    { normal: '', peak: '', form: '' }
  );
  assert.match(state.getPriceErrors('999', '', { price_peak: 150000 }).normal, /1\.000/);
  assert.match(state.getPriceErrors('150000', '1,000').peak, /số nguyên/);
  assert.match(state.getPriceErrors('160000', '', { price_peak: 150000 }).peak, /lớn hơn hoặc bằng/);
});

test('summary metrics count the selected range and format a Vietnamese fill rate', () => {
  const metrics = state.getSummaryMetrics([
    {
      total: 3,
      booked: 1,
      held: 1,
      available: 1,
      normal_total: 2,
      peak_total: 1,
      normal_occupied: 1,
      peak_occupied: 1,
      expected_revenue: '350000'
    },
    {
      total: 1,
      booked: 0,
      held: 0,
      available: 1,
      normal_total: 1,
      peak_total: 0,
      normal_occupied: 0,
      peak_occupied: 0,
      expected_revenue: '100000'
    }
  ]);
  assert.equal(metrics.total, 4);
  assert.equal(metrics.occupied, 2);
  assert.equal(metrics.available, 2);
  assert.equal(metrics.fillRate, 50);
  assert.equal(metrics.expectedRevenue, '450000');
});

test('slot management uses shared shell, polling, and safe DOM rendering', () => {
  assert.match(html, /\/admin\/admin-shell\.js/);
  assert.match(html, /data-admin-sidebar/);
  assert.match(html, /data-admin-slot-matrix/);
  assert.match(page, /mountAdminShell\(\{ active: 'slots' \}\)/);
  assert.match(page, /getAdminTimeSlots/);
  assert.match(page, /getAdminTimeSlotSummary/);
  assert.match(html, /id="slotViewWeek"[^>]*data-slot-view="week"/);
  assert.match(html, /id="slotViewMonth"[^>]*data-slot-view="month"/);
  assert.match(page, /el\.viewButtons\.forEach\(\(button\) => \{\s*button\.addEventListener\('click', \(\) => setViewMode\(button\.dataset\.slotView\)\)/);
  assert.match(page, /function setViewMode\(mode\) \{[\s\S]*?loadSlots\(\);/);
  assert.match(page, /if \(viewMode === 'month'\) \{[\s\S]*?renderMonth\(/);
  assert.match(page, /if \(viewMode === 'week'\) \{[\s\S]*?renderWeek\(/);
  assert.match(page, /updateAdminCourtPrices\(selectedCourt\.id,[\s\S]*true\)/);
  assert.match(page, /renderMockupSlots\(slots\)/);
  assert.doesNotMatch(page, /\.innerHTML\b/);
  assert.doesNotMatch(html + page, /localStorage|\bVIP\b|bùng cọc/i);
});

test('pricing rules omit the unsupported weekend surcharge card and fill two columns', () => {
  assert.doesNotMatch(html, /Phụ Phí Cuối Tuần|Mức phụ thu mỗi giờ|Cập nhật bảng giá đồng loạt|Hiện chưa áp dụng phụ phí/);
  assert.match(html, /grid grid-cols-1 md:grid-cols-2 gap-space-md/);
  assert.equal((html.match(/data-admin-slot-price=/g) || []).length, 2);
});
