'use strict';

(function exposePaymentData(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SportBookingPaymentData = api;
}(typeof window === 'undefined' ? null : window, () => {
  const methods = new Set([
    'BANK_TRANSFER',
    'MOMO',
    'DOMESTIC_ATM',
    'INTERNATIONAL_CARD'
  ]);
  const results = new Set(['SUCCESS', 'FAILURE']);

  function buildPaymentAttemptPayload(method, simulationResult = 'SUCCESS') {
    if (!methods.has(method)) throw new TypeError('Unsupported payment method.');
    if (!results.has(simulationResult)) throw new TypeError('Unsupported payment result.');
    return { method, simulation_result: simulationResult };
  }

  function buildTransferQrPayload(bookingCode, amountDue) {
    if (typeof bookingCode !== 'string' || !/^[A-Za-z0-9-]+$/.test(bookingCode)) {
      throw new TypeError('A valid booking code is required.');
    }
    const amount = String(amountDue);
    if (!/^(0|[1-9]\d*)$/.test(amount)) {
      throw new TypeError('A valid payment amount is required.');
    }
    return `SPORTBOOKING|${bookingCode}|${amount}`;
  }

  return { buildPaymentAttemptPayload, buildTransferQrPayload };
}));
