'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const exportDownload = require('../admin/export-download.js');

const frontendRoot = path.resolve(__dirname, '..');

test('shared export helper reads only a quoted timestamped XLSX filename', () => {
  assert.equal(
    exportDownload.getFilename('attachment; filename="bao-cao-tong-quan-20261115-0853.xlsx"'),
    'bao-cao-tong-quan-20261115-0853.xlsx'
  );
  assert.equal(exportDownload.getFilename('attachment; filename=report.xlsx'), null);
  assert.equal(exportDownload.getFilename('attachment; filename="../report.xlsx"'), null);
});

test('shared export helper updates disabled and loading label states and restores them', () => {
  const label = { textContent: 'Xuất báo cáo Excel' };
  const attributes = new Map();
  const button = {
    dataset: {},
    disabled: false,
    querySelector: (selector) => selector === '[data-export-label]' ? label : null,
    setAttribute: (name, value) => attributes.set(name, value),
    removeAttribute: (name) => attributes.delete(name)
  };
  exportDownload.setButtonLoading(button, true);
  assert.equal(button.disabled, true);
  assert.equal(label.textContent, 'Đang xuất...');
  assert.equal(attributes.get('aria-busy'), 'true');
  exportDownload.setButtonLoading(button, false);
  assert.equal(button.disabled, false);
  assert.equal(label.textContent, 'Xuất báo cáo Excel');
  assert.equal(attributes.has('aria-busy'), false);
});

test('export errors map authorization, row limit, and network failures to Vietnamese', () => {
  assert.match(exportDownload.getErrorMessage(401), /đăng nhập/);
  assert.equal(
    exportDownload.getErrorMessage(400, 'EXPORT_TOO_MANY_ROWS'),
    'Quá nhiều dòng, hãy lọc thu hẹp'
  );
  assert.match(exportDownload.getErrorMessage(0), /kết nối/);
});

test('all export buttons share fixed inline icon sizing and chart has no removed footer', () => {
  const pageFiles = [
    ['quan-tri.html', 'exportBookings', 'Xuất dữ liệu Excel'],
    ['quan-tri-tong-quan.html', 'dashboardExport', 'Xuất báo cáo Excel'],
    ['quan-tri-nguoi-dung.html', 'usersExport', 'Xuất báo cáo Excel'],
    ['quan-tri-san.html', 'facilitiesExport', 'Xuất báo cáo Excel'],
    ['quan-tri-khung-gio-gia.html', 'slotsExport', 'Xuất báo cáo Excel']
  ];
  for (const [filename, buttonId, label] of pageFiles) {
    const html = fs.readFileSync(path.join(frontendRoot, filename), 'utf8');
    const button = new RegExp(`<button\\b[^>]*id="${buttonId}"[\\s\\S]*?<\\/button>`).exec(html)?.[0];
    assert.ok(button, `${filename} must include its export button`);
    assert.match(button, /class="[^"]*\badmin-export-btn\b/);
    assert.doesNotMatch(button, /Sắp có/i);
    assert.match(button, /<svg\b[^>]*class="[^"]*\badmin-export-btn__icon\b[^"]*"[^>]*width="18"[^>]*height="18"[^>]*viewBox="0 0 24 24"/);
    assert.equal(/data-export-label>([^<]*)<\/span>/.exec(button)?.[1], label);
  }
  const styles = fs.readFileSync(path.join(frontendRoot, 'admin', 'admin.css'), 'utf8');
  assert.match(styles, /\.admin-export-btn\s*\{[^}]*width:\s*200px;[^}]*height:\s*40px;[^}]*white-space:\s*nowrap;/);
  assert.match(styles, /\.admin-export-btn__icon\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;[^}]*flex:\s*none;/);
  const dashboard = fs.readFileSync(path.join(frontendRoot, 'quan-tri-tong-quan.html'), 'utf8');
  assert.doesNotMatch(dashboard, /Theo dữ liệu API|Doanh thu trong kỳ:\s*<strong/);
  const chartCard = /<div class="xl:col-span-5[^"]*">[\s\S]*?<!-- Card 2/.exec(dashboard)?.[0];
  assert.ok(chartCard, 'dashboard chart card must remain present');
  assert.doesNotMatch(chartCard.split('\n', 1)[0], /justify-between/);
});

test('admin report pages do not inject server data using innerHTML', () => {
  for (const filename of [
    'dashboard-page.js',
    'users-page.js',
    'facilities-page.js',
    'slots-page.js'
  ]) {
    const page = fs.readFileSync(path.join(frontendRoot, 'admin', filename), 'utf8');
    assert.doesNotMatch(page, /\.innerHTML\b/, filename);
  }
});

test('exports use the active page filters, dashboard period, and selected slot view range', () => {
  const dashboardPage = fs.readFileSync(
    path.join(frontendRoot, 'admin', 'dashboard-page.js'),
    'utf8'
  );
  const usersPage = fs.readFileSync(path.join(frontendRoot, 'admin', 'users-page.js'), 'utf8');
  const facilitiesPage = fs.readFileSync(
    path.join(frontendRoot, 'admin', 'facilities-page.js'),
    'utf8'
  );
  const slotsPage = fs.readFileSync(path.join(frontendRoot, 'admin', 'slots-page.js'), 'utf8');
  assert.match(dashboardPage, /api\.exportDashboard\(elements\.range\.value\)/);
  assert.match(usersPage, /api\.exportUsers\(\{ q: applied\.q, status: applied\.status \}\)/);
  assert.match(facilitiesPage, /api\.exportFacilities\(\{[\s\S]*?q: appliedFilters\.q,[\s\S]*?district: appliedFilters\.district,[\s\S]*?is_active: appliedFilters\.is_active/);
  assert.match(slotsPage, /viewMode === 'month'[\s\S]*?slotsState\.getMonthRange/);
  assert.match(slotsPage, /viewMode === 'week'[\s\S]*?slotsState\.getWeekRange/);
  assert.match(slotsPage, /api\.exportTimeSlots\(selectedCourt\.id, \{ from: range\.from, to: range\.to \}\)/);
});

test('slot page keeps save next to export and wraps the header actions responsively', () => {
  const html = fs.readFileSync(
    path.join(frontendRoot, 'quan-tri-khung-gio-gia.html'),
    'utf8'
  );
  const styles = fs.readFileSync(path.join(frontendRoot, 'admin', 'admin.css'), 'utf8');
  const actionsStart = html.indexOf('<div class="slots-page-actions');
  const statusStart = html.indexOf('id="slotsExportStatus"', actionsStart);
  const exportIndex = html.indexOf('id="slotsExport"', actionsStart);
  const saveIndex = html.indexOf('id="btn-save-all"', actionsStart);
  const primaryStart = html.lastIndexOf('<div class="slots-page-primary-actions">', exportIndex);
  const primaryEnd = html.indexOf('</div>', saveIndex);
  assert.ok(actionsStart >= 0 && statusStart > actionsStart);
  assert.ok(exportIndex > actionsStart && saveIndex > exportIndex && saveIndex < statusStart);
  assert.ok(primaryStart > actionsStart && primaryEnd > saveIndex && primaryEnd < statusStart);
  const headerStart = html.indexOf('<div class="slots-page-header');
  const header = html.slice(headerStart, statusStart);
  assert.ok(header.includes('Quản lý khung giờ &amp; Bảng giá sân'));
  assert.ok(header.includes('id="slotsExport"') && header.includes('id="btn-save-all"'));
  assert.doesNotMatch(header, /Sao chép sang tuần sau/);
  assert.match(header, /Lịch sử đổi giá[\s\S]*Xuất báo cáo Excel[\s\S]*Lưu &amp; Áp dụng ngay/);
  assert.match(styles, /\.slots-page-actions\s*\{[^}]*flex-wrap:\s*wrap/);
  assert.match(styles, /\.slots-page-primary-actions \.slots-page-action--save\s*\{[^}]*height:\s*40px/);
  assert.match(styles, /@media \(min-width: 1440px\)[\s\S]*?\.slots-page-title\s*\{[^}]*white-space:\s*nowrap;/);
  assert.match(styles, /\.slots-page-actions \.slots-page-action--soon\s*\{[^}]*padding-right:\s*4px;[^}]*padding-left:\s*4px;/);
});

test('slot summary keeps its four metrics and omits the daily report button', () => {
  const html = fs.readFileSync(
    path.join(frontendRoot, 'quan-tri-khung-gio-gia.html'),
    'utf8'
  );
  const summaryStart = html.indexOf('<!-- Bottom Analytics Bar: Real-time Stats & Projected Revenue -->');
  const summaryEnd = html.indexOf('<!-- Interactive Modal for Slot Management', summaryStart);
  const summary = html.slice(summaryStart, summaryEnd);
  assert.doesNotMatch(html, /Báo cáo ngày/);
  assert.match(summary, /Tổng khung giờ/);
  assert.match(summary, /Đã đặt &amp; Giữ chỗ/);
  assert.match(summary, /data-admin-slot-fill-rate/);
  assert.match(summary, /data-admin-slot-fill-bar/);
  assert.match(summary, /Còn trống/);
  assert.match(summary, /Doanh thu dự kiến/);
  assert.match(summary, /<!-- Available Slots -->[\s\S]*<!-- Projected Revenue Component -->/);
  assert.match(summary, /flex flex-wrap items-center justify-between lg:justify-end gap-space-lg/);
});
