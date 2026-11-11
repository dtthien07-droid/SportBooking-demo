'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { canCancelBooking } = require('../booking/booking-history-state.js');

test('hủy chỉ hiển thị cho CONFIRMED sắp tới theo trạng thái server', () => {
  assert.equal(canCancelBooking({
    status: 'CONFIRMED',
    display_status_code: 'UPCOMING'
  }), true);
  assert.equal(canCancelBooking({
    status: 'CONFIRMED',
    display_status_code: 'IN_PROGRESS'
  }), false);
  assert.equal(canCancelBooking({
    status: 'CONFIRMED',
    display_status_code: 'COMPLETED'
  }), false);
});

test('không suy ra khả năng hủy từ thời gian client hoặc trạng thái khác', () => {
  assert.equal(canCancelBooking({
    status: 'PENDING',
    display_status_code: 'UPCOMING'
  }), false);
  assert.equal(canCancelBooking({
    status: 'CANCELLED',
    display_status_code: 'CANCELLED'
  }), false);
  assert.equal(canCancelBooking(null), false);
});
