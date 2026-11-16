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

test('booking selection cache is scoped to the requested court and consumed once', () => {
  const values = new Map();
  const window = {
    setTimeout,
    clearTimeout,
    location: { pathname: '/dat-san.html', search: '', hash: '', assign() {} },
    sessionStorage: {
      getItem(key) { return values.get(key) || null; },
      setItem(key, value) { values.set(key, value); },
      removeItem(key) { values.delete(key); }
    }
  };
  vm.runInNewContext(apiSource, { window, URLSearchParams, AbortController, Event, fetch });
  const facilityData = { facility: { id: '3' }, courts: [{ id: '4' }] };
  const slotData = { court_id: '4', service_date: '2026-11-12', time_slots: [{ id: '22' }] };

  window.SportBookingApi.storeBookingSelection(facilityData, slotData);
  const cached = window.SportBookingApi.consumeBookingSelection('3', '4', '2026-11-12');
  assert.deepEqual(JSON.parse(JSON.stringify(cached)), { facilityData, slotData });
  assert.equal(
    window.SportBookingApi.consumeBookingSelection('3', '4', '2026-11-12'),
    null
  );

  window.SportBookingApi.storeBookingSelection(facilityData, slotData);
  assert.equal(
    window.SportBookingApi.consumeBookingSelection('3', '5', '2026-11-12'),
    null
  );
  assert.equal(
    window.SportBookingApi.consumeBookingSelection('3', '4', '2026-11-12'),
    null
  );
});

test('booking, cancellation, and successful payment dispatch the pending-booking change event', async () => {
  const window = new EventTarget();
  Object.assign(window, {
    setTimeout,
    clearTimeout,
    location: { pathname: '/dat-san.html', search: '', hash: '', assign() {} }
  });
  let changes = 0;
  let bookingPayload;
  window.addEventListener('pending-booking-changed', () => { changes += 1; });
  const sandbox = {
    window,
    URLSearchParams,
    AbortController,
    Event,
    async fetch(_url, options) {
      if (options.method === 'POST' && options.body) {
        bookingPayload = JSON.parse(options.body);
      }
      return {
        status: 201,
        ok: true,
        async json() { return { booking_id: '14' }; }
      };
    }
  };
  vm.runInNewContext(apiSource, sandbox);

  await window.SportBookingApi.createBooking(['2'], 'FULL', {
    mode: 'CRITERIA',
    gender: 'FEMALE',
    skill: 'BEGINNER',
    format: 'SINGLES',
    message: 'Should be omitted'
  });
  assert.deepEqual(bookingPayload, { slot_ids: ['2'], payment_option: 'FULL' });
  await window.SportBookingApi.cancelBooking('14');
  await window.SportBookingApi.createPaymentAttempt('14', 'BANK_TRANSFER', 'SUCCESS');
  assert.equal(changes, 3);

  await window.SportBookingApi.createPaymentAttempt('14', 'BANK_TRANSFER', 'FAILURE');
  assert.equal(changes, 3);
});
