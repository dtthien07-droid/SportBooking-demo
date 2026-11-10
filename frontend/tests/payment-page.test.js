'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const stepper = require('../shared/stepper');
const SportBookingFormat = require('../shared/format.js');

const frontendRoot = path.resolve(__dirname, '..');
const pageSource = fs.readFileSync(
  path.join(frontendRoot, 'booking', 'payment-page.js'),
  'utf8'
);
const pageHtml = fs.readFileSync(path.join(frontendRoot, 'thanh-toan.html'), 'utf8');

class FakeElement {
  constructor(id = '') {
    this.id = id;
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.textContent = '';
    this.dataset = {};
    this.attributes = {};
    this.listeners = new Map();
    this.classList = {
      toggle() {},
      add() {},
      remove() {}
    };
    this.src = '';
    this.href = '';
    this.value = '';
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  async dispatch(type, event = {}) {
    for (const handler of this.listeners.get(type) || []) {
      await handler({ preventDefault() {}, ...event });
    }
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  closest(selector) {
    return selector === 'label' ? this.label : null;
  }

  replaceChildren(...children) {
    this.children = children;
  }

  insertAdjacentHTML(position, html) {
    this.insertedHtml = { position, html };
  }
}

const pendingBooking = {
  booking_id: '42',
  booking_code: 'SPB-0123456789ABCDEF0123456789ABCDEF',
  status: 'PENDING',
  total_amount: '300000',
  payment: {
    status: 'PENDING',
    payment_option: 'DEPOSIT_50',
    amount_due: '150000'
  },
  remaining_seconds: 420,
  slots: [
    {
      facility_id: '8',
      facility_name: 'Cơ sở thật',
      court_id: '9',
      time_slot_id: '101',
      court_name: 'Sân thật',
      sport_type: 'BADMINTON',
      service_date: '2026-11-20',
      starts_at: '17:00:00',
      ends_at: '18:00:00'
    },
    {
      facility_id: '8',
      facility_name: 'Cơ sở thật',
      court_id: '9',
      time_slot_id: '102',
      court_name: 'Sân thật',
      sport_type: 'BADMINTON',
      service_date: '2026-11-20',
      starts_at: '18:00:00',
      ends_at: '19:00:00'
    }
  ]
};

function createHarness({ attemptError = null, attemptResult = {}, initialBooking = pendingBooking } = {}) {
  const elements = new Map();
  const stepperMount = new FakeElement('stepper');
  for (const [tag] of pageHtml.matchAll(/<[^>]*\bid="[^"]+"[^>]*>/g)) {
    const id = tag.match(/\bid="([^"]+)"/)[1];
    const element = new FakeElement(id);
    element.hidden = /\shidden(?:\s|=|>)/.test(tag);
    elements.set(id, element);
  }
  const methods = ['BANK_TRANSFER', 'MOMO', 'DOMESTIC_ATM', 'INTERNATIONAL_CARD'].map((value) => {
    const radio = new FakeElement(`method-${value}`);
    radio.value = value;
    radio.checked = value === 'BANK_TRANSFER';
    radio.label = new FakeElement(`label-${value}`);
    return radio;
  });
  const calls = [];
  const redirects = [];
  const replacements = [];
  const assignments = [];
  let bookingReads = 0;
  const api = {
    async getBooking() {
      bookingReads += 1;
      if (bookingReads > 1 && attemptError?.status === 409) {
        return { ...pendingBooking, status: 'CONFIRMED', payment: { ...pendingBooking.payment, status: 'PAID' } };
      }
      return initialBooking;
    },
    async getPayments() {
      return { payment: { amount_due: '150000' } };
    },
    async getCurrentUser() {
      return { user: { fullName: 'Người đặt thật', phone: '0912345678' } };
    },
    async getFacility() {
      return {
        facility: { name: 'Cơ sở thật', image_url: null, hotline: '' },
        courts: [{ id: '9', sport_type: 'BADMINTON', name: 'Sân thật' }]
      };
    },
    async createPaymentAttempt(id, method, result) {
      calls.push({ id, method, result });
      if (attemptError?.status === 401) {
        redirects.push('/dang-nhap.html?returnTo=%2Fthanh-toan.html%3Fbooking_id%3D42');
        return null;
      }
      if (attemptError) throw attemptError;
      return attemptResult;
    }
  };
  const window = {
    location: {
      search: '?booking_id=42',
      origin: 'https://sportbooking.test',
      pathname: '/thanh-toan.html',
      assign(url) { assignments.push(url); redirects.push(url); },
      replace(url) { replacements.push(url); redirects.push(url); }
    },
    SportBookingApi: api,
    SportBookingFormat,
    SportBookingPaymentData: {
      buildPaymentAttemptPayload: (method, result) => ({ method, simulation_result: result }),
      buildTransferQrPayload: (code, amount) => `SPORTBOOKING|${code}|${amount}`
    },
    SportBookingQRCode: {
      toSvg: (payload) => `<svg>${payload}</svg>`
    },
    SportBookingStepper: stepper,
    setInterval() { return 1; },
    clearInterval() {},
    setTimeout,
    clearTimeout
  };
  const document = {
    body: { dataset: {} },
    getElementById(id) { return elements.get(id) || null; },
    querySelector(selector) {
      return selector === '[data-booking-stepper]' ? stepperMount : null;
    },
    querySelectorAll(selector) {
      return selector === 'input[name="payment_method"]' ? methods : [];
    }
  };
  const context = vm.createContext({
    window,
    document,
    URL,
    URLSearchParams,
    Intl,
    BigInt,
    Date,
    console
  });
  vm.runInContext(pageSource, context, { filename: 'payment-page.js' });

  async function waitForLoad() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (elements.get('paymentLoading').hidden
          || elements.get('paymentError').hidden === false
          || replacements.length > 0) return;
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.fail('Payment page did not finish loading.');
  }

  return { elements, methods, calls, redirects, replacements, assignments, waitForLoad, stepperMount };
}

test('loads flat PENDING booking data and renders every real booking field', async () => {
  const page = createHarness();
  await page.waitForLoad();

  assert.equal(page.elements.get('paymentError').hidden, true);
  assert.equal(page.elements.get('paymentContent').hidden, false);
  assert.equal(page.elements.get('displaySidebarOrderId').textContent, `#${pendingBooking.booking_code}`);
  assert.equal(page.elements.get('displaySidebarTimeSlot').textContent, '17:00 - 18:00, 18:00 - 19:00');
  assert.equal(page.elements.get('displaySidebarCourtPrice').textContent, '300.000 đ');
  assert.equal(page.elements.get('displaySidebarRemainingPrice').textContent, '150.000 đ');
  assert.equal(page.elements.get('displaySidebarDepositPrice').textContent, '150.000 đ');
  assert.equal(page.elements.get('displaySidebarUser').textContent, 'Người đặt thật (*******678)');
  assert.equal(page.elements.get('paymentStep1Back').href, '/dat-san.html?facility_id=8&court_id=9&date=2026-11-20&slots=101%2C102');
  assert.match(page.stepperMount.innerHTML, /href="\/dat-san\.html\?facility_id=8&amp;court_id=9&amp;date=2026-11-20&amp;slots=101%2C102"/);
  assert.match(page.elements.get('transferQr').insertedHtml.html, /SPORTBOOKING\|SPB-0123456789ABCDEF0123456789ABCDEF\|150000/);
});

test('selects each payment method and submits SUCCESS', async (t) => {
  for (const method of ['BANK_TRANSFER', 'MOMO', 'DOMESTIC_ATM', 'INTERNATIONAL_CARD']) {
    await t.test(method, async () => {
      const page = createHarness();
      await page.waitForLoad();
      page.methods.forEach((radio) => { radio.checked = radio.value === method; });
      await page.methods.find((radio) => radio.value === method).dispatch('change');
      assert.equal(page.elements.get('bankTransferDetails').hidden, method !== 'BANK_TRANSFER');
      await page.elements.get('btn-submit-payment').dispatch('click');
      assert.deepEqual(page.calls, [{ id: '42', method, result: 'SUCCESS' }]);
      assert.deepEqual(page.redirects, ['/dat-san-thanh-cong.html?booking_id=42']);
      assert.deepEqual(page.replacements, ['/dat-san-thanh-cong.html?booking_id=42']);
    });
  }
});

test('409 reads current booking and redirects only when it is confirmed', async () => {
  const page = createHarness({ attemptError: { status: 409 } });
  await page.waitForLoad();
  await page.elements.get('btn-submit-payment').dispatch('click');
  assert.deepEqual(page.redirects, ['/dat-san-thanh-cong.html?booking_id=42']);
  assert.deepEqual(page.replacements, ['/dat-san-thanh-cong.html?booking_id=42']);
});

test('replaces payment history with the ticket when the booking is already confirmed', async () => {
  const page = createHarness({
    initialBooking: { ...pendingBooking, status: 'CONFIRMED' }
  });
  await page.waitForLoad();
  assert.deepEqual(page.redirects, ['/dat-san-thanh-cong.html?booking_id=42']);
  assert.deepEqual(page.replacements, ['/dat-san-thanh-cong.html?booking_id=42']);
});

test('410 marks the hold expired and disables another payment attempt', async () => {
  const page = createHarness({ attemptError: { status: 410 } });
  await page.waitForLoad();
  await page.elements.get('btn-submit-payment').dispatch('click');
  assert.match(page.elements.get('paymentMessage').textContent, /hết/i);
  assert.equal(page.elements.get('btn-submit-payment').disabled, true);
  assert.deepEqual(page.redirects, []);
});

test('401 redirects to login and does not continue payment', async () => {
  const page = createHarness({ attemptError: { status: 401 } });
  await page.waitForLoad();
  await page.elements.get('btn-submit-payment').dispatch('click');
  assert.deepEqual(page.redirects, [
    '/dang-nhap.html?returnTo=%2Fthanh-toan.html%3Fbooking_id%3D42'
  ]);
  assert.deepEqual(page.calls, [{ id: '42', method: 'BANK_TRANSFER', result: 'SUCCESS' }]);
});
