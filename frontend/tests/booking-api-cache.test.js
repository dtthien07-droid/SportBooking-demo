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
    Event,
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

test('booking, cancellation, and successful payment dispatch the pending-booking change event', async () => {
  const window = new EventTarget();
  Object.assign(window, {
    setTimeout,
    clearTimeout,
    location: { pathname: '/dat-san.html', search: '', hash: '', assign() {} }
  });
  let changes = 0;
  window.addEventListener('pending-booking-changed', () => { changes += 1; });
  const sandbox = {
    window,
    URLSearchParams,
    AbortController,
    Event,
    async fetch() {
      return {
        status: 201,
        ok: true,
        async json() { return { booking_id: '14' }; }
      };
    }
  };
  vm.runInNewContext(apiSource, sandbox);

  await window.SportBookingApi.createBooking(['2'], 'FULL');
  await window.SportBookingApi.cancelBooking('14');
  await window.SportBookingApi.createPaymentAttempt('14', 'BANK_TRANSFER', 'SUCCESS');
  assert.equal(changes, 3);

  await window.SportBookingApi.createPaymentAttempt('14', 'BANK_TRANSFER', 'FAILURE');
  assert.equal(changes, 3);
});
