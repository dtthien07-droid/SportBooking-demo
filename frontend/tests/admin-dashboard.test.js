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
  assert.match(dashboardPage, /api\.getDashboard\(elements\.range\.value\)/);
  assert.match(dashboardPage, /renderChart\(result\.series, elements\.range\.value\)/);
  assert.match(dashboardPage, /renderTopCourts\(result\.top_courts/);
  assert.match(dashboardPage, /renderRecentBookings\(result\.recent_bookings/);
  assert.match(dashboardHtml, /data-admin-kpi="fill_rate_percent"/);
  assert.match(dashboardHtml, /id="mockupBookingRows"/);
  assert.match(dashboardHtml, /id="dashboardExport"[^>]*aria-label="Xuất báo cáo Excel"/);
  assert.doesNotMatch(dashboardHtml, /Theo dữ liệu API|data-admin-revenue-total/);
});

test('dashboard loads real booking pages and derives pagination from the backend total', () => {
  assert.match(dashboardHtml, /data-admin-booking-pagination/);
  assert.doesNotMatch(dashboardHtml, /data-admin-booking-page="unused"|>12<\/button>/);
  assert.match(dashboardPage, /api\.getBookings\(\{ page: bookingPage, page_size: bookingPageSize \}\)/);
  assert.match(dashboardPage, /Math\.ceil\(bookingTotal \/ bookingPageSize\)/);
  assert.match(dashboardPage, /loadBookings\(true\)/);
  assert.match(dashboardPage, /link\.href = `\/quan-tri\.html\?q=/);
  assert.doesNotMatch(dashboardPage, /\.innerHTML\b/);
});

test('polling failures retry silently without a dashboard error banner or retry button', () => {
  assert.doesNotMatch(bookingsPage + dashboardPage, /Không thể tải số liệu\. Vui lòng thử lại\./);
  assert.match(bookingsPage, /if \(isPolling\) throw error;/);
  assert.doesNotMatch(bookingsPage, /if \(isPolling && requestId === countsRequestId\)/);
  assert.match(dashboardPage, /if \(isPolling\) throw error;/);
  assert.doesNotMatch(dashboardPage, /Thử lại/);
  assert.doesNotMatch(adminShell, /Mất kết nối/);
});
