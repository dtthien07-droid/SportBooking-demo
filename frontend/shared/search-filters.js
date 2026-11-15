'use strict';

const TIME_BAND_VALUES = Object.freeze([
  'morning',
  'afternoon',
  'evening',
  'night'
]);
const TIME_BAND_SET = new Set(TIME_BAND_VALUES);

function normalizeTimeBands(values) {
  const selected = new Set(
    (Array.isArray(values) ? values : String(values || '').split(','))
      .map((value) => String(value).trim())
      .filter((value) => TIME_BAND_SET.has(value))
  );
  return TIME_BAND_VALUES.filter((value) => selected.has(value));
}

function getVietnamDateString(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(value);
  const fields = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function offsetDate(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function getDateRange(now = new Date()) {
  const today = getVietnamDateString(now);
  return { min: today, max: offsetDate(today, 13) };
}

function parseSearchState(search) {
  const params = new URLSearchParams(search);
  const requestedPage = Number(params.get('page'));
  return {
    sport: (params.get('sport') || '').toUpperCase(),
    district: params.get('district') || '',
    q: params.get('q') || '',
    date: params.get('date') || '',
    timeBands: normalizeTimeBands(params.get('time_band')),
    page: Number.isSafeInteger(requestedPage) && requestedPage > 0
      ? requestedPage
      : 1
  };
}

function buildSearchParams(filters, page) {
  const params = new URLSearchParams();
  if (filters.sport) params.set('sport', filters.sport);
  if (filters.district) params.set('district', filters.district);
  if (filters.q) params.set('q', filters.q);
  if (filters.date) params.set('date', filters.date);
  const timeBands = normalizeTimeBands(filters.timeBands);
  if (timeBands.length) params.set('time_band', timeBands.join(','));
  params.set('page', String(page));
  return params;
}

function getTimeBandSelectState(values) {
  const timeBands = normalizeTimeBands(values);
  if (timeBands.length > 1) {
    return {
      value: '__multiple__',
      label: `Nhiều khung giờ (${timeBands.length})`
    };
  }
  return { value: timeBands[0] || '', label: null };
}

const searchFilters = {
  TIME_BAND_VALUES,
  normalizeTimeBands,
  getDateRange,
  parseSearchState,
  buildSearchParams,
  getTimeBandSelectState
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = searchFilters;
} else {
  window.SportBookingSearchFilters = searchFilters;
}
