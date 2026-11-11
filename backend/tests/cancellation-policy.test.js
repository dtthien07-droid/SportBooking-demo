'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { getCancellationRefund } = require('../src/bookings/cancellation-policy');

const now = new Date('2026-11-10T03:00:00.000Z');

function slotAt(hoursAhead) {
  const utc = new Date(now.getTime() + hoursAhead * 60 * 60 * 1000);
  const local = new Date(utc.getTime() + 7 * 60 * 60 * 1000);
  return {
    service_date: local.toISOString().slice(0, 10),
    starts_at: `${local.toISOString().slice(11, 19)}`
  };
}

test('refund thresholds use UTC+7 and include exactly 24h and 6h', () => {
  assert.equal(getCancellationRefund({
    firstSlot: slotAt(24),
    paidAmount: '100001',
    now
  }).refund_percent, 100);
  assert.equal(getCancellationRefund({
    firstSlot: slotAt(24 - 1 / 3600),
    paidAmount: '100001',
    now
  }).refund_percent, 50);
  assert.equal(getCancellationRefund({
    firstSlot: slotAt(6),
    paidAmount: '100001',
    now
  }).refund_percent, 50);
  assert.equal(getCancellationRefund({
    firstSlot: slotAt(6 - 1 / 3600),
    paidAmount: '100001',
    now
  }).refund_percent, 0);
});

test('partial refund rounds down to the nearest đồng', () => {
  const result = getCancellationRefund({
    firstSlot: slotAt(10),
    paidAmount: '100001',
    now
  });
  assert.equal(result.refund_amount, '50000');
  assert.equal(result.paid_amount, '100001');
  assert.equal(result.hours_until_start, 10);
  assert.equal(result.seconds_until_start, 10 * 60 * 60);
  assert.equal(result.server_time, now.toISOString());
  assert.match(result.message, /hoàn 50%/);
});
