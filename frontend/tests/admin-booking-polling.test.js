'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const state = require('../admin/admin-state.js');

const frontendRoot = path.resolve(__dirname, '..');
const page = fs.readFileSync(path.join(frontendRoot, 'admin', 'admin-page.js'), 'utf8');
const html = fs.readFileSync(path.join(frontendRoot, 'quan-tri.html'), 'utf8');
const css = fs.readFileSync(path.join(frontendRoot, 'admin', 'admin.css'), 'utf8');

test('new booking detection ignores previously visible IDs and deduplicates results', () => {
  assert.deepEqual(
    state.getNewBookingIds(['1', 2, '3', '3'], new Set(['1', '2'])),
    ['3']
  );
  assert.deepEqual(state.getNewBookingIds(['1', '2'], ['1', '2']), []);
});

test('booking polling keeps existing rows during requests and restores scroll after rendering', () => {
  assert.match(page, /async function loadBookings\(isPolling = false\)/);
  assert.match(page, /if \(!isPolling\) \{\s*showSkeletonRows\(\)/);
  assert.match(page, /captureBookingScroll\(\)/);
  assert.match(page, /restoreBookingScroll\(scrollSnapshot\)/);
  assert.match(page, /loadTabCounts\(isPolling\)/);
});

test('new rows receive a five-second highlight and manual changes refresh polling immediately', () => {
  assert.match(page, /admin-booking-row--new/);
  assert.match(css, /admin-booking-arrival 5s/);
  assert.match(page, /admin-data-changed[\s\S]*adminPolling\?\.refreshNow\(\)/);
});

test('booking admin route loads the shared shell and avoids unsafe API rendering', () => {
  assert.match(html, /\/admin\/admin-shell\.js/);
  assert.match(html, /data-admin-sidebar/);
  assert.doesNotMatch(page, /\.innerHTML\b/);
});
