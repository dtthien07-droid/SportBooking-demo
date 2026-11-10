'use strict';

(function exposePendingState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SportBookingPendingState = api;
}(typeof window === 'undefined' ? null : window, () => {
  function decidePendingNotice({ pending = null, errorStatus = null, pendingBookingId = null } = {}) {
    if (errorStatus === 409) {
      return pendingBookingId
        ? { action: 'fetch-booking', bookingId: String(pendingBookingId) }
        : { action: 'fetch-pending' };
    }
    if (!pending || pending.status !== 'PENDING' || Number(pending.remaining_seconds) <= 0) {
      return { action: 'hide' };
    }
    return { action: 'render', pending };
  }

  return { decidePendingNotice };
}));
