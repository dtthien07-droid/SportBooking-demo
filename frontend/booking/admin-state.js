'use strict';

(function exposeAdminState(root, factory) {
  const historyState = typeof module === 'object' && module.exports
    ? require('./booking-history-state.js')
    : root?.SportBookingHistoryState;
  const api = factory(historyState);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SportBookingAdminState = api;
}(typeof window === 'undefined' ? null : window, (historyState) => {
  const USER_HOME = '/trangchu-user.html';
  const ADMIN_HOME = '/quan-tri-tong-quan.html';

  const BOOKING_STATUS_LABELS = Object.freeze({
    PENDING: 'Chờ thanh toán',
    CONFIRMED: 'Đã xác nhận',
    COMPLETED: 'Hoàn thành',
    EXPIRED: 'Hết hạn',
    CANCELLED: 'Đã hủy',
    UPCOMING: 'Sắp tới',
    IN_PROGRESS: 'Đang trong trận'
  });

  function getDisplayStatus(booking, currentTime = new Date()) {
    if (!booking || typeof booking !== 'object') return 'UNKNOWN';
    if (booking.status !== 'CONFIRMED') return BOOKING_STATUS_LABELS[booking.status]
      ? booking.status
      : 'UNKNOWN';
    const slots = Array.isArray(booking.slots)
      ? booking.slots.slice().sort((first, second) => (
        String(first.service_date).localeCompare(String(second.service_date))
        || String(first.starts_at).localeCompare(String(second.starts_at))
      ))
      : [];
    const first = slots[0];
    const last = slots[slots.length - 1];
    const start = Date.parse(`${String(first?.service_date || '').slice(0, 10)}T${first?.starts_at || ''}+07:00`);
    const end = Date.parse(`${String(last?.service_date || '').slice(0, 10)}T${last?.ends_at || ''}+07:00`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || !(currentTime instanceof Date)
        || !Number.isFinite(currentTime.getTime())) return 'UNKNOWN';
    if (currentTime.getTime() < start) return 'UPCOMING';
    return currentTime.getTime() < end ? 'IN_PROGRESS' : 'COMPLETED';
  }

  function canCancelIncident(status) {
    return status === 'PENDING' || status === 'CONFIRMED';
  }

  function getBookingStatusLabel(status) {
    if (historyState && ['PENDING', 'UPCOMING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED'].includes(status)) {
      return historyState.getBookingStatusLabel(status);
    }
    return BOOKING_STATUS_LABELS[status] || 'Không xác định';
  }

  function getPostLoginDestination(role) {
    return role === 'ADMIN' ? ADMIN_HOME : USER_HOME;
  }

  function getAdminAccessDestination(authenticated) {
    return authenticated
      ? USER_HOME
      : `/dang-nhap.html?returnTo=${encodeURIComponent(ADMIN_HOME)}`;
  }

  function isValidCancellationReason(reason) {
    return typeof reason === 'string'
      && reason.trim().length >= 3
      && reason.trim().length <= 500;
  }

  function canSubmitLock(reason, submitting) {
    return typeof reason === 'string' && reason.length <= 300 && !submitting;
  }

  function createIncidentCancellationSubmitter(post) {
    if (typeof post !== 'function') {
      throw new TypeError('A cancellation API function is required.');
    }

    let pending = false;
    return async function submitIncidentCancellation(bookingId, reason) {
      if (!isValidCancellationReason(reason)) return { status: 'invalid' };
      if (pending) return { status: 'in-progress' };

      pending = true;
      try {
        const response = await post(bookingId, {
          cancellation_reason: reason.trim()
        });
        return { status: 'submitted', response };
      } finally {
        pending = false;
      }
    };
  }

  function formatMoney(value) {
    if (value === null || value === undefined || value === '') return '--';
    const amount = BigInt(String(value));
    return `${new Intl.NumberFormat('vi-VN').format(amount)} đ`;
  }

  return {
    ADMIN_HOME,
    BOOKING_STATUS_LABELS,
    USER_HOME,
    canCancelIncident,
    canSubmitLock,
    createIncidentCancellationSubmitter,
    formatMoney,
    getAdminAccessDestination,
    getBookingStatusLabel,
    getDisplayStatus,
    getPostLoginDestination,
    isValidCancellationReason
  };
}));
