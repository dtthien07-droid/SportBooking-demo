'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const frontendRoot = path.resolve(__dirname, '..');
const dashboardPage = fs.readFileSync(path.join(frontendRoot, 'admin', 'dashboard-page.js'), 'utf8');
const bookingsPage = fs.readFileSync(path.join(frontendRoot, 'admin', 'admin-page.js'), 'utf8');
const adminShell = fs.readFileSync(path.join(frontendRoot, 'admin', 'admin-shell.js'), 'utf8');
const dashboardHtml = fs.readFileSync(path.join(frontendRoot, 'quan-tri-tong-quan.html'), 'utf8');

test('admin pages load Tailwind before applying the mockup theme configuration', () => {
  for (const file of [
    'quan-tri-tong-quan.html',
    'quan-tri-nguoi-dung.html',
    'quan-tri-san.html',
    'quan-tri-khung-gio-gia.html'
  ]) {
    const html = fs.readFileSync(path.join(frontendRoot, file), 'utf8');
    assert.ok(
      html.indexOf('https://cdn.tailwindcss.com') < html.indexOf('id="tailwind-config"'),
      `${file} must load Tailwind before its theme configuration`
    );
  }
});

test('dashboard uses the shared admin guard and API-backed mockup regions', () => {
  assert.match(dashboardPage, /shell\.authorizeAdmin\(/);
  assert.match(dashboardPage, /timeoutMs: 10000/);
  assert.match(dashboardPage, /api\.getDashboard\(elements\.range\.value, \{/);
  assert.match(dashboardPage, /renderChart\(result\.series, elements\.range\.value\)/);
  assert.match(dashboardPage, /renderTopCourts\(result\.top_courts/);
  assert.doesNotMatch(dashboardPage, /elements\.recentBookings\.replaceChildren/);
  assert.match(dashboardHtml, /data-admin-kpi="fill_rate_percent"/);
  assert.match(dashboardHtml, /id="mockupBookingRows"/);
  assert.match(dashboardHtml, /id="dashboardExport"[^>]*aria-label="Xuất báo cáo Excel"/);
  assert.doesNotMatch(dashboardHtml, /Theo dữ liệu API|data-admin-revenue-total/);
});

test('dashboard shows all six display statuses in order and explains court metrics', () => {
  const statuses = Array.from(
    dashboardHtml.matchAll(/data-admin-booking-status="([^"]+)"/g),
    (match) => match[1]
  );
  assert.deepEqual(statuses, [
    'PENDING',
    'UPCOMING',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED',
    'EXPIRED'
  ]);
  assert.doesNotMatch(dashboardHtml, /data-admin-booking-status="CONFIRMED"/);
  assert.match(dashboardHtml, /Sân có đơn đang hiệu lực trong kỳ/);
  assert.match(dashboardHtml, /Mẫu số: mọi khung AVAILABLE, BOOKED và LOCKED chưa hết hạn, trên mọi sân/);
  assert.match(dashboardHtml, /Top sân theo lượt đặt trong kỳ/);
});

test('dashboard Excel errors show a retry action', () => {
  assert.match(dashboardPage, /function exportDashboardReport\(\)/);
  assert.match(dashboardPage, /onError\(error\)/);
  assert.match(dashboardPage, /'Thử lại'/);
  assert.match(dashboardPage, /retry\.addEventListener\('click', exportDashboardReport\)/);
});

test('dashboard loads period-filtered booking pages and uses backend pagination', () => {
  assert.match(dashboardHtml, /data-admin-booking-pagination/);
  assert.doesNotMatch(dashboardHtml, /data-admin-booking-page="unused"|>12<\/button>/);
  assert.match(dashboardPage, /api\.getBookings\(\{[\s\S]*?page: bookingPage,[\s\S]*?range: elements\.range\.value,[\s\S]*?status: bookingStatusFilter/);
  assert.match(dashboardPage, /bookingTotalPages = Math\.max\(0, Number\(result\.pagination\.total_pages\)/);
  assert.match(dashboardPage, /loadBookings\(true\)/);
  assert.match(dashboardPage, /link\.href = `\/quan-tri\.html\?range=/);
  assert.match(dashboardHtml, /Thống kê theo ngày tạo đơn; Ngày chơi là bộ lọc riêng/);
  assert.match(bookingsPage, /range: selectedPeriod/);
  assert.match(bookingsPage, /params\.set\('range', selectedPeriod\)/);
  assert.doesNotMatch(dashboardPage, /\.innerHTML\b/);
});

test('dashboard API failures render an explicit retry action', () => {
  assert.match(bookingsPage, /if \(isPolling\) throw error;/);
  assert.match(dashboardPage, /if \(isPolling\) throw error;/);
  assert.match(bookingsPage, /admin-button admin-button--quiet', 'Thử lại'/);
  assert.match(dashboardPage, /admin-button admin-button--quiet', 'Thử lại'/);
  assert.match(dashboardPage, /if \(!container\) continue/);
  assert.doesNotMatch(adminShell, /Mất kết nối/);
});
