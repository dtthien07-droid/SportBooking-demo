'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { TextEncoder } = require('node:util');

const {
  buildPaymentAttemptPayload,
  buildTransferQrPayload
} = require('../booking/payment-data');

test('builds the successful payment request payload', () => {
  assert.deepEqual(
    buildPaymentAttemptPayload('BANK_TRANSFER'),
    { method: 'BANK_TRANSFER', simulation_result: 'SUCCESS' }
  );
});

test('builds the failure payment request payload', () => {
  assert.deepEqual(
    buildPaymentAttemptPayload('MOMO', 'FAILURE'),
    { method: 'MOMO', simulation_result: 'FAILURE' }
  );
});

test('builds the exact local bank-transfer QR payload', () => {
  const payload = buildTransferQrPayload('SPB-0123456789ABCDEF0123456789ABCDEF', '171000');
  assert.equal(
    payload,
    'SPORTBOOKING|SPB-0123456789ABCDEF0123456789ABCDEF|171000'
  );

  const source = fs.readFileSync(
    path.join(__dirname, '../assets/qr-code.js'),
    'utf8'
  );
  const context = { TextEncoder, window: {} };
  vm.runInNewContext(source, context);
  assert.match(context.window.SportBookingQRCode.toSvg(payload), /^<svg /);
});
