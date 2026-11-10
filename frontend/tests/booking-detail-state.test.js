'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { getVenueImagePresentation } = require('../booking/booking-detail-state.js');

test('uses a facility image when one is provided', () => {
  assert.deepEqual(
    getVenueImagePresentation('https://example.test/venue.jpg', 'BADMINTON'),
    { useImage: true, icon: null }
  );
});

test('selects a sport icon for the gradient fallback when no image exists', () => {
  assert.deepEqual(getVenueImagePresentation('', 'FOOTBALL_MINI'), {
    useImage: false,
    icon: 'sports_soccer'
  });
  assert.deepEqual(getVenueImagePresentation(null, 'PICKLEBALL'), {
    useImage: false,
    icon: 'sports_tennis'
  });
  assert.deepEqual(getVenueImagePresentation('', 'UNKNOWN'), {
    useImage: false,
    icon: 'sports'
  });
});
