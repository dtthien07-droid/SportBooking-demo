'use strict';

(function exposeAdminSlotsState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SportBookingAdminSlotsState = api;
}(typeof window === 'undefined' ? null : window, () => {
  const STATUS_LABELS = Object.freeze({
    AVAILABLE: 'Trống',
    LOCKED: 'Đang giữ chỗ',
    BOOKED: 'Đã đặt'
  });

  function localDate(value = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(value);
    const values = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
    return `${values.year}-${values.month}-${values.day}`;
  }

  function statusLabel(status) {
    return STATUS_LABELS[status] || 'Không xác định';
  }

  function normalizePrices(normalValue, peakValue) {
    if (!/^\d+$/.test(String(normalValue)) || !/^\d+$/.test(String(peakValue))) {
      throw new Error('Giá phải là số nguyên VND.');
    }
    const normal = Number(normalValue);
    const peak = Number(peakValue);
    if (!Number.isSafeInteger(normal) || !Number.isSafeInteger(peak)
        || normal < 0 || peak < normal || peak > 999999999999) {
      throw new Error('Giá giờ vàng phải lớn hơn hoặc bằng giá thường.');
    }
    return { price_normal: normal, price_peak: peak };
  }

  function formatMoney(value) {
    return `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)} đ`;
  }

  return { formatMoney, localDate, normalizePrices, statusLabel };
}));
