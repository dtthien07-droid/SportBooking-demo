'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const TicketData = require('../booking/ticket-data.js');
const BackNav = require('../shared/back-nav.js');

const frontendRoot = path.resolve(__dirname, '..');
const pageSource = fs.readFileSync(path.join(frontendRoot, 'booking', 'ticket-page.js'), 'utf8');
const pageHtml = fs.readFileSync(path.join(frontendRoot, 've-dien-tu.html'), 'utf8');

const booking = {
  booking_id: '42',
  booking_code: 'SPB-20261120-ABCDE2',
  status: 'CONFIRMED',
  display_status_code: 'UPCOMING',
  slots: [{
    facility_id: '8',
    facility_name: 'Cơ sở thật',
    court_name: 'Sân số 1',
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
    this.innerHTML = '';
    this.href = '';
    this.attributes = {};
    this.listeners = new Map();
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

  querySelector() {
    return this.label;
  }
}

function createPageHarness({
  bookingResult = booking,
  bookingError = null,
  userData = { user: { fullName: 'Người đặt thật', phone: '0838123234' } },
  facilityData = { facility: { name: 'Cơ sở thật', address: 'Địa chỉ thật' } },
  facilityError = null,
  search = '?booking_id=42&from=%2Flich-su-dat-san.html'
} = {}) {
  const elements = new Map();
  for (const match of pageHtml.matchAll(/\bid="([^"]+)"/g)) {
    elements.set(match[1], new FakeElement(match[1]));
  }
  elements.get('ticketLoading').hidden = false;
  elements.get('ticketError').hidden = true;
  elements.get('ticketNotice').hidden = true;
  elements.get('ticketMain').hidden = true;
  const backButtons = [new FakeElement(), new FakeElement()];
  for (const button of backButtons) {
    button.label = new FakeElement('back-label');
  }
  const redirects = [];
  const calls = [];
  const qrPayloads = [];
  const location = {
    search,
    origin: 'https://sportbooking.test',
    pathname: '/ve-dien-tu.html',
    hash: '',
    assign(url) { redirects.push(url); }
  };
  const window = {
    location,
    SportBookingApi: {
      async getBooking(id) {
        calls.push(['booking', id]);
        if (bookingError) throw bookingError;
        return bookingResult;
      },
      async getCurrentUser() {
        calls.push(['user']);
        return userData;
      },
      async getFacility(id) {
        calls.push(['facility', id]);
        if (facilityError) throw facilityError;
        return facilityData;
      }
    },
    SportBookingTicketData: TicketData,
    SportBookingBackNav: BackNav,
    SportBookingQRCode: {
      toSvg(payload) {
        qrPayloads.push(payload);
        return '<svg aria-label="local qr"></svg>';
      }
    }
  };
  const document = {
    referrer: '',
    getElementById(id) { return elements.get(id) || null; },
    querySelectorAll(selector) { return selector === '[data-back-button]' ? backButtons : []; }
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
    encodeURIComponent
  });
  vm.runInContext(pageSource, context, { filename: 'ticket-page.js' });

  async function waitForPage() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!elements.get('ticketMain').hidden
          || !elements.get('ticketError').hidden
          || !elements.get('ticketNotice').hidden
          || redirects.length > 0) return;
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail('Ticket page remained in loading state.');
  }

  return { elements, backButtons, calls, redirects, qrPayloads, waitForPage, location };
}

test('loads API data and renders one local QR plus all ticket fields', async () => {
  const page = createPageHarness();
  await page.waitForPage();

  assert.equal(page.elements.get('ticketMain').hidden, false);
  assert.deepEqual(page.calls, [['booking', '42'], ['facility', '8'], ['user']]);
  assert.equal(page.elements.get('ticketStatusLabel').textContent, 'Sắp tới');
  assert.equal(page.elements.get('ticketBookingCode').textContent, booking.booking_code);
  assert.equal(page.elements.get('ticketBookerPhone').textContent, 'SĐT: 0838 *** 234');
  assert.equal(page.elements.get('ticketTimeRange').textContent, '17:00 - 18:00');
  assert.equal(page.elements.get('ticketMapLink').href, 'https://www.google.com/maps/search/?api=1&query=%C4%90%E1%BB%8Ba%20ch%E1%BB%89%20th%E1%BA%ADt');
  assert.equal(page.qrPayloads.length, 1);
  assert.deepEqual(JSON.parse(page.qrPayloads[0]), {
    booking_code: booking.booking_code,
    facility_name: 'Cơ sở thật',
    address: 'Địa chỉ thật'
  });
  assert.equal(page.backButtons[0].label.textContent, 'Quay lại lịch sử đặt sân');
});

test('renders when hotline and map URL are absent and uses address-search fallback', async () => {
  const page = createPageHarness({
    facilityData: { facility: { name: 'Cơ sở thật', address: 'Địa chỉ thật' } }
  });
  await page.waitForPage();
  assert.equal(page.elements.get('ticketMain').hidden, false);
  assert.equal(
    page.elements.get('ticketMapLink').href,
    'https://www.google.com/maps/search/?api=1&query=%C4%90%E1%BB%8Ba%20ch%E1%BB%89%20th%E1%BA%ADt'
  );
});

test('PENDING goes to payment and CANCELLED or EXPIRED never renders a QR', async () => {
  const pending = createPageHarness({
    bookingResult: { ...booking, status: 'PENDING' }
  });
  await pending.waitForPage();
  assert.deepEqual(pending.redirects, ['/thanh-toan.html?booking_id=42']);
  assert.deepEqual(pending.qrPayloads, []);

  for (const status of ['CANCELLED', 'EXPIRED']) {
    const page = createPageHarness({ bookingResult: { ...booking, status } });
    await page.waitForPage();
    assert.equal(page.elements.get('ticketNotice').hidden, false);
    assert.equal(page.elements.get('ticketMain').hidden, true);
    assert.deepEqual(page.qrPayloads, []);
  }
});

test('COMPLETED and IN_PROGRESS bookings render their display labels', async () => {
  for (const [status, displayStatus, label] of [
    ['CONFIRMED', 'IN_PROGRESS', 'Đang trong trận'],
    ['COMPLETED', 'COMPLETED', 'Hoàn thành']
  ]) {
    const page = createPageHarness({
      bookingResult: { ...booking, status, display_status_code: displayStatus }
    });
    await page.waitForPage();
    assert.equal(page.elements.get('ticketStatusLabel').textContent, label);
  }
});

test('401 redirects to login; 403 and 404 show not-found with retry', async () => {
  const unauthorized = new Error('Unauthorized');
  unauthorized.status = 401;
  const login = createPageHarness({ bookingError: unauthorized });
  await login.waitForPage();
  assert.equal(login.redirects[0], '/dang-nhap.html?returnTo=%2Fve-dien-tu.html%3Fbooking_id%3D42%26from%3D%252Flich-su-dat-san.html');

  for (const status of [403, 404]) {
    const error = new Error('Not found');
    error.status = status;
    const page = createPageHarness({ bookingError: error });
    await page.waitForPage();
    assert.equal(page.elements.get('ticketErrorMessage').textContent, 'Không tìm thấy đơn');
    assert.equal(page.elements.get('ticketRetry').hidden, false);
  }
});

test('the back button assigns the same validated dynamic target', async () => {
  const page = createPageHarness();
  await page.waitForPage();
  page.backButtons[1].listeners.get('click')();
  assert.deepEqual(page.redirects, ['/lich-su-dat-san.html']);
});
