'use strict';

(function exposeDashboardState(root, factory) {
  const adminState = typeof module === 'object' && module.exports
    ? require('../booking/admin-state.js')
    : root?.SportBookingAdminState;
  const historyState = typeof module === 'object' && module.exports
    ? require('../booking/booking-history-state.js')
    : root?.SportBookingHistoryState;
  const api = factory(adminState, historyState);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SportBookingDashboardState = api;
}(typeof window === 'undefined' ? null : window, (adminState, historyState) => {
  if (!adminState || !historyState) throw new Error('Thiếu bộ nhãn trạng thái đơn dùng chung.');

  function thinLabels(n, width, minLabelWidth) {
    if (!Number.isInteger(n) || n <= 0) return [];
    if (!Number.isFinite(width) || width <= 0
        || !Number.isFinite(minLabelWidth) || minLabelWidth <= 0) {
      return n === 1 ? [0] : [0, n - 1];
    }
    if (n === 1) return [0];
    const maxLabels = Math.max(2, Math.floor(width / minLabelWidth));
    const stride = Math.ceil((n - 1) / (maxLabels - 1));
    const indexes = [];
    for (let index = 0; index < n; index += stride) indexes.push(index);
    if (indexes[indexes.length - 1] !== n - 1
        && (n - 1 - indexes[indexes.length - 1]) * width / (n - 1) >= minLabelWidth) {
      indexes.push(n - 1);
    }
    return indexes;
  }

  function formatAxisValue(value) {
    const amount = BigInt(value);
    const absolute = amount < 0n ? -amount : amount;
    const divisor = absolute >= 1000000n ? 1000000n : absolute >= 1000n ? 1000n : 1n;
    const suffix = divisor === 1000000n ? 'tr' : divisor === 1000n ? 'k' : '';
    if (!suffix) return amount.toLocaleString('vi-VN');
    const whole = absolute / divisor;
    const roundedTenth = ((absolute % divisor) * 10n + divisor / 2n) / divisor;
    const valueText = roundedTenth >= 10n
      ? String(whole + 1n)
      : roundedTenth === 0n ? String(whole) : `${whole},${roundedTenth}`;
    return `${amount < 0n ? '-' : ''}${valueText}${suffix}`;
  }

  function axisTicks(maximum) {
    const max = BigInt(maximum);
    if (max <= 0n) return [0n];
    const rawStep = (max + 3n) / 4n;
    const magnitude = 10n ** BigInt(String(rawStep).length - 1);
    const leading = (rawStep + magnitude - 1n) / magnitude;
    const niceLead = leading <= 1n ? 1n : leading <= 2n ? 2n : leading <= 5n ? 5n : 10n;
    const step = niceLead * magnitude;
    const top = ((max + step - 1n) / step) * step;
    const ticks = [];
    for (let value = 0n; value <= top; value += step) ticks.push(value);
    return ticks.slice(0, 5);
  }

  function formatMoney(value) {
    const raw = String(value ?? '0');
    if (!/^-?\d+$/.test(raw)) return '0 đ';
    return `${BigInt(raw).toLocaleString('vi-VN')} đ`;
  }

  function formatPercent(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0%';
    return `${number.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%`;
  }

  function formatDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').slice(0, 10));
    return match ? `${match[3]}/${match[2]}/${match[1]}` : 'Chưa có ngày';
  }

  function formatDayMonth(date) {
    const parts = new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      timeZone: 'Asia/Ho_Chi_Minh'
    }).formatToParts(date);
    const day = parts.find((part) => part.type === 'day')?.value;
    const month = parts.find((part) => part.type === 'month')?.value;
    return `${day}/${month}`;
  }

  function formatBucketLabel(start, granularity) {
    const date = new Date(start);
    if (!Number.isFinite(date.getTime())) return '';
    if (granularity === 'hour') {
      const hourLabel = new Intl.DateTimeFormat('vi-VN', {
        hour: '2-digit',
        hourCycle: 'h23',
        timeZone: 'Asia/Ho_Chi_Minh'
      }).format(date).replace(/\s*giờ$/u, '');
      return `${hourLabel}h`;
    }
    if (granularity === 'week') {
      const weekday = new Intl.DateTimeFormat('en-US', {
        weekday: 'short',
        timeZone: 'Asia/Ho_Chi_Minh'
      }).format(date);
      const weekdayLabels = { Mon: 'T2', Tue: 'T3', Wed: 'T4', Thu: 'T5', Fri: 'T6', Sat: 'T7', Sun: 'CN' };
      return `${weekdayLabels[weekday]} ${formatDayMonth(date)}`;
    }
    return formatDayMonth(date);
  }

  function formatBucketTooltip(bucket, granularity) {
    const date = new Date(bucket.start);
    const dateLabel = new Intl.DateTimeFormat('vi-VN', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'Asia/Ho_Chi_Minh'
    }).format(date).replace(/, /, ' ').replace(/^./, (letter) => letter.toLocaleUpperCase('vi'));
    const label = granularity === 'hour'
      ? `${dateLabel} ${new Intl.DateTimeFormat('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone: 'Asia/Ho_Chi_Minh'
      }).format(date)}`
      : dateLabel;
    return `${label}: ${formatMoney(bucket.net_revenue)}, ${Number(bucket.bookings) || 0} đơn`;
  }

  function getDisplayStatus(booking, currentTime = new Date()) {
    return adminState.getDisplayStatus(booking, currentTime);
  }

  function getBookingStatusLabel(booking, currentTime = new Date()) {
    return historyState.getBookingStatusLabel(getDisplayStatus(booking, currentTime));
  }

  function filterBookings(bookings, displayStatus, query, currentTime = new Date()) {
    const normalizedQuery = String(query || '').trim().toLocaleLowerCase('vi');
    return (Array.isArray(bookings) ? bookings : []).filter((booking) => {
      const matchesStatus = !displayStatus
        || getDisplayStatus(booking, currentTime) === displayStatus;
      const slots = Array.isArray(booking.slots) ? booking.slots : [];
      const haystack = [
        booking.booking_code,
        booking.owner?.full_name,
        booking.owner?.phone,
        ...slots.flatMap((slot) => [slot.facility_name, slot.court_name])
      ].filter(Boolean).join(' ').toLocaleLowerCase('vi');
      return matchesStatus && (!normalizedQuery || haystack.includes(normalizedQuery));
    });
  }

  return {
    axisTicks,
    filterBookings,
    formatAxisValue,
    formatBucketLabel,
    formatBucketTooltip,
    formatDate,
    formatMoney,
    formatPercent,
    getBookingStatusLabel,
    getDisplayStatus,
    thinLabels
  };
}));
