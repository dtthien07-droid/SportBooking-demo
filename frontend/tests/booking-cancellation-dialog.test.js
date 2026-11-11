'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const historyState = require('../booking/booking-history-state.js');

const root = path.resolve(__dirname, '..', '..');
const dialogSource = fs.readFileSync(
  path.join(root, 'frontend', 'booking', 'cancellation-dialog.js'),
  'utf8'
);
const apiSource = fs.readFileSync(
  path.join(root, 'frontend', 'booking', 'bookings-api.js'),
  'utf8'
);
const html = fs.readFileSync(
  path.join(root, 'frontend', 'chi-tiet-don-dat-san.html'),
  'utf8'
);
const css = fs.readFileSync(
  path.join(root, 'frontend', 'booking', 'booking.css'),
  'utf8'
);

const backendPreviewJson = {
  refund_percent: 0,
  refund_amount: '0',
  paid_amount: '100000',
  hours_until_start: 0.13,
  message: 'Còn dưới 6 giờ trước giờ bắt đầu: không hoàn tiền.'
};

test('refund preview API accepts the backend JSON without optional time fields', async () => {
  let requestUrl;
  let requestOptions;
  const window = {
    setTimeout,
    clearTimeout,
    location: { pathname: '/', search: '', hash: '', assign() {} }
  };
  vm.runInNewContext(apiSource, {
    window,
    URLSearchParams,
    AbortController,
    async fetch(url, options) {
      requestUrl = url;
      requestOptions = options;
      return {
        status: 200,
        ok: true,
        async json() { return backendPreviewJson; }
      };
    }
  });

  const preview = await window.SportBookingApi.getRefundPreview('42');
  assert.equal(requestUrl, '/api/v1/bookings/42/refund-preview');
  assert.equal(requestOptions.method, undefined);
  assert.equal(requestOptions.cache, 'no-store');
  assert.equal(preview.httpStatus, 200);
  assert.deepEqual(preview, backendPreviewJson);
});

class FakeElement {
  constructor() {
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.value = '';
    this.dataset = {};
    this.style = {};
    this.attributes = {};
    this.listeners = new Map();
    const classNames = new Set();
    this.classList = {
      add(...names) { names.forEach((name) => classNames.add(name)); },
      remove(...names) { names.forEach((name) => classNames.delete(name)); },
      toggle(name, force) {
        if (force) classNames.add(name);
        else classNames.delete(name);
        return classNames.has(name);
      },
      contains(name) { return classNames.has(name); }
    };
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }
}

function createDialogHarness(preview = backendPreviewJson) {
  const ids = [
    'cancel-modal', 'btn-close-modal', 'btn-keep-court', 'btn-confirm-cancel',
    'btn-confirm-cancel-label', 'selectCancelReason', 'cancel-dialog-message',
    'displayModalOrderId', 'displayModalVenueName', 'displayModalCourtNumber',
    'displayModalMatchTime', 'displayModalMatchDate', 'displayModalPaidAmount',
    'displayModalRefundPercentBadge', 'displayModalRefundPolicyDesc',
    'displayModalRefundAmount', 'cancel-countdown-panel', 'cancel-countdown-value',
    'cancel-refund-progress-marker', 'cancel-refund-level-label',
    'cancel-support', 'cancel-support-phone'
  ];
  const elements = new Map(ids.map((id) => [id, new FakeElement()]));
  const document = {
    body: new FakeElement(),
    documentElement: new FakeElement(),
    getElementById(id) { return elements.get(id); },
    addEventListener() {}
  };
  const booking = {
    booking_id: '42',
    booking_code: 'SPB-42',
    status: 'CONFIRMED',
    display_status_code: 'UPCOMING',
    slots: [{
      facility_id: '7',
      facility_name: 'Sân thật',
      court_name: 'Sân số 2',
      service_date: '2026-11-10',
      starts_at: '20:00:00',
      ends_at: '21:00:00'
    }]
  };
  let cancelCalls = 0;
  const window = {
    SportBookingHistoryState: historyState,
    SportBookingApi: {
      async getBooking() { return booking; },
      async getRefundPreview() { return preview; },
      async getFacility() { return { facility: { hotline: '024 1234 5678' } }; },
      async cancelBooking() {
        cancelCalls++;
        return { status: 'CANCELLED', refunded_amount: '50000' };
      }
    },
    setInterval() { return 1; },
    clearInterval() {}
  };
  class TestDate extends Date {
    static now() { return Date.parse('2026-11-10T03:00:00.000Z'); }
  }
  vm.runInNewContext(dialogSource, { window, document, Date: TestDate });
  return {
    elements,
    document,
    cancelCalls: () => cancelCalls,
    dialog: window.SportBookingCancellationDialog.initialize()
  };
}

test('dialog displays the real 0% response and permits cancellation without refund', async () => {
  const harness = createDialogHarness();
  await harness.dialog.open('42');
  assert.equal(harness.elements.get('displayModalRefundAmount').textContent, '0 đ');
  assert.equal(harness.elements.get('displayModalPaidAmount').textContent, '100.000 đ');
  assert.equal(harness.elements.get('displayModalRefundPercentBadge').textContent, '0% Hoàn tiền');
  assert.equal(harness.elements.get('cancel-refund-level-label').textContent, 'Mức hoàn hiện tại: 0% · Không hoàn tiền');
  assert.equal(harness.elements.get('displayModalRefundPolicyDesc').textContent, backendPreviewJson.message);
  assert.equal(harness.elements.get('cancel-countdown-value').textContent, 'Còn khoảng 8 phút');
  assert.match(harness.elements.get('cancel-refund-progress-marker').style.left, /^([0-9.]+)%$/);
  assert.ok(Number.parseFloat(harness.elements.get('cancel-refund-progress-marker').style.left) < 33.333);
  assert.match(harness.elements.get('btn-confirm-cancel-label').textContent, /không hoàn tiền/i);
  assert.equal(harness.elements.get('btn-confirm-cancel').disabled, false);
  assert.equal(harness.cancelCalls(), 0);
  assert.equal(harness.document.body.classList.contains('cancel-dialog-open'), true);

  await harness.elements.get('btn-confirm-cancel').listeners.get('click')();
  assert.equal(harness.cancelCalls(), 1);
  assert.equal(harness.document.body.classList.contains('cancel-dialog-open'), false);
});

test('dialog displays 50% and 100% refund responses and maps their timeline tiers', async () => {
  const cases = [
    {
      preview: {
        refund_percent: 0,
        refund_amount: '0',
        paid_amount: '100000',
        hours_until_start: 5 + 20 / 60,
        message: 'Còn dưới 6 giờ trước giờ bắt đầu: không hoàn tiền.'
      },
      refund: '0 đ',
      countdown: 'Còn 5 giờ 20 phút',
      markerRange: [0, 33.332],
      level: 'Mức hoàn hiện tại: 0% · Không hoàn tiền'
    },
    {
      preview: {
        refund_percent: 50,
        refund_amount: '50000',
        paid_amount: '100000',
        hours_until_start: 10,
        message: 'Còn từ 6 giờ đến dưới 24 giờ trước giờ bắt đầu: hoàn 50% số tiền đã thanh toán.'
      },
      refund: '50.000 đ',
      countdown: 'Còn 10 giờ',
      markerRange: [33.333, 66.667],
      level: 'Mức hoàn hiện tại: Hoàn 50%'
    },
    {
      preview: {
        refund_percent: 100,
        refund_amount: '100000',
        paid_amount: '100000',
        hours_until_start: 26,
        message: 'Còn từ 24 giờ trở lên trước giờ bắt đầu: hoàn 100% số tiền đã thanh toán.'
      },
      refund: '100.000 đ',
      countdown: 'Còn 26 giờ',
      markerRange: [66.667, 100],
      level: 'Mức hoàn hiện tại: Hoàn 100%'
    }
  ];

  for (const { preview, refund, countdown, markerRange, level } of cases) {
    const harness = createDialogHarness(preview);
    await harness.dialog.open('42');
    assert.equal(harness.elements.get('displayModalRefundAmount').textContent, refund);
    assert.equal(harness.elements.get('displayModalRefundPercentBadge').textContent, `${preview.refund_percent}% Hoàn tiền`);
    assert.equal(harness.elements.get('cancel-refund-level-label').textContent, level);
    assert.equal(harness.elements.get('displayModalRefundPolicyDesc').textContent, preview.message);
    assert.equal(harness.elements.get('cancel-countdown-value').textContent, countdown);
    const marker = Number.parseFloat(harness.elements.get('cancel-refund-progress-marker').style.left);
    assert.ok(marker >= markerRange[0] && marker <= markerRange[1]);
    assert.equal(harness.elements.get('btn-confirm-cancel').disabled, false);
  }
});

test('invalid required preview fields include HTTP status and the field name', async () => {
  const invalidPreview = {
    ...backendPreviewJson,
    refund_amount: 0
  };
  Object.defineProperty(invalidPreview, 'httpStatus', { value: 206 });
  const harness = createDialogHarness(invalidPreview);
  await harness.dialog.open('42');
  assert.match(harness.elements.get('cancel-dialog-message').textContent, /HTTP 206/);
  assert.match(harness.elements.get('cancel-dialog-message').textContent, /refund_amount/);
  assert.equal(harness.elements.get('btn-confirm-cancel').disabled, true);
});

test('detail cancellation dialog keeps its title and actions fixed while the body scrolls', () => {
  const headerStart = html.indexOf('class="cancel-dialog-header');
  const bodyStart = html.indexOf('class="cancel-dialog-body');
  const actionsStart = html.indexOf('class="cancel-dialog-actions');
  const titleStart = html.indexOf('id="modal-title"');
  const keepButtonStart = html.indexOf('id="btn-keep-court"');
  const confirmButtonStart = html.indexOf('id="btn-confirm-cancel"');

  assert.ok(html.includes('<link rel="stylesheet" href="/booking/booking.css">'));
  assert.ok(headerStart >= 0 && titleStart > headerStart && titleStart < bodyStart);
  assert.ok(bodyStart > headerStart && bodyStart < actionsStart);
  assert.ok(keepButtonStart > actionsStart && confirmButtonStart > actionsStart);
  assert.match(css, /\.cancel-dialog-panel\s*\{[^}]*max-height:\s*calc\(100vh - 2rem\)[^}]*overflow:\s*hidden/s);
  assert.match(css, /\.cancel-dialog-body\s*\{[^}]*overflow-y:\s*auto/s);

  const headerZIndex = Number(/\.sb-shared-header\s*\{[^}]*z-index:\s*(\d+)/s.exec(
    fs.readFileSync(path.join(root, 'frontend', 'shared', 'header.css'), 'utf8')
  )[1]);
  const dialogZIndex = Number(/#cancel-modal\s*\{[^}]*z-index:\s*(\d+)/s.exec(css)[1]);
  assert.ok(dialogZIndex > headerZIndex);
  assert.match(css, /@media \(max-width: 640px\)\s*\{[\s\S]*?\.cancel-dialog-actions\s*\{\s*flex-direction:\s*column;/);
});
