'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const dashboardState = require('../admin/dashboard-state.js');

test('thinLabels keeps a readable subset and preserves endpoints', () => {
  assert.deepEqual(dashboardState.thinLabels(0, 500, 60), []);
  assert.deepEqual(dashboardState.thinLabels(1, 500, 60), [0]);
  const indexes = dashboardState.thinLabels(24, 560, 60);
  assert.equal(indexes[0], 0);
  assert.ok(indexes[indexes.length - 1] <= 23);
  assert.ok(indexes.length <= 10);
  assert.ok(indexes.every((index, position) => (
    position === 0 || (index - indexes[position - 1]) * 560 / 23 >= 60
  )));
});

test('axis ticks use rounded 1, 2, 5 steps and compact Vietnamese labels', () => {
  assert.deepEqual(dashboardState.axisTicks(0n), [0n]);
  assert.ok(dashboardState.axisTicks(1115000n).length <= 5);
  assert.equal(dashboardState.formatAxisValue(0n), '0');
  assert.equal(dashboardState.formatAxisValue(1100000n), '1,1tr');
  assert.equal(dashboardState.formatAxisValue(500000n), '500k');
  assert.equal(dashboardState.formatMoney('1250000'), '1.250.000 đ');
  assert.equal(dashboardState.formatPercent(0.7), '0,7%');
  assert.equal(dashboardState.formatPercent(0.2188), '0,2%');
  assert.equal(dashboardState.formatPercent(0), '0%');
});

test('bucket labels and tooltips format time in Vietnam local time', () => {
  const bucket = {
    start: '2026-11-09T17:00:00.000Z',
    net_revenue: '1115000',
    bookings: 4
  };
  assert.equal(dashboardState.formatBucketLabel(bucket.start, 'hour'), '00h');
  assert.equal(dashboardState.formatBucketLabel(bucket.start, 'week'), 'T3 10/11');
  assert.match(dashboardState.formatBucketTooltip(bucket, 'hour'),
    /Thứ Ba 10\/11\/2026 00:00: 1\.115\.000 đ, 4 đơn/);
});
