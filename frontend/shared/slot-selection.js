'use strict';

function updateSlotSelection(slots, selectedSlotIds, clickedSlot) {
  const selected = slots
    .filter((slot) => selectedSlotIds.has(String(slot.id)))
    .sort((left, right) => left.starts_at.localeCompare(right.starts_at));
  const clickedIndex = selected.findIndex(
    (slot) => String(slot.id) === String(clickedSlot.id)
  );

  if (clickedIndex >= 0) {
    const remaining = clickedIndex === 0
      ? selected.slice(1)
      : selected.slice(0, clickedIndex);
    return {
      selectedSlotIds: new Set(remaining.map((slot) => String(slot.id))),
      rejected: false
    };
  }

  if (selected.length === 0) {
    return {
      selectedSlotIds: new Set([String(clickedSlot.id)]),
      rejected: false
    };
  }

  const first = selected[0];
  const last = selected[selected.length - 1];
  if (clickedSlot.ends_at === first.starts_at || last.ends_at === clickedSlot.starts_at) {
    return {
      selectedSlotIds: new Set(
        [...selected, clickedSlot]
          .sort((left, right) => left.starts_at.localeCompare(right.starts_at))
          .map((slot) => String(slot.id))
      ),
      rejected: false
    };
  }
  return { selectedSlotIds: new Set(selectedSlotIds), rejected: true };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { updateSlotSelection };
} else {
  window.SportBookingSlotSelection = { updateSlotSelection };
}
