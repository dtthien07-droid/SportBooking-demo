'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  buildQrPayload,
  buildTicketViewModel,
  decideTicketAction,
  formatMoney
} = require('../booking/ticket-data.js');
const {
  buildTicketUrl,
  backLabel,
  resolveBackTarget
} = require('../shared/back-nav.js');

const root = path.resolve(__dirname, '..');
const pageHtml = fs.readFileSync(path.join(root, 've-dien-tu.html'), 'utf8');
const completionHtml = fs.readFileSync(path.join(root, 'dat-san-thanh-cong.html'), 'utf8');
const mockupHtml = fs.readFileSync(
  path.resolve(root, '..', 'docs', '02-design', 'mockups', 've-dien-tu.html'),
  'utf8'
);

function createBooking(overrides = {}) {
  return {
    booking_id: '42',
    booking_code: 'SPB-20261120-ABCDE2',
    status: 'CONFIRMED',
    display_status_code: 'UPCOMING',
    total_amount: '300000',
    slots: [
      {
        facility_id: '8',
        facility_name: 'Cơ sở thật',
        court_name: 'Sân số 1',
        sport_type: 'BADMINTON',
        service_date: '2026-11-20',
        starts_at: '17:00:00',
        ends_at: '18:00:00'
      },
      {
        facility_id: '8',
        facility_name: 'Cơ sở thật',
        court_name: 'Sân số 1',
        sport_type: 'BADMINTON',
        service_date: '2026-11-20',
        starts_at: '18:00:00',
        ends_at: '19:00:00'
      }
    ],
    ...overrides
  };
}

const userData = {
  user: {
    fullName: 'Người đặt thật',
    phone: '0838123234',
    email: 'user@example.test'
  }
};

const facilityData = {
  facility: {
    name: 'Cơ sở thật',
    address: '12 Phố Mẫu, Hà Nội',
    hotline: '02412345678',
    map_url: 'https://maps.google.com/?q=12'
  }
};

test('builds the ticket from real booking fields and merges adjacent slots', () => {
  const model = buildTicketViewModel(createBooking(), userData, facilityData);

  assert.equal(model.bookingCode, 'SPB-20261120-ABCDE2');
  assert.equal(model.facilityName, 'Cơ sở thật');
  assert.equal(model.address, '12 Phố Mẫu, Hà Nội');
  assert.equal(model.courtName, 'Sân số 1');
  assert.equal(model.sportName, 'Cầu lông');
  assert.equal(model.date.label, '20/11/2026');
  assert.equal(model.date.weekday, 'Thứ Sáu');
  assert.equal(model.timeRange, '17:00 - 19:00');
  assert.equal(model.durationMinutes, 120);
  assert.equal(model.bookerName, 'Người đặt thật');
  assert.equal(model.maskedPhone, '0838 *** 234');
  assert.equal(model.statusLabel, 'Sắp tới');
  assert.equal(model.hotline, '02412345678');
  assert.equal(model.mapUrl, 'https://maps.google.com/?q=12');
  assert.equal(model.qrPayload, buildQrPayload({
    ...createBooking(),
    facility_name: 'Cơ sở thật'
  }));
  assert.equal(model.qrPayload, [
    'SPORTBOOKING',
    'Mã đơn: SPB-20261120-ABCDE2',
    'Cơ sở: Cơ sở thật',
    'Ngày: 20/11/2026',
    'Giờ: 17:00-19:00'
  ].join('\n'));
  assert.equal(model.qrPayload.split('\n')[1], `Mã đơn: ${createBooking().booking_code}`);
  assert.doesNotMatch(model.qrPayload, /http|geo:|12 Phố Mẫu|Hà Nội|Người đặt thật|0838|user@example/i);
});

test('QR payload omits private data and truncates facility name to 40 characters', () => {
  const booking = createBooking();
  booking.slots = booking.slots.map((slot) => ({ ...slot, court_name: '' }));
  booking.slots[0].facility_name = 'Cơ sở '.repeat(10);
  const payload = buildQrPayload(booking);
  assert.match(payload, /Cơ sở: .{39}…/);
  assert.doesNotMatch(payload, /Sân:|http|geo:|0838|Người đặt/i);
});

test('QR payload renders when facility name is missing', () => {
  const booking = createBooking();
  booking.facility_name = '';
  booking.facility = { name: '' };
  booking.slots = booking.slots.map((slot) => ({ ...slot, facility_name: '' }));
  assert.equal(buildQrPayload(booking).split('\n')[2], 'Cơ sở: —');
});

test('QR payload keeps separate ranges for non-adjacent slots', () => {
  const booking = createBooking();
  booking.slots = [
    { ...booking.slots[0], starts_at: '19:00:00', ends_at: '19:30:00' },
    { ...booking.slots[0], starts_at: '17:00:00', ends_at: '18:00:00' }
  ];
  assert.equal(buildQrPayload(booking).split('\n')[4], 'Giờ: 17:00-18:00, 19:00-19:30');
});

test('sums duration from slots and keeps separate ranges when slots are not adjacent', () => {
  const booking = createBooking();
  booking.slots = [
    { ...booking.slots[0], starts_at: '19:00:00', ends_at: '19:30:00' },
    { ...booking.slots[0], starts_at: '17:00:00', ends_at: '18:00:00' }
  ];
  const model = buildTicketViewModel(booking, userData, facilityData);
  assert.equal(model.timeRange, '17:00 - 18:00, 19:00 - 19:30');
  assert.equal(model.durationMinutes, 90);
});

test('missing hotline and map URL do not prevent ticket construction', () => {
  const model = buildTicketViewModel(createBooking(), userData, {
    facility: { name: 'Cơ sở thật', address: 'Địa chỉ thật' }
  });
  assert.equal(model.hotline, '');
  assert.equal(model.mapUrl, '');
  assert.equal(model.address, 'Địa chỉ thật');
  assert.equal(formatMoney('123456'), '123.456 đ');
});

test('builds a ticket URL with its source and resolves only allowed return targets', () => {
  const url = buildTicketUrl('42', '/chi-tiet-don-dat-san.html?booking_id=42');
  assert.equal(
    url,
    '/ve-dien-tu.html?booking_id=42&from=%2Fchi-tiet-don-dat-san.html%3Fbooking_id%3D42'
  );
  assert.equal(
    resolveBackTarget('?from=%2Fchi-tiet-don-dat-san.html%3Fbooking_id%3D42', '', 'https://sportbooking.test'),
    '/chi-tiet-don-dat-san.html?booking_id=42'
  );
  assert.equal(
    resolveBackTarget('?from=%2F%2Fevil.test', '', 'https://sportbooking.test'),
    '/lich-su-dat-san.html'
  );
  assert.equal(backLabel('/lich-su-dat-san.html?page=2'), 'Quay lại lịch sử đặt sân');
  assert.equal(backLabel('/dat-san-thanh-cong.html?booking_id=42'), 'Quay lại hoàn tất đặt lịch');
});

test('decides the correct action for all booking states', () => {
  assert.deepEqual(
    decideTicketAction({ bookingId: '42', booking: { status: 'PENDING' } }),
    { action: 'payment', bookingId: '42' }
  );
  for (const displayStatus of ['UPCOMING', 'IN_PROGRESS', 'COMPLETED']) {
    assert.deepEqual(
      decideTicketAction({
        bookingId: '42',
        booking: { status: displayStatus === 'COMPLETED' ? 'COMPLETED' : 'CONFIRMED', display_status_code: displayStatus }
      }),
      { action: 'render' }
    );
  }
  for (const status of ['CANCELLED', 'EXPIRED']) {
    assert.deepEqual(
      decideTicketAction({ bookingId: '42', booking: { status } }),
      { action: 'inactive' }
    );
  }
  for (const status of [403, 404]) {
    assert.deepEqual(
      decideTicketAction({ bookingId: '42', error: { status } }),
      { action: 'not-found' }
    );
  }
  assert.deepEqual(decideTicketAction({ bookingId: '42', error: { status: 401 } }), { action: 'login' });
});

test('uses the mockup ticket card classes without forbidden content or active PDF action', () => {
  assert.ok(mockupHtml.length > 0);
  for (const className of [
    'relative w-full bg-white rounded-3xl border border-slate-200/90 shadow-xl overflow-hidden flex flex-col lg:flex-row',
    'lg:w-[65%] p-6 sm:p-9 flex flex-col justify-between gap-6 relative',
    'grid grid-cols-2 gap-3.5 sm:gap-4',
    'lg:w-[35%] bg-slate-50/60 p-6 sm:p-9 flex flex-col items-center justify-center text-center gap-4'
  ]) {
    assert.ok(pageHtml.includes(className), `Missing mockup class group: ${className}`);
  }
  assert.equal((pageHtml.match(/rounded-2xl bg-slate-50\/90 border border-slate-100 flex flex-col gap-1/g) || []).length, 4);
  assert.match(pageHtml, /SportBooking Pass/);
  assert.match(pageHtml, /Mã QR vé/);
  assert.doesNotMatch(pageHtml, /check-in|VIP|Gold/i);
  const buttons = [...pageHtml.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/gi)]
    .map((match) => match[0]);
  for (const label of ['In vé', 'Tải PDF', 'Chia sẻ']) {
    const disabledButton = buttons.find((button) => button.includes(label));
    assert.ok(disabledButton, `${label} button must exist.`);
    assert.match(disabledButton, /\bdisabled\b/);
    assert.match(disabledButton, /Sắp có/);
  }
  const legacyIconFontPattern = new RegExp(
    `Material\\+Symbols|${['material', '-symbols-outlined'].join('')}`,
    'i'
  );
  assert.doesNotMatch(pageHtml, legacyIconFontPattern);
  assert.doesNotMatch(pageHtml, /<img\b/i);
  assert.match(completionHtml, /id="bookingQr"/);
  assert.match(completionHtml, /id="bookingQrPanel"[^>]*hidden/);
  assert.match(completionHtml, /src="\/assets\/qr-code\.js"/);
  assert.match(pageHtml, /src="\/assets\/qr-code\.js"/);
  const completionScript = fs.readFileSync(
    path.join(root, 'booking', 'booking-complete-page.js'),
    'utf8'
  );
  assert.match(completionHtml, /id="openTicket"[^>]*>\s*<span>Xem vé điện tử<\/span>/);
  assert.match(completionScript, /SportBookingBackNav\.buildTicketUrl\(bookingId,/);
  assert.match(completionScript, /booking\.status === 'CONFIRMED'/);
  assert.match(completionScript, /toSvg\(\s*model\.qrPayload/);
  assert.match(fs.readFileSync(path.join(root, 'booking', 'ticket-page.js'), 'utf8'), /toSvg\(model\.qrPayload\)/);
  assert.equal((pageHtml.match(/data-back-button/g) || []).length, 1);
  assert.doesNotMatch(pageHtml.slice(0, pageHtml.indexOf('ticket-page-actions')), /data-back-button/);
  assert.match(completionHtml, /grid-cols-2 min-\[640px\]:grid-cols-4/);
  const detailHtml = fs.readFileSync(path.join(root, 'chi-tiet-don-dat-san.html'), 'utf8');
  assert.doesNotMatch(detailHtml, /id="openTicket"[^>]*href="\/dat-san-thanh-cong\.html/);
});
