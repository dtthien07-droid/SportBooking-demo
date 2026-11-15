'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const { TextEncoder } = require('node:util');
const TicketData = require('../booking/ticket-data.js');
const BookingDetailState = require('../booking/booking-detail-state.js');
const BookingHistoryState = require('../booking/booking-history-state.js');
const BackNav = require('../shared/back-nav.js');

const frontendRoot = path.resolve(__dirname, '..');
const qrCodeSource = fs.readFileSync(path.join(frontendRoot, 'assets', 'qr-code.js'), 'utf8');
const qrCodeWindow = {};
vm.runInNewContext(qrCodeSource, { window: qrCodeWindow, TextEncoder });
const QRCode = qrCodeWindow.SportBookingQRCode;
const pageSource = fs.readFileSync(
  path.join(frontendRoot, 'booking', 'booking-detail-page.js'),
  'utf8'
);
const ticketPageSource = fs.readFileSync(
  path.join(frontendRoot, 'booking', 'ticket-page.js'),
  'utf8'
);
const detailHtml = fs.readFileSync(path.join(frontendRoot, 'chi-tiet-don-dat-san.html'), 'utf8');
const ticketDataSource = fs.readFileSync(path.join(frontendRoot, 'booking', 'ticket-data.js'), 'utf8');

function matrixFromSvg(svg) {
  const viewBox = /viewBox="0 0 (\d+) (\d+)"/.exec(svg);
  assert.ok(viewBox, 'QR SVG must include its view box.');
  const dimension = Number(viewBox[1]) - 8;
  const matrix = Array.from({ length: dimension }, () => new Array(dimension).fill(false));
  for (const [, xText, yText] of svg.matchAll(/M(\d+) (\d+)h1v1h-1z/g)) {
    const x = Number(xText) - 4;
    const y = Number(yText) - 4;
    matrix[y][x] = true;
  }
  return matrix;
}

function svgFromImage(image) {
  const prefix = 'data:image/svg+xml;charset=utf-8,';
  assert.ok(image.src.startsWith(prefix), 'QR image must contain the local SVG renderer output.');
  return decodeURIComponent(image.src.slice(prefix.length));
}

function findHtmlFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findHtmlFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.html') ? [entryPath] : [];
  });
}

function scriptSources(html) {
  return [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[1]);
}

function assertDependenciesBeforeConsumer(htmlPath, consumer, dependencies) {
  const sources = scriptSources(fs.readFileSync(htmlPath, 'utf8'));
  const consumerIndex = sources.indexOf(consumer);
  assert.notEqual(consumerIndex, -1, `${path.basename(htmlPath)} must load ${consumer}`);
  for (const dependency of dependencies) {
    const dependencyIndex = sources.indexOf(dependency);
    assert.notEqual(dependencyIndex, -1, `${path.basename(htmlPath)} must load ${dependency}`);
    assert.ok(
      dependencyIndex < consumerIndex,
      `${path.basename(htmlPath)} must load ${dependency} before ${consumer}`
    );
  }
}

const qrConsumers = [
  {
    script: '/booking/booking-detail-page.js',
    dependencies: ['/booking/ticket-data.js', '/assets/qr-code.js']
  },
  {
    script: '/booking/ticket-page.js',
    dependencies: ['/booking/ticket-data.js', '/assets/qr-code.js']
  },
  {
    script: '/booking/booking-complete-page.js',
    dependencies: ['/booking/ticket-data.js', '/assets/qr-code.js']
  },
  {
    script: '/booking/payment-page.js',
    dependencies: ['/booking/payment-data.js', '/assets/qr-code.js']
  }
];

const baseBooking = {
  booking_id: '61',
  booking_code: 'SPB-20261115-UN7J9R',
  status: 'CONFIRMED',
  display_status_code: 'UPCOMING',
  created_at: '2026-11-15T08:00:00.000Z',
  total_amount: '100000',
  amount_due_at_venue: '0',
  remaining_seconds: null,
  payment: {
    status: 'PAID',
    payment_option: 'FULL',
    amount_due: '100000',
    paid_amount: '100000',
    refunded_amount: '0'
  },
  ticket: { id: '12', qr_code: 'QR-TEST-61', created_at: '2026-11-15T08:00:00.000Z' },
  slots: [{
    facility_id: '8',
    facility_name: 'Cơ sở mẫu',
    court_id: '9',
    court_name: 'Sân 1',
    sport_type: 'BADMINTON',
    service_date: '2026-11-20',
    starts_at: '17:00:00',
    ends_at: '18:00:00'
  }]
};

class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.className = '';
    this.href = '';
    this.src = '';
    this.attributes = {};
    this.listeners = new Map();
    this.classNames = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => this.classNames.add(name)),
      remove: (...names) => names.forEach((name) => this.classNames.delete(name))
    };
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }
}

function createDetailHarness({
  booking = baseBooking,
  facilityData = {
    facility: {
      name: 'Cơ sở mẫu',
      description: 'Mô tả sân',
      address: 'Địa chỉ mẫu',
      hotline: '0964585433',
      map_url: null,
      image_url: null
    }
  },
  qrFailure = false,
  forceQrDependencies = false,
  bookingError = null
} = {}) {
  const elements = new Map();
  for (const match of detailHtml.matchAll(/\bid="([^"]+)"/g)) {
    elements.set(match[1], new FakeElement(match[1]));
  }
  const getElementById = (id) => {
    if (!elements.has(id)) elements.set(id, new FakeElement(id));
    return elements.get(id);
  };
  const qrPayloads = [];
  const retryMarkup = /<button\b[^>]*id="ticketQrRetry"[^>]*>([^<]*)<\/button>/.exec(detailHtml);
  if (retryMarkup) getElementById('ticketQrRetry').textContent = retryMarkup[1];
  getElementById('detail-loading').hidden = false;
  getElementById('detail-error').hidden = true;
  getElementById('booking-detail-content').hidden = true;
  const logs = [];
  const location = {
    search: '?booking_id=61',
    pathname: '/chi-tiet-don-dat-san.html',
    origin: 'https://sportbooking.test',
    hash: '',
    href: 'https://sportbooking.test/chi-tiet-don-dat-san.html?booking_id=61',
    assign() {},
    reload() {}
  };
  const scripts = scriptSources(detailHtml);
  const detailIndex = scripts.indexOf('/booking/booking-detail-page.js');
  const ticketDataIndex = scripts.indexOf('/booking/ticket-data.js');
  const qrRendererIndex = scripts.indexOf('/assets/qr-code.js');
  const hasTicketData = forceQrDependencies
    || (ticketDataIndex >= 0 && ticketDataIndex < detailIndex);
  const hasQrRenderer = forceQrDependencies
    || (qrRendererIndex >= 0 && qrRendererIndex < detailIndex);
  const ticketData = qrFailure
    ? { ...TicketData, buildQrPayload() { throw new Error('QR renderer failed: internal detail'); } }
    : TicketData;
  const window = {
    location,
    SportBookingApi: {
      async getBooking() {
        if (bookingError) throw bookingError;
        return booking;
      },
      async getFacility() {
        return facilityData;
      }
    },
    SportBookingHistoryState: BookingHistoryState,
    SportBookingDetailState: BookingDetailState,
    SportBookingBackNav: BackNav,
    SportBookingFormat: { formatVietnamDateTime: () => '15/11/2026 15:00' },
    SportBookingIcons: { setIcon() {} },
    SportBookingCancellationDialog: { initialize: () => ({ open() {} }) },
    clearInterval() {},
    setInterval() { return 1; }
  };
  if (hasTicketData) window.SportBookingTicketData = ticketData;
  if (hasQrRenderer) {
    window.SportBookingQRCode = {
      toSvg(payload) {
        if (qrFailure) throw new Error('QR SVG failed: internal detail');
        qrPayloads.push(payload);
        return QRCode.toSvg(payload);
      }
    };
  }
  const document = {
    referrer: '',
    getElementById,
    querySelectorAll: () => []
  };
  const context = vm.createContext({
    window,
    document,
    URL,
    URLSearchParams,
    Promise,
    Intl,
    BigInt,
    Date,
    Error,
    TypeError,
    encodeURIComponent,
    console: { error: (...args) => logs.push(args) }
  });
  vm.runInContext(pageSource, context, { filename: 'booking-detail-page.js' });

  return new Promise((resolve) => {
    setImmediate(() => resolve({ elements, logs, qrPayloads }));
  });
}

test('all HTML QR consumers load the correct modules before use with matching globals', () => {
  for (const htmlPath of findHtmlFiles(frontendRoot)) {
    const sources = scriptSources(fs.readFileSync(htmlPath, 'utf8'));
    for (const consumer of qrConsumers) {
      if (sources.includes(consumer.script)) {
        assertDependenciesBeforeConsumer(htmlPath, consumer.script, consumer.dependencies);
      }
    }
  }
  assert.match(ticketDataSource, /root\.SportBookingTicketData\s*=\s*api/);
  assert.match(ticketDataSource, /return\s*\{\s*buildQrPayload,/);
  assert.match(
    pageSource,
    /window\.SportBookingTicketData\.buildTicketQrPayload\(booking, facilityData\)/
  );
  assert.match(ticketDataSource, /const qrPayload = buildTicketQrPayload\(booking, facilityData\)/);
  assert.match(ticketPageSource, /ticketData\.buildTicketViewModel\(booking, userData, facilityData\)/);
  assert.match(pageSource, /window\.SportBookingQRCode\.toSvg\(payload\)/);
  assert.match(ticketPageSource, /window\.SportBookingQRCode\.toSvg\(model\.qrPayload\)/);
});

test('detail page renders upcoming tickets and all booking states without hiding details', async () => {
  const records = [
    baseBooking,
    { ...baseBooking, status: 'CANCELLED', display_status_code: 'CANCELLED', ticket: null },
    { ...baseBooking, status: 'COMPLETED', display_status_code: 'COMPLETED', ticket: null },
    {
      ...baseBooking,
      status: 'PENDING',
      display_status_code: 'PENDING',
      remaining_seconds: 120,
      payment: { ...baseBooking.payment, status: 'PENDING' },
      ticket: null
    },
    { ...baseBooking, status: 'EXPIRED', display_status_code: 'EXPIRED', ticket: null },
    { ...baseBooking, display_status_code: 'IN_PROGRESS' }
  ];

  for (const booking of records) {
    const page = await createDetailHarness({ booking });
    assert.equal(page.elements.get('booking-detail-content').hidden, false, booking.status);
    assert.equal(page.elements.get('detail-error').hidden, true, booking.status);
    assert.equal(page.elements.get('pageTitleOrderId').textContent, `Đơn đặt sân ${booking.booking_code}`);
    assert.equal(page.elements.get('venueName').textContent, 'Cơ sở mẫu');
    assert.equal(page.elements.get('displayMatchTime').textContent, '17:00 – 18:00');
    assert.equal(page.elements.get('paymentStatusSubtext').textContent.length > 0, true);
  }
});

test('detail QR payload and every rendered module match the electronic ticket', async () => {
  const booking = {
    ...baseBooking,
    slots: [{ ...baseBooking.slots[0], facility_name: 'Tên cơ sở cũ trong đơn' }]
  };
  const facilityData = {
    facility: {
      name: 'Tên cơ sở hiện tại từ API',
      address: 'Địa chỉ mẫu'
    }
  };
  const page = await createDetailHarness({ booking, facilityData });
  const ticketModel = TicketData.buildTicketViewModel(
    booking,
    { user: { fullName: 'Người đặt', phone: '0900123456' } },
    facilityData
  );
  const detailSvg = svgFromImage(page.elements.get('qrCodeImage'));
  const ticketSvg = QRCode.toSvg(ticketModel.qrPayload);

  assert.equal(page.qrPayloads[0], ticketModel.qrPayload);
  assert.deepEqual(matrixFromSvg(detailSvg), matrixFromSvg(ticketSvg));
  assert.equal(detailSvg, ticketSvg);
});

test('detail ticket block shows only the QR and preserves its labels and instruction', async () => {
  const page = await createDetailHarness();
  const qrMarkupStart = detailHtml.indexOf('id="ticketQrContent"');
  const qrMarkupEnd = detailHtml.indexOf('id="ticketStateMessage"', qrMarkupStart);
  const qrMarkup = detailHtml.slice(qrMarkupStart, qrMarkupEnd);

  assert.doesNotMatch(qrMarkup, />\s*Mã vé\s*</i);
  assert.doesNotMatch(qrMarkup, /displayTicketCode|displayCheckinCode|content_copy/i);
  assert.doesNotMatch(pageSource, /ticketCode|booking\.ticket\.qr_code/);
  assert.equal(page.elements.has('displayTicketCode'), false);
  assert.match(
    qrMarkup,
    /<img\b[^>]*alt="Mã QR vé điện tử"[^>]*aria-label="Mã QR vé điện tử"/
  );
  assert.equal(page.elements.get('ticketStatusLabel').textContent, 'ĐÃ PHÁT HÀNH');
  assert.equal(
    page.elements.get('qrSubText').textContent,
    'Mã QR vé điện tử.',
    JSON.stringify(page.logs)
  );
  assert.match(qrMarkup, /Xuất trình vé điện tử cho nhân viên sân\./);
});

test('QR failure keeps booking detail visible and gives a Vietnamese retry in the ticket block', async () => {
  const page = await createDetailHarness({ qrFailure: true, forceQrDependencies: true });
  const ticketMessage = 'Không thể hiển thị mã QR lúc này. Vui lòng tải lại trang.';
  const userMessages = [
    page.elements.get('qrSubText').textContent,
    page.elements.get('detail-error-title').textContent,
    page.elements.get('detail-error-message').textContent
  ].join(' ');

  assert.equal(page.elements.get('booking-detail-content').hidden, false);
  assert.equal(page.elements.get('detail-error').hidden, true);
  assert.equal(page.elements.get('qrSubText').textContent, ticketMessage);
  assert.equal(page.elements.get('ticketQrRetry').textContent, 'Thử lại');
  assert.equal(page.elements.get('ticketQrRetry').hidden, false);
  assert.doesNotMatch(userMessages, /Cannot|Error|buildQrPayload|internal detail/);
  assert.ok(page.logs.some((args) => String(args[0]).includes('Không thể tạo mã QR')));
  page.elements.get('ticketQrRetry').listeners.get('click')();
});

test('detail loading errors never expose their technical message', async () => {
  const page = await createDetailHarness({ bookingError: new TypeError('Cannot read secret internals') });
  const message = page.elements.get('detail-error-message').textContent;

  assert.equal(page.elements.get('detail-error').hidden, false);
  assert.equal(message, 'Không thể hiển thị thông tin đơn đặt sân. Vui lòng tải lại trang.');
  assert.doesNotMatch(message, /Cannot|secret internals|TypeError/);
  assert.ok(page.logs.some((args) => String(args[0]).includes('Không thể tải chi tiết đơn đặt sân')));
});

