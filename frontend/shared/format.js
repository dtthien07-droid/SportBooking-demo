'use strict';

(function exposeFormat(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SportBookingFormat = api;
}(typeof window === 'undefined' ? null : window, () => {
  function maskPhone(phone) {
    const digits = String(phone || '').replace(/\D/g, '');
    if (!digits) return '';
    return `${'*'.repeat(Math.max(0, digits.length - 3))}${digits.slice(-3)}`;
  }

  function formatBookingCode(bookingCode) {
    if (bookingCode == null || bookingCode === '') return '';
    return `#${String(bookingCode)}`;
  }

  function formatVietnamDateTime(value) {
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) {
      throw new TypeError('Thời điểm đặt sân không hợp lệ.');
    }
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    }).format(date);
  }

  return { maskPhone, formatBookingCode, formatVietnamDateTime };
}));
