'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  maskPhone,
  formatBookingCode,
  formatVietnamDateTime
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
