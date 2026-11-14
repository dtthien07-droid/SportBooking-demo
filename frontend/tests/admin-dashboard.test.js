'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const frontendRoot = path.resolve(__dirname, '..');
const dashboardPage = fs.readFileSync(path.join(frontendRoot, 'admin', 'dashboard-page.js'), 'utf8');
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
  assert.match(dashboardPage, /renderChart\(result\.revenue_by_day/);
  assert.match(dashboardPage, /renderTopCourts\(result\.top_courts/);
  assert.match(dashboardPage, /renderRecentBookings\(result\.recent_bookings/);
  assert.match(dashboardHtml, /data-admin-kpi="fill_rate_percent"/);
  assert.match(dashboardHtml, /id="mockupBookingRows"/);
});

test('dashboard avoids static page counts and exposes no unsupported row actions', () => {
  assert.match(dashboardHtml, /data-admin-booking-page="unused"/);
  assert.match(dashboardPage, /page === 'unused'/);
  assert.match(dashboardPage, /window\.location\.assign\(`\/quan-tri\.html\?q=/);
  assert.doesNotMatch(dashboardPage, /\.innerHTML\b/);
});
