'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  maskPhone,
  formatBookingCode,
  formatVietnamDateTime,
  formatFacilityRating,
  formatOpeningHours
} = require('../shared/format.js');

test('masks phone numbers while keeping their final three digits', () => {
  assert.equal(maskPhone('0912345678'), '*******678');
  assert.equal(maskPhone('+84 912-345-678'), '********678');
  assert.equal(maskPhone('123'), '123');
  assert.equal(maskPhone(''), '');
  assert.equal(maskPhone(null), '');
});

test('formats booking codes without truncating or changing letter case', () => {
  const bookingCode = 'spb-AbC-0123456789';
  assert.equal(formatBookingCode(bookingCode), `#${bookingCode}`);
  assert.equal(formatBookingCode(''), '');
});

test('formats booking timestamps in Vietnam time', () => {
  assert.equal(
    formatVietnamDateTime('2026-11-10T03:00:00.000Z'),
    '10:00 10/11/2026'
  );
  assert.throws(() => formatVietnamDateTime('invalid'), /Thời điểm đặt sân không hợp lệ/);
});

test('formats facility ratings to at most one decimal and hides missing ratings', () => {
  assert.equal(formatFacilityRating('3.70000'), '3.7');
  assert.equal(formatFacilityRating('4.00000'), '4');
  assert.equal(formatFacilityRating(null), null);
  assert.equal(formatFacilityRating(''), null);
});

test('formats opening hours without seconds and identifies 24-hour facilities', () => {
  assert.equal(formatOpeningHours('06:00:00', '23:00:00'), 'Mở cửa: 06:00 - 23:00');
  assert.equal(formatOpeningHours('00:00', '24:00'), 'Mở cửa 24/24');
  assert.equal(formatOpeningHours(null, null), '');
});
