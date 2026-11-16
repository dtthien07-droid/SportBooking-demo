'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const createBookingRepository = require('../src/bookings/bookings.repository');
const {
  createBookingWithUniqueCode,
  createBookingsService,
  generateBookingCode
} = require('../src/bookings/bookings.service');

test('new booking codes use the UTC+7 date and six unambiguous characters', () => {
  const code = generateBookingCode(
    new Date('2026-11-10T17:00:00.000Z'),
    () => Buffer.from([0, 1, 2, 3, 4, 5])
  );
  assert.equal(code, 'SPB-20261111-234567');
  assert.match(code, /^SPB-\d{8}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/);
});

test('booking code creation retries a duplicate and returns the successful code', async () => {
  const attemptedCodes = [];
  const repository = createBookingRepository({ async execute() {} });
  let bookingId = 0;
  const connection = {
    async execute(_query, parameters) {
      attemptedCodes.push(parameters[0]);
      if (attemptedCodes.length === 1) {
        const error = new Error("Duplicate entry for key 'uq_bookings_booking_code'.");
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      bookingId += 1;
      return [{ insertId: bookingId }];
    }
  };
  let sequence = 0;
  const result = await createBookingWithUniqueCode(repository, connection, {
    userId: '42',
    totalAmount: '100',
    matchPreference: null,
    expiresAt: new Date('2026-11-10T12:10:00.000Z')
  }, {
    now: () => new Date('2026-11-10T12:00:00.000Z'),
    generateCode: () => `SPB-20261110-00000${++sequence}`
  });

  assert.deepEqual(result, { bookingId: 1, bookingCode: 'SPB-20261110-000002' });
  assert.equal(new Set(attemptedCodes).size, 2);
});

test('booking summary derives all counts from the shared display status function', async () => {
  const repository = {
    async withTransaction() {},
    async findBookingSummaryRows() {
      return [
        { status: 'CONFIRMED', first_slot_start: '2026-11-20T10:00:00', last_slot_end: '2026-11-20T11:00:00' },
        { status: 'CONFIRMED', first_slot_start: '2026-11-01T10:00:00', last_slot_end: '2026-11-01T11:00:00' },
        { status: 'COMPLETED' },
        { status: 'PENDING', lock_expired: 0 },
        { status: 'PENDING', lock_expired: 1 },
        { status: 'EXPIRED' },
        { status: 'CANCELLED' }
      ];
    },
    async getTotalSpentForUser() {
      return '8500';
    }
  };
  const service = createBookingsService(repository, {
    now: () => new Date('2026-11-10T03:00:00.000Z')
  });

  assert.deepEqual(await service.getBookingSummary({ id: '42' }), {
    upcoming_count: 1,
    completed_count: 2,
    total_spent: '8500',
    counts_by_status: {
      'Chờ thanh toán': 1,
      'Sắp tới/Đang trong trận': 1,
      'Hoàn thành': 2,
      'Đã hủy': 1,
      'Hết hạn': 2
    }
  });
});

test('booking creation ignores match preferences when matchmaking is disabled', async () => {
  const slot = {
    id: '22',
    status: 'AVAILABLE',
    current_booking_id: null,
    lock_expired: 0,
    court_is_active: 1,
    facility_is_active: 1,
    starts_at: '12:00:00',
    ends_at: '13:00:00',
    opening_time: '08:00:00',
    closing_time: '22:00:00',
    starts_in_time: 1,
    court_id: '4',
    service_date: '2026-12-01',
    price: '120000',
    sport_type: 'BADMINTON',
    court_name: 'Court',
    facility_id: '3',
    facility_name: 'Venue'
  };
  let storedBookingInput;
  const repository = {
    async withTransaction(work) { return work({}); },
    async lockUser() { return { id: '42' }; },
    async lockPendingBookingsForUser() { return []; },
    async findRequestedSlotStates() { return [slot]; },
    async lockBookings() { return []; },
    async findSlotIdsForBookings() { return []; },
    async lockTimeSlots() { return [slot]; },
    async createHoldDeadline() { return new Date('2026-11-10T12:10:00.000Z'); },
    async createBooking(_connection, input) {
      storedBookingInput = input;
      return '100';
    },
    async createPayment() {},
    async createBookingSlots() {},
    async lockTimeSlotsForBooking() { return 1; },
    isBookingCodeConflict() { return false; }
  };
  const service = createBookingsService(repository, { matchmakingEnabled: false });

  const booking = await service.createBooking('42', {
    slot_ids: ['22'],
    payment_option: 'DEPOSIT_50',
    match_preference: {
      mode: 'NOT_A_MODE',
      gender: 'NOT_A_GENDER',
      format: 'NOT_A_FORMAT',
      message: { unexpected: true }
    }
  });

  assert.equal(booking.match_preference, null);
  assert.equal(storedBookingInput.matchPreference, null);
});
