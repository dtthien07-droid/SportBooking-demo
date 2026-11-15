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

  function parseDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
      ? date
      : null;
  }

  function getWeekRange(value) {
    const selected = parseDate(value);
    if (!selected) throw new TypeError('Ngày xem không hợp lệ.');
    const monday = new Date(selected);
    monday.setUTCDate(monday.getUTCDate() - (monday.getUTCDay() + 6) % 7);
    const dates = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(monday);
      day.setUTCDate(day.getUTCDate() + index);
      return day.toISOString().slice(0, 10);
    });
    return { from: dates[0], to: dates[6], dates };
  }

  function getMonthRange(value) {
    const selected = parseDate(`${String(value).slice(0, 7)}-01`);
    if (!selected || typeof value !== 'string' || !/^\d{4}-\d{2}$/.test(value)) {
      throw new TypeError('Tháng xem không hợp lệ.');
    }
    const year = selected.getUTCFullYear();
    const monthIndex = selected.getUTCMonth();
    const daysInMonth = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const from = `${value}-01`;
    const to = `${value}-${String(daysInMonth).padStart(2, '0')}`;
    const firstWeekday = (selected.getUTCDay() + 6) % 7;
    const days = Array.from({ length: daysInMonth }, (_, index) => {
      const day = new Date(Date.UTC(year, monthIndex, index + 1));
      return {
        date: day.toISOString().slice(0, 10),
        weekday: (day.getUTCDay() + 6) % 7
      };
    });
    return { month: value, from, to, firstWeekday, days };
  }

  function formatDateVi(value) {
    const date = parseDate(value);
    if (!date) throw new TypeError('Ngày xem không hợp lệ.');
    return `${String(date.getUTCDate()).padStart(2, '0')}/${String(date.getUTCMonth() + 1).padStart(2, '0')}/${date.getUTCFullYear()}`;
  }

  function parsePrice(value) {
    const input = String(value).trim();
    if (/^\d+$/.test(input)) return Number(input);
    if (/^\d{1,3}(?:\.\d{3})+$/.test(input)) return Number(input.replace(/\./g, ''));
    return null;
  }

  function getPriceErrors(normalValue, peakValue, defaults = {}) {
    const normalText = String(normalValue ?? '').trim();
    const peakText = String(peakValue ?? '').trim();
    const normal = normalText ? parsePrice(normalText) : Number(defaults.price_normal);
    const peak = peakText ? parsePrice(peakText) : Number(defaults.price_peak);
    const errors = { normal: '', peak: '', form: '' };
    if (!normalText && !peakText) {
      errors.form = 'Cần nhập ít nhất một đơn giá.';
      return errors;
    }
    if (normal === null || !Number.isSafeInteger(normal) || normal < 1000 || normal > 10000000) {
      errors.normal = 'Giá thường phải là số nguyên từ 1.000 đến 10.000.000 VND.';
    }
    if (peak === null || !Number.isSafeInteger(peak) || peak < 1000 || peak > 10000000) {
      errors.peak = 'Giá cao điểm phải là số nguyên từ 1.000 đến 10.000.000 VND.';
    }
    if (!errors.normal && !errors.peak && peak < normal) {
      errors.peak = 'Giá cao điểm phải lớn hơn hoặc bằng giá thường.';
    }
    return errors;
  }

  function normalizePrices(normalValue, peakValue) {
    const errors = getPriceErrors(normalValue, peakValue);
    if (errors.normal || errors.peak || errors.form) {
      throw new Error(errors.normal || errors.peak || errors.form);
    }
    const normal = parsePrice(normalValue);
    const peak = parsePrice(peakValue);
    return { price_normal: normal, price_peak: peak };
  }

  function formatMoney(value) {
    return `${new Intl.NumberFormat('vi-VN').format(Number(value) || 0)} đ`;
  }

  function getSlotMetrics(slots) {
    if (!Array.isArray(slots)) throw new TypeError('Danh sách khung giờ không hợp lệ.');
    let booked = 0;
    let held = 0;
    let available = 0;
    let normalTotal = 0;
    let peakTotal = 0;
    let normalOccupied = 0;
    let peakOccupied = 0;
    let expectedRevenue = 0n;
    for (const slot of slots) {
      if (slot.status === 'BOOKED') booked += 1;
      else if (slot.status === 'LOCKED') held += 1;
      else if (slot.status === 'AVAILABLE') available += 1;
      const startHour = Number(String(slot.starts_at || '').slice(0, 2));
      const isPeak = startHour >= 17 && startHour < 21;
      if (isPeak) {
        peakTotal += 1;
        if (slot.status === 'BOOKED' || slot.status === 'LOCKED') peakOccupied += 1;
      } else {
        normalTotal += 1;
        if (slot.status === 'BOOKED' || slot.status === 'LOCKED') normalOccupied += 1;
      }
      const price = String(slot.price ?? '0');
      if (!/^\d+$/.test(price)) throw new TypeError('Giá khung giờ không hợp lệ.');
      expectedRevenue += BigInt(price);
    }
    const total = booked + held + available;
    return {
      total,
      booked,
      held,
      occupied: booked + held,
      available,
      fillRate: total === 0 ? 0 : Math.round((booked + held) * 1000 / total) / 10,
      normalTotal,
      peakTotal,
      normalFillRate: normalTotal === 0 ? 0 : Math.round(normalOccupied * 1000 / normalTotal) / 10,
      peakFillRate: peakTotal === 0 ? 0 : Math.round(peakOccupied * 1000 / peakTotal) / 10,
      expectedRevenue: expectedRevenue.toString()
    };
  }

  function getSummaryMetrics(days) {
    if (!Array.isArray(days)) throw new TypeError('Tổng hợp khung giờ không hợp lệ.');
    const total = days.reduce((sum, day) => sum + Number(day.total), 0);
    const booked = days.reduce((sum, day) => sum + Number(day.booked), 0);
    const held = days.reduce((sum, day) => sum + Number(day.held), 0);
    const available = days.reduce((sum, day) => sum + Number(day.available), 0);
    const normalTotal = days.reduce((sum, day) => sum + Number(day.normal_total || 0), 0);
    const peakTotal = days.reduce((sum, day) => sum + Number(day.peak_total || 0), 0);
    const normalOccupied = days.reduce((sum, day) => sum + Number(day.normal_occupied || 0), 0);
    const peakOccupied = days.reduce((sum, day) => sum + Number(day.peak_occupied || 0), 0);
    const expectedRevenue = days.reduce((sum, day) => {
      const revenue = String(day.expected_revenue);
      if (!/^\d+$/.test(revenue)) throw new TypeError('Doanh thu khung giờ không hợp lệ.');
      return sum + BigInt(revenue);
    }, 0n);
    return {
      total,
      booked,
      held,
      occupied: booked + held,
      available,
      fillRate: total === 0 ? 0 : Math.round((booked + held) * 1000 / total) / 10,
      normalTotal,
      peakTotal,
      normalFillRate: normalTotal === 0 ? 0 : Math.round(normalOccupied * 1000 / normalTotal) / 10,
      peakFillRate: peakTotal === 0 ? 0 : Math.round(peakOccupied * 1000 / peakTotal) / 10,
      expectedRevenue: expectedRevenue.toString()
    };
  }

  return {
    formatDateVi,
    formatMoney,
    getMonthRange,
    getPriceErrors,
    getSlotMetrics,
    getSummaryMetrics,
    getWeekRange,
    localDate,
    normalizePrices,
    statusLabel
  };
}));
