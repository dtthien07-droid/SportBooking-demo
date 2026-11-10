'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getStepState } = require('../shared/stepper');

test('booking page marks step 1 current and later steps upcoming', () => {
  assert.deepEqual([1, 2, 3].map((step) => getStepState(step, 1)), [
    'current', 'upcoming', 'upcoming'
  ]);
});

test('payment page marks step 1 complete, step 2 current, and step 3 upcoming', () => {
  assert.deepEqual([1, 2, 3].map((step) => getStepState(step, 2)), [
    'completed', 'current', 'upcoming'
  ]);
});

test('ticket page marks the first two steps complete and step 3 current', () => {
  assert.deepEqual([1, 2, 3].map((step) => getStepState(step, 3)), [
    'completed', 'completed', 'current'
  ]);
});

test('rejects step numbers outside the three-step flow', () => {
  assert.throws(() => getStepState(4, 1), RangeError);
  assert.throws(() => getStepState(1, 0), RangeError);
});
