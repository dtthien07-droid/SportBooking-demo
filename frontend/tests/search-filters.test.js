'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  buildSearchParams,
  getDateRange,
  getTimeBandSelectState,
  normalizeTimeBands,
  parseSearchState
} = require('../shared/search-filters');

const html = fs.readFileSync(path.join(__dirname, '../tim-san.html'), 'utf8');
const pageScript = fs.readFileSync(path.join(__dirname, '../tim-san.js'), 'utf8');

test('parses and serializes the shared date and time-band filters', () => {
  const parsed = parseSearchState(
    '?sport=BADMINTON&district=Ba+Dinh&q=pickle&date=2026-02-03&time_band=night,morning&page=2'
  );
  assert.deepEqual(parsed, {
    sport: 'BADMINTON',
    district: 'Ba Dinh',
    q: 'pickle',
    date: '2026-02-03',
    timeBands: ['morning', 'night'],
    page: 2
  });

  const params = buildSearchParams({
    ...parsed,
    timeBands: parsed.timeBands
  }, parsed.page);
  assert.equal(
    params.toString(),
    'sport=BADMINTON&district=Ba+Dinh&q=pickle&date=2026-02-03&time_band=morning%2Cnight&page=2'
  );
});

test('sets a Vietnam-local 14-day input range and a multi-band label', () => {
  assert.deepEqual(getDateRange(new Date('2026-01-01T18:00:00.000Z')), {
    min: '2026-01-02',
    max: '2026-01-15'
  });
  assert.deepEqual(normalizeTimeBands(['night', 'morning', 'morning', 'invalid']), [
    'morning',
    'night'
  ]);
  assert.deepEqual(getTimeBandSelectState(['night', 'morning']), {
    value: '__multiple__',
    label: 'Nhiều khung giờ (2)'
  });
});

test('enables supported controls and loads shared filter logic before the page script', () => {
  const dateInput = html.match(/<input[^>]*id="paramDate"[^>]*>/);
  const topTimeSelect = html.match(/<select[^>]*id="timeSlotSelect"[^>]*>[\s\S]*?<\/select>/);
  const slotCheckboxes = html.match(/<input[^>]*class="filter-slot-check[^>]*>/g) || [];
  assert.ok(dateInput);
  assert.match(dateInput[0], /type="date"/);
  assert.doesNotMatch(dateInput[0], /\bdisabled\b/);
  assert.ok(topTimeSelect);
  assert.doesNotMatch(topTimeSelect[0].split('>')[0], /\bdisabled\b/);
  assert.equal((topTimeSelect[0].match(/<option\b/g) || []).length, 5);
  assert.doesNotMatch(topTimeSelect[0], /--\s*--/);
  assert.equal(slotCheckboxes.length, 4);
  assert.ok(slotCheckboxes.every((input) => !/\bdisabled\b/.test(input)));
  assert.doesNotMatch(html, /TIỆN ÍCH|chưa thể lọc|Nhà vệ sinh sạch sẽ|Bãi đỗ ô tô \/ xe máy|Wifi miễn phí \/ Căng tin/i);
  assert.ok(html.indexOf('/shared/search-filters.js') < html.indexOf('/tim-san.js'));
  assert.match(pageScript, /params\.set\('date', filterState\.date\)/);
  assert.match(pageScript, /window\.addEventListener\('popstate'/);
  assert.doesNotMatch(pageScript, /params\.(?:get|set)\('amenity'|\bamenity\s*:/i);
  assert.match(pageScript, /const amenities = Array\.isArray\(facility\.amenities\)/);
});

test('ignores legacy amenity query parameters', () => {
  const parsed = parseSearchState('?amenity=x&page=3');
  assert.deepEqual(parsed, {
    sport: '',
    district: '',
    q: '',
    date: '',
    timeBands: [],
    page: 3
  });
  assert.equal(buildSearchParams(parsed, parsed.page).has('amenity'), false);
});
