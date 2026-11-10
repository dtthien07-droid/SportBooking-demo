'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { decidePendingNotice } = require('../booking/pending-state.js');

test('pending notice state covers active, absent, conflict, and expiry responses', async (t) => {
  await t.test('renders a pending order with time remaining', () => {
    const pending = { id: '41', status: 'PENDING', remaining_seconds: 128 };
    assert.deepEqual(decidePendingNotice({ pending }), { action: 'render', pending });
  });

  await t.test('hides when there is no pending order', () => {
    assert.deepEqual(decidePendingNotice({ pending: null }), { action: 'hide' });
  });

  await t.test('fetches the order named by a 409 response', () => {
    assert.deepEqual(
      decidePendingNotice({ errorStatus: 409, pendingBookingId: '52' }),
      { action: 'fetch-booking', bookingId: '52' }
    );
  });

  await t.test('fetches the current pending order when a 409 lacks its id', () => {
    assert.deepEqual(decidePendingNotice({ errorStatus: 409 }), { action: 'fetch-pending' });
  });

  await t.test('hides expired and zero-time orders', () => {
    assert.deepEqual(
      decidePendingNotice({ pending: { id: '63', status: 'PENDING', remaining_seconds: 0 } }),
      { action: 'hide' }
    );
    assert.deepEqual(
      decidePendingNotice({ pending: { id: '63', status: 'EXPIRED', remaining_seconds: 30 } }),
      { action: 'hide' }
    );
  });
});
