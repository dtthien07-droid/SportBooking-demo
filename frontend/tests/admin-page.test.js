'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const adminState = require('../booking/admin-state.js');

const frontendRoot = path.resolve(__dirname, '..');
const adminPage = fs.readFileSync(path.join(frontendRoot, 'booking', 'admin-page.js'), 'utf8');
const loginScript = fs.readFileSync(path.join(frontendRoot, 'shared', 'app.js'), 'utf8');
const loginPage = fs.readFileSync(path.join(frontendRoot, 'dang-nhap.html'), 'utf8');
const adminHtml = fs.readFileSync(path.join(frontendRoot, 'admin-bookings.html'), 'utf8');

test('incident cancellation is available only for pending and confirmed bookings', () => {
  assert.equal(adminState.canCancelIncident('PENDING'), true);
  assert.equal(adminState.canCancelIncident('CONFIRMED'), true);
  for (const status of ['COMPLETED', 'EXPIRED', 'CANCELLED', 'UNKNOWN']) {
    assert.equal(adminState.canCancelIncident(status), false);
  }
});

test('blank cancellation reasons do not call the API', async () => {
  let calls = 0;
  const submit = adminState.createIncidentCancellationSubmitter(async () => {
    calls += 1;
  });

  assert.deepEqual(await submit('12', '   '), { status: 'invalid' });
  assert.equal(calls, 0);
  assert.equal(adminState.isValidCancellationReason('x'.repeat(501)), false);
});

test('duplicate submissions while a cancellation is pending produce one POST', async () => {
  let calls = 0;
  let resolvePost;
  const submit = adminState.createIncidentCancellationSubmitter(() => {
    calls += 1;
    return new Promise((resolve) => {
      resolvePost = resolve;
    });
  });

  const first = submit('12', ' Sự cố tại sân ');
  const second = await submit('12', 'Sự cố tại sân');
  assert.deepEqual(second, { status: 'in-progress' });
  assert.equal(calls, 1);
  resolvePost({ status: 'CANCELLED' });
  assert.deepEqual(await first, {
    status: 'submitted',
    response: { status: 'CANCELLED' }
  });
});

test('booking statuses use full Vietnamese labels', () => {
  const expected = {
    PENDING: 'Chờ thanh toán',
    CONFIRMED: 'Đã xác nhận',
    COMPLETED: 'Hoàn thành',
    EXPIRED: 'Hết hạn',
    CANCELLED: 'Đã hủy',
    UPCOMING: 'Sắp tới',
    IN_PROGRESS: 'Đang diễn ra'
  };
  for (const [status, label] of Object.entries(expected)) {
    assert.equal(adminState.getBookingStatusLabel(status), label);
  }
});

test('API data is rendered without innerHTML and admin does not load Google fonts', () => {
  assert.doesNotMatch(adminPage, /\.innerHTML\b/);
  assert.doesNotMatch(adminHtml, /fonts\.(?:googleapis|gstatic)\.com/i);
  assert.match(adminPage, /@import\\s\+url/);
});

test('login redirects by role and protected admin page returns non-admins to the appropriate page', () => {
  assert.equal(adminState.getPostLoginDestination('ADMIN'), '/quan-tri-tong-quan.html');
  assert.equal(adminState.getPostLoginDestination('USER'), '/trangchu-user.html');
  assert.equal(
    adminState.getAdminAccessDestination(true),
    '/trangchu-user.html'
  );
  assert.equal(
    adminState.getAdminAccessDestination(false),
    '/dang-nhap.html?returnTo=%2Fquan-tri-tong-quan.html'
  );
  assert.match(loginScript, /SportBookingAdminState\.getPostLoginDestination\(result\.user\.role\)/);
  assert.match(loginScript, /Bạn không có quyền truy cập/);
  assert.match(loginPage, /\/booking\/admin-state\.js[\s\S]*\/shared\/app\.js/);
});

test('admin header is mounted only after its server-side identity check succeeds', () => {
  assert.match(adminPage, /requestJson\('\/api\/v1\/auth\/me'\)/);
  assert.match(adminPage, /result\.user\?\.role !== 'ADMIN'/);
  assert.match(adminPage, /headerMount\.setAttribute\('data-shared-header'/);
});
