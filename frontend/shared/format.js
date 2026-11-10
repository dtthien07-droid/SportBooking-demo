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

  return { maskPhone, formatBookingCode };
}));
