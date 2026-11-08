'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { updateSlotSelection } = require('../shared/slot-selection');

const slots = [
  { id: '1', starts_at: '05:00:00', ends_at: '06:00:00' },
  { id: '2', starts_at: '06:00:00', ends_at: '07:00:00' },
  { id: '3', starts_at: '07:00:00', ends_at: '08:00:00' },
  { id: '4', starts_at: '08:00:00', ends_at: '09:00:00' },
  { id: '5', starts_at: '10:00:00', ends_at: '11:00:00' }
];

function choose(ids, slotId) {
  return updateSlotSelection(
    slots,
    new Set(ids),
    slots.find((slot) => slot.id === slotId)
  );
}

test('allows adjoining slots before and after the current selection', () => {
  assert.deepEqual([...choose(['2', '3'], '1').selectedSlotIds], ['1', '2', '3']);
  assert.deepEqual([...choose(['2', '3'], '4').selectedSlotIds], ['2', '3', '4']);
});

test('rejects a non-adjacent slot without changing the selection', () => {
  const result = choose(['1', '2'], '4');
  assert.equal(result.rejected, true);
  assert.deepEqual([...result.selectedSlotIds], ['1', '2']);
});

test('removing the first or last selected slot keeps the remaining adjacent range', () => {
  assert.deepEqual([...choose(['1', '2', '3'], '1').selectedSlotIds], ['2', '3']);
  assert.deepEqual([...choose(['1', '2', '3'], '3').selectedSlotIds], ['1', '2']);
});

test('removing a selected middle slot clears the later portion', () => {
  assert.deepEqual([...choose(['1', '2', '3'], '2').selectedSlotIds], ['1']);
});
