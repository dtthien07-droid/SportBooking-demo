'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const SportBookingFormat = require('../shared/format.js');
const SportBookingBackNav = require('../shared/back-nav.js');
const {
  buildTicketViewModel,
  decideTicketAction,
  formatMoney
} = require('../booking/ticket-data.js');

const frontendRoot = path.resolve(__dirname, '..');
const pageSource = fs.readFileSync(
  path.join(frontendRoot, 'booking', 'ticket-page.js'),
  'utf8'
);
const qrSource = fs.readFileSync(path.join(frontendRoot, 'assets', 'qr-code.js'), 'utf8');
const headerSource = fs.readFileSync(path.join(frontendRoot, 'shared', 'header.js'), 'utf8');
const headerCss = fs.readFileSync(path.join(frontendRoot, 'shared', 'header.css'), 'utf8');
const pageHtml = fs.readFileSync(path.join(frontendRoot, 'dat-san-thanh-cong.html'), 'utf8');

const booking = {
  booking_id: '42',
  booking_code: 'SPB-0123456789ABCDEF0123456789ABCDEF',
  status: 'CONFIRMED',
  total_amount: '300000',
  slots: [
    {
      facility_id: '8',
      facility_name: 'Cơ sở thật',
      court_name: 'Sân thật',
      service_date: '2026-11-20',
      starts_at: '17:00:00',
      ends_at: '18:00:00'
    },
    {
      facility_id: '8',
      facility_name: 'Cơ sở thật',
      court_name: 'Sân thật',
      service_date: '2026-11-20',
      starts_at: '18:00:00',
      ends_at: '19:00:00'
    }
  ]
};
const payments = {
  payment: {
    status: 'PAID',
    paid_amount: '150000',
    amount_due: '150000'
  },
  attempts: [],
  ticket: { qr_code: 'opaque-server-code' }
};
const facilityData = {
  facility: {
    name: 'Cơ sở thật',
    address: '12 Phố Mẫu, Hà Nội',
    hotline: '02412345678',
    map_url: 'https://maps.google.com/?q=12'
  }
};

class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.hidden = false;
    this.disabled = false;
    this.textContent = '';
    this.innerHTML = '';
    this.href = '';
    this.attributes = {};
    this.listeners = new Map();
    this.removedClasses = [];
    this.classList = {
      remove: (...names) => this.removedClasses.push(...names)
    };
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }
}

function createPageHarness({ bookingResult = booking, bookingError = null, search = '?booking_id=42' } = {}) {
  const elements = new Map();
  for (const match of pageHtml.matchAll(/\bid="([^"]+)"/g)) {
    elements.set(match[1], new FakeElement(match[1]));
  }
  elements.get('ticketLoading').hidden = false;
  elements.get('ticketError').hidden = true;
  const main = new FakeElement('main');
  main.hidden = true;
  const stepperMount = new FakeElement('stepper');
  const redirects = [];
  const calls = [];
  const window = {
    location: {
      search,
      origin: 'https://sportbooking.test',
      pathname: '/dat-san-thanh-cong.html',
      hash: '',
      replace(url) { redirects.push(url); }
    },
    SportBookingApi: {
      async getBooking(id) {
        calls.push(['booking', id]);
        if (bookingError) throw bookingError;
        return bookingResult;
      },
      async getPayments(id) {
        calls.push(['payments', id]);
        return payments;
      },
      async getFacility(id) {
        calls.push(['facility', id]);
        return facilityData;
      },
      async getCurrentUser() {
        calls.push(['user']);
        return { user: { fullName: 'Người đặt thật', phone: '0912345678', email: 'user@example.test' } };
      }
    },
    SportBookingTicketData: {
      buildTicketViewModel,
      decideTicketAction,
      formatMoney
    },
    SportBookingBackNav,
    SportBookingStepper: { render(mount, step) { mount.step = step; } },
    SportBookingFormat,
    SportBookingQRCode: { toSvg(payload) { return `<svg>${payload}</svg>`; } }
  };
  const document = {
    querySelector(selector) {
      if (selector === 'main') return main;
      if (selector === '[data-booking-stepper]') return stepperMount;
      return null;
    },
    querySelectorAll() { return []; },
    getElementById(id) { return elements.get(id) || null; },
    createElementNS() { throw new Error('No icons expected in the test document.'); }
  };
  const context = vm.createContext({
    window,
    document,
    navigator: { clipboard: { async writeText() {} } },
    URL,
    URLSearchParams,
    Intl,
    BigInt,
    Date,
    Error,
    TypeError,
    encodeURIComponent,
    console
  });
  vm.runInContext(pageSource, context, { filename: 'ticket-page.js' });

  async function waitForPage() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (main.hidden === false || elements.get('ticketError').hidden === false
          || redirects.length > 0) return;
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail('Ticket page did not leave its loading state.');
  }

  return { elements, main, stepperMount, redirects, calls, window, waitForPage };
}

test('builds a complete confirmed ticket from booking and payment API fields', () => {
  const model = buildTicketViewModel(booking, payments, facilityData);

  assert.equal(model.bookingCode, booking.booking_code);
  assert.equal(model.facilityName, 'Cơ sở thật');
  assert.equal(model.courtName, 'Sân thật');
  assert.equal(model.date.iso, '2026-11-20');
  assert.deepEqual(model.slotLabels, ['17:00 - 18:00', '18:00 - 19:00']);
  assert.equal(model.totalAmount, '300000');
  assert.equal(model.paidAmount, '150000');
  assert.equal(model.venueAmount, '150000');
  assert.equal(model.hotline, '02412345678');

  const qr = JSON.parse(model.qrPayload);
  assert.equal(qr.booking_code, booking.booking_code);
  assert.equal(qr.facility, 'Cơ sở thật');
  assert.equal(qr.court, 'Sân thật');
  assert.equal(qr.date, '2026-11-20');
  assert.deepEqual(qr.slots, ['17:00 - 18:00', '18:00 - 19:00']);
  assert.equal(qr.paid_amount, '150000');
  assert.equal(qr.amount_due_at_venue, '150000');
  assert.equal(qr.hotline, '02412345678');
});

test('draws the complete ticket payload in a local QR SVG', () => {
  const model = buildTicketViewModel(booking, payments, facilityData);
  const context = vm.createContext({ window: {}, TextEncoder });
  vm.runInContext(qrSource, context, { filename: 'qr-code.js' });
  const svg = context.window.SportBookingQRCode.toSvg(model.qrPayload);

  assert.match(svg, /viewBox="0 0 85 85"/);
  assert.match(svg, /aria-label="QR vé đặt sân"/);
  assert.throws(
    () => context.window.SportBookingQRCode.toSvg('x'.repeat(521)),
    /capacity/
  );
});

test('uses inline SVG icons and enables implemented booking links', () => {
  assert.doesNotMatch(pageHtml, /Material\+Symbols/);
  assert.match(headerSource, /createElementNS\('http:\/\/www\.w3\.org\/2000\/svg', 'svg'\)/);
  assert.doesNotMatch(headerCss, /Material Symbols Outlined/);
  assert.match(pageHtml, /href="\/lich-su-dat-san\.html"/);
  assert.match(pageHtml, /id="bookingDetailLink"/);
  assert.match(pageHtml, /Xem chi tiết đơn này/);
  assert.match(pageHtml, /disabled aria-disabled="true"/);
});

test('routes 401 to login and treats 403/404 as missing bookings', () => {
  assert.deepEqual(
    decideTicketAction({ bookingId: '42', error: { status: 401 } }),
    { action: 'login' }
  );
  for (const status of [403, 404]) {
    assert.deepEqual(
      decideTicketAction({ bookingId: '42', error: { status } }),
      { action: 'not-found' }
    );
  }
});

test('redirects PENDING bookings to payment and rejects a missing booking ID', () => {
  assert.deepEqual(
    decideTicketAction({ bookingId: '42', booking: { status: 'PENDING' } }),
    { action: 'payment', bookingId: '42' }
  );
  assert.deepEqual(
    decideTicketAction({ booking: { status: 'CONFIRMED' } }),
    { action: 'error', message: 'Thiếu mã đơn đặt sân.' }
  );
});

test('renders all confirmed fields without a ReferenceError', async () => {
  const page = createPageHarness();
  await page.waitForPage();

  assert.equal(page.main.hidden, false, page.elements.get('ticketErrorMessage').textContent);
  assert.equal(page.elements.get('ticketError').hidden, true);
  assert.equal(page.elements.get('bookingIdText').textContent, `#${booking.booking_code}`);
  assert.equal(page.elements.get('ticketFacilityName').textContent, 'Cơ sở thật');
  assert.equal(page.elements.get('ticketCourtName').textContent, 'Sân thật');
  assert.equal(page.elements.get('ticketAddress').textContent, '12 Phố Mẫu, Hà Nội');
  assert.equal(page.elements.get('displayMatchSlot').textContent, '17:00 - 18:00, 18:00 - 19:00');
  assert.equal(page.elements.get('ticketPaidAmount').textContent, '150.000 đ');
  assert.equal(page.elements.get('ticketVenueAmount').textContent, '150.000 đ');
  assert.equal(
    page.elements.get('bookingDetailLink').href,
    '/chi-tiet-don-dat-san.html?booking_id=42&from=%2Fdat-san-thanh-cong.html%3Fbooking_id%3D42'
  );
  assert.equal(page.elements.get('bookingDetailLink').attributes['aria-disabled'], undefined);
  assert.match(page.elements.get('bookingQr').innerHTML, /02412345678/);
  assert.equal(page.elements.get('ticketMapLink').href, 'https://maps.google.com/?q=12');
});

test('shows recoverable error states for 403 and 404 responses', async () => {
  for (const status of [403, 404]) {
    const error = new Error('not found');
    error.status = status;
    const page = createPageHarness({ bookingError: error });
    await page.waitForPage();
    assert.equal(page.elements.get('ticketError').hidden, false);
    assert.match(page.elements.get('ticketErrorMessage').textContent, /Không tìm thấy/i, `status ${status}`);
  }
});

test('redirects 401 and PENDING orders, and shows retry for a missing ID', async () => {
  const unauthorized = new Error('unauthorized');
  unauthorized.status = 401;
  const loginPage = createPageHarness({ bookingError: unauthorized });
  await loginPage.waitForPage();
  assert.equal(loginPage.redirects[0], '/dang-nhap.html?returnTo=%2Fdat-san-thanh-cong.html%3Fbooking_id%3D42');

  const pendingPage = createPageHarness({ bookingResult: { ...booking, status: 'PENDING' } });
  await pendingPage.waitForPage();
  assert.equal(pendingPage.redirects[0], '/thanh-toan.html?booking_id=42');

  const missingPage = createPageHarness({ search: '' });
  await missingPage.waitForPage();
  assert.equal(missingPage.elements.get('ticketError').hidden, false);
  assert.equal(missingPage.elements.get('ticketErrorMessage').textContent, 'Thiếu mã đơn đặt sân.');
  assert.equal(missingPage.elements.get('ticketRetry').hidden, false);
  assert.deepEqual(missingPage.calls, []);
});
