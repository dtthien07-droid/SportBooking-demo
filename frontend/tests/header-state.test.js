'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  mergeVenueNames,
  shouldShowPendingBanner,
  subscribePendingBookingChanged
} = require('../shared/header-state.js');

const frontendRoot = path.join(__dirname, '..');

function findHtmlFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findHtmlFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.html') ? [entryPath] : [];
  });
}

test('every page using the shared header loads the pending banner configuration', () => {
  const pages = findHtmlFiles(frontendRoot);
  const headerPages = pages.filter((file) => (
    /\/shared\/header\.js/.test(fs.readFileSync(file, 'utf8'))
  ));
  assert.ok(headerPages.length > 0);
  for (const file of headerPages) {
    const html = fs.readFileSync(file, 'utf8');
    assert.match(html, /\/shared\/header-state\.js/);
    const relativePath = `/${path.relative(frontendRoot, file).split(path.sep).join('/')}`;
    assert.equal(
      shouldShowPendingBanner(relativePath, true),
      !['/thanh-toan.html', '/dang-nhap.html', '/dang-ky.html'].includes(relativePath),
      `${relativePath} must follow the shared header visibility rule`
    );
  }
});

test('pending banner visibility is limited only by the hidden paths and authentication', () => {
  for (const pathName of [
    '/trangchu-user.html',
    '/tim-san.html',
    '/chi-tiet-san.html',
    '/dat-san.html',
    '/dat-san-thanh-cong.html',
    '/ve-dien-tu.html',
    '/lich-su-dat-san.html',
    '/chi-tiet-don-dat-san.html',
    '/thong-bao.html',
    '/profile/profile.html'
  ]) {
    assert.equal(shouldShowPendingBanner(pathName, true), true, pathName);
  }
  assert.equal(shouldShowPendingBanner('/thanh-toan.html', true), false);
  assert.equal(shouldShowPendingBanner('/dang-nhap.html', true), false);
  assert.equal(shouldShowPendingBanner('/dang-ky.html', true), false);
  assert.equal(shouldShowPendingBanner('/tim-san.html', false), false);
});

test('venue names collapse whitespace and avoid duplicate facility/court labels', () => {
  assert.equal(mergeVenueNames('  Sân Cầu lông  ', 'sân   cầu LÔNG'), 'Sân Cầu lông');
  assert.equal(mergeVenueNames(' Cơ sở A ', ' Sân 1 '), 'Cơ sở A — Sân 1');
  assert.equal(mergeVenueNames('', ' Sân 1 '), 'Sân 1');
});

test('pending-booking-changed refreshes both the hold banner and notification count', () => {
  const target = new EventTarget();
  let pendingRefreshes = 0;
  let notificationRefreshes = 0;
  const unsubscribe = subscribePendingBookingChanged(
    target,
    () => { pendingRefreshes += 1; },
    () => { notificationRefreshes += 1; }
  );
  target.dispatchEvent(new Event('pending-booking-changed'));
  assert.equal(pendingRefreshes, 1);
  assert.equal(notificationRefreshes, 1);
  unsubscribe();
  target.dispatchEvent(new Event('pending-booking-changed'));
  assert.equal(pendingRefreshes, 1);
  assert.equal(notificationRefreshes, 1);
});
