'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  createBookingsService,
  getBookingDisplayState
} = require('../src/bookings/bookings.service');

const start = '2026-11-10T10:00:00';
const end = '2026-11-10T11:00:00';
const confirmedBooking = {
  status: 'CONFIRMED',
  slots: [
    { service_date: '2026-11-10', starts_at: '10:00:00', ends_at: '11:00:00' }
  ]
};

test('confirmed booking display status uses half-open UTC+7 boundaries', () => {
  assert.deepEqual(
    getBookingDisplayState(confirmedBooking, new Date(Date.parse(`${start}+07:00`) - 1)),
    { code: 'UPCOMING', label: 'Sắp tới' }
  );
  assert.deepEqual(
    getBookingDisplayState(confirmedBooking, new Date(Date.parse(`${start}+07:00`))),
    { code: 'IN_PROGRESS', label: 'Đang trong trận' }
  );
  assert.deepEqual(
    getBookingDisplayState(confirmedBooking, new Date(Date.parse(`${end}+07:00`) - 1)),
    { code: 'IN_PROGRESS', label: 'Đang trong trận' }
  );
  assert.deepEqual(
    getBookingDisplayState(confirmedBooking, new Date(Date.parse(`${end}+07:00`))),
    { code: 'COMPLETED', label: 'Hoàn thành' }
  );
});

test('pending and expired booking statuses remain distinct', () => {
  assert.deepEqual(
    getBookingDisplayState({ status: 'PENDING', lock_expired: 0 }),
    { code: 'PENDING', label: 'Chờ thanh toán' }
  );
  assert.deepEqual(
    getBookingDisplayState({ status: 'PENDING', lock_expired: 1 }),
    { code: 'EXPIRED', label: 'Đã hết hạn' }
  );
  assert.deepEqual(
    getBookingDisplayState({ status: 'EXPIRED' }),
    { code: 'EXPIRED', label: 'Đã hết hạn' }
  );
});

test('completion job does not update early and repeated runs are idempotent', async () => {
  const endAt = Date.parse(`${end}+07:00`);
  let currentTime = endAt - 1;
  let status = 'CONFIRMED';
  let updateCalls = 0;
  const repository = {
    async withTransaction() {},
    async findConfirmedBookingsDueForCompletion() {
      return status === 'CONFIRMED'
        ? [{ id: '42', first_slot_start: start, last_slot_end: end }]
        : [];
    },
    async markBookingCompletedIfDue() {
      updateCalls += 1;
      if (status !== 'CONFIRMED' || currentTime < endAt) return false;
      status = 'COMPLETED';
      return true;
    }
  };
  const service = createBookingsService(repository, {
    now: () => new Date(currentTime)
  });

  assert.equal(await service.completeDueBookings(), 0);
  assert.equal(status, 'CONFIRMED');
  assert.equal(updateCalls, 0);

  currentTime = endAt;
  assert.equal(await service.completeDueBookings(), 1);
  assert.equal(status, 'COMPLETED');
  assert.equal(await service.completeDueBookings(), 0);
  assert.equal(updateCalls, 1);
});
