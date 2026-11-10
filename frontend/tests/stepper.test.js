'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getStepState, render } = require('../shared/stepper');

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

test('ticket page marks all three steps complete', () => {
  assert.deepEqual([1, 2, 3].map((step) => getStepState(step, 'complete')), [
    'completed', 'completed', 'completed'
  ]);
});

test('renders accessible steps, completed connectors, and a labelled completion state', () => {
  const mount = { dataset: {} };
  render(mount, 2, { previousHref: '/dat-san.html' });

  assert.match(mount.innerHTML, /aria-current="step"/);
  assert.match(mount.innerHTML, /Đang thực hiện/);
  assert.match(mount.innerHTML, /Chưa tới/);
  assert.match(mount.innerHTML, /Đã xong/);
  assert.match(mount.innerHTML, /booking-stepper__circle bg-primary text-on-primary/);
  assert.match(mount.innerHTML, /booking-stepper__connector bg-primary"/);
  assert.match(mount.innerHTML, /booking-stepper__connector bg-surface-container-high"/);

  render(mount, 'complete');
  assert.equal((mount.innerHTML.match(/booking-stepper__check/g) || []).length, 3);
  assert.equal((mount.innerHTML.match(/booking-stepper__status text-primary">Đã xong/g) || []).length, 3);
  assert.equal((mount.innerHTML.match(/aria-label="Bước \d: Đã xong/g) || []).length, 3);
  assert.doesNotMatch(mount.innerHTML, /aria-current="step"/);
  assert.equal(mount.dataset.completedSteps, '3');
});

test('rejects step numbers outside the three-step flow', () => {
  assert.throws(() => getStepState(4, 1), RangeError);
  assert.throws(() => getStepState(1, 0), RangeError);
  assert.throws(() => getStepState(1, 5), RangeError);
});
