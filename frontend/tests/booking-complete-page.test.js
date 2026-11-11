'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const TicketData = require('../booking/ticket-data.js');
const BackNav = require('../shared/back-nav.js');

const frontendRoot = path.resolve(__dirname, '..');
const pageSource = fs.readFileSync(
  path.join(frontendRoot, 'booking', 'booking-complete-page.js'),
  'utf8'
);
const pageHtml = fs.readFileSync(path.join(frontendRoot, 'dat-san-thanh-cong.html'), 'utf8');

const booking = {
  booking_id: '42',
  booking_code: 'SPB-20261120-ABCDE2',
  status: 'CONFIRMED',
  display_status_code: 'UPCOMING',
  total_amount: '300000',
  amount_due_at_venue: '150000',
  payment: { paid_amount: '150000' },
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
    this.textContent = '';
    this.innerHTML = '';
    this.href = '';
    this.attributes = {};
    this.listeners = new Map();
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }
}

function createPageHarness(bookingResult = booking) {
  const elements = new Map();
  const main = new FakeElement('main');
  main.hidden = true;
  for (const match of pageHtml.matchAll(/\bid="([^"]+)"/g)) {
    elements.set(match[1], new FakeElement(match[1]));
  }
  elements.get('ticketLoading').hidden = false;
  elements.get('ticketError').hidden = true;
  elements.get('bookingQrPanel').hidden = true;
  elements.get('ticketQrLink').hidden = true;
  elements.get('openTicket').hidden = true;
  const qrPayloads = [];
  const redirects = [];
  const location = {
    search: '?booking_id=42',
    pathname: '/dat-san-thanh-cong.html',
    hash: '',
    origin: 'https://sportbooking.test',
    assign(url) { redirects.push(url); }
  };
  const window = {
    location,
    SportBookingApi: {
      async getBooking() { return bookingResult; },
      async getCurrentUser() { return { user: { fullName: 'Người đặt thật', email: 'user@example.test' } }; },
      async getFacility() { return { facility: { name: 'Cơ sở thật', address: 'Địa chỉ thật' } }; }
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
    getElementById(id) { return elements.get(id) || null; },
    querySelector(selector) { return selector === 'main' ? main : null; }
  };
  vm.runInContext(pageSource, vm.createContext({
    window,
    document,
    URL,
    URLSearchParams,
    Promise,
    Intl,
    BigInt,
    Date,
    Error,
    encodeURIComponent
  }), { filename: 'booking-complete-page.js' });

  async function waitForPage() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!main.hidden || redirects.length) return;
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail('Booking completion page remained in loading state.');
  }

  return { elements, main, qrPayloads, redirects, waitForPage };
}

test('confirmed completion displays one shared text QR and places actions in order', async () => {
  const page = createPageHarness();
  await page.waitForPage();

  assert.equal(page.qrPayloads.length, 1);
  assert.equal(page.qrPayloads[0], TicketData.buildQrPayload(booking));
  assert.equal(page.qrPayloads[0], [
    'SPORTBOOKING',
    'Mã đơn: SPB-20261120-ABCDE2',
    'Cơ sở: Cơ sở thật',
    'Ngày: 20/11/2026',
    'Giờ: 17:00-18:00'
  ].join('\n'));
  assert.equal(page.elements.get('bookingQrPanel').hidden, false);
  assert.equal(page.elements.get('ticketQrLink').href, page.elements.get('openTicket').href);
  assert.match(page.elements.get('openTicket').href, /^\/ve-dien-tu\.html\?booking_id=42&from=/);
  assert.equal(page.elements.get('bookingDetailLink').href,
    '/chi-tiet-don-dat-san.html?booking_id=42&from=%2Fdat-san-thanh-cong.html%3Fbooking_id%3D42');
  assert.deepEqual(page.redirects, []);
});

test('non-CONFIRMED completion does not draw a QR', async () => {
  const page = createPageHarness({ ...booking, status: 'COMPLETED' });
  await page.waitForPage();
  assert.deepEqual(page.qrPayloads, []);
  assert.equal(page.elements.get('bookingQrPanel').hidden, true);
});
