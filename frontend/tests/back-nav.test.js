'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildDetailUrl, resolveBackTarget, backLabel } = require('../shared/back-nav.js');

const origin = 'https://sportbooking.test';

test('buildDetailUrl encodes booking ID and source path', () => {
  assert.equal(
    buildDetailUrl('42', '/lich-su-dat-san.html?page=2'),
    '/chi-tiet-don-dat-san.html?booking_id=42&from=%2Flich-su-dat-san.html%3Fpage%3D2'
  );
});

test('resolves a valid from route', () => {
  for (const route of [
    '/lich-su-dat-san.html',
    '/dat-san-thanh-cong.html',
    '/trangchu-user.html',
    '/thanh-toan.html',
    '/tim-san.html'
  ]) {
    assert.equal(
      resolveBackTarget(`?from=${encodeURIComponent(route)}`, '', origin),
      route
    );
  }
});

test('preserves a valid from route query string', () => {
  assert.equal(
    resolveBackTarget('?from=%2Fdat-san-thanh-cong.html%3Fbooking_id%3D42', '', origin),
    '/dat-san-thanh-cong.html?booking_id=42'
  );
});

test('rejects external, protocol, and non-whitelisted from targets', () => {
  for (const from of [
    'http://evil.com',
    '//evil.com',
    'javascript:alert(1)',
    '/khong-trong-danh-sach.html'
  ]) {
    assert.equal(
      resolveBackTarget(`?from=${encodeURIComponent(from)}`, '', origin),
      '/lich-su-dat-san.html',
      from
    );
  }
});

test('uses a same-origin whitelisted referrer when from is missing', () => {
  assert.equal(
    resolveBackTarget('', 'https://sportbooking.test/thanh-toan.html?booking_id=42', origin),
    '/thanh-toan.html?booking_id=42'
  );
});

test('uses the fallback when from and referrer are missing', () => {
  assert.equal(resolveBackTarget('', '', origin), '/lich-su-dat-san.html');
});

test('uses the fallback for a referrer from another origin', () => {
  assert.equal(
    resolveBackTarget('', 'https://evil.test/lich-su-dat-san.html', origin),
    '/lich-su-dat-san.html'
  );
});

test('returns the correct label for every allowed destination', () => {
  assert.deepEqual(
    [
      '/lich-su-dat-san.html',
      '/dat-san-thanh-cong.html?booking_id=42',
      '/trangchu-user.html',
      '/thanh-toan.html?booking_id=42',
      '/tim-san.html'
    ].map(backLabel),
    [
      'Quay lại lịch sử đặt sân',
      'Quay lại vé đặt sân',
      'Quay lại trang chủ',
      'Quay lại thanh toán',
      'Quay lại tìm sân'
    ]
  );
});
