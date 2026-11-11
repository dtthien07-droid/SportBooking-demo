'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const apiSource = fs.readFileSync(
  path.join(__dirname, '..', 'booking', 'bookings-api.js'),
  'utf8'
);

test('court time-slot requests bypass the browser cache', async () => {
  let fetchOptions;
  const window = {
    setTimeout,
    clearTimeout,
    location: { pathname: '/dat-san.html', search: '', hash: '', assign() {} }
  };
  const sandbox = {
    window,
    URLSearchParams,
    AbortController,
    async fetch(_url, options) {
      fetchOptions = options;
      return {
        status: 200,
        ok: true,
        async json() { return { time_slots: [] }; }
      };
    }
  };
  vm.runInNewContext(apiSource, sandbox);

  await window.SportBookingApi.getCourtSlots('12', '2026-11-12');
  assert.equal(fetchOptions.cache, 'no-store');
});
