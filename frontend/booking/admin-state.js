'use strict';

(function exposeAdminState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SportBookingAdminState = api;
}(typeof window === 'undefined' ? null : window, () => {
  const USER_HOME = '/trangchu-user.html';
  const ADMIN_HOME = '/quan-tri-tong-quan.html';

  const BOOKING_STATUS_LABELS = Object.freeze({
    PENDING: 'Chờ thanh toán',
    CONFIRMED: 'Đã xác nhận',
    COMPLETED: 'Hoàn thành',
    EXPIRED: 'Hết hạn',
    CANCELLED: 'Đã hủy',
    UPCOMING: 'Sắp tới',
    IN_PROGRESS: 'Đang diễn ra'
  });

  function canCancelIncident(status) {
    return status === 'PENDING' || status === 'CONFIRMED';
  }

  function getBookingStatusLabel(status) {
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
      && reason.trim().length > 0
      && reason.trim().length <= 500;
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
    createIncidentCancellationSubmitter,
    formatMoney,
    getAdminAccessDestination,
    getBookingStatusLabel,
    getPostLoginDestination,
    isValidCancellationReason
  };
}));
