'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canCancelBooking,
  formatStartCountdown,
  getRefundPercentBySeconds,
  getCancelConfirmationLabel
} = require('../booking/booking-history-state.js');

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

test('nút Hủy nhanh theo đúng trạng thái máy chủ có thể hủy', () => {
  assert.equal(canCancelBooking({ status: 'PENDING', display_status_code: 'PENDING' }), true);
  assert.equal(canCancelBooking({ status: 'PENDING', display_status_code: 'EXPIRED' }), false);
  assert.equal(canCancelBooking({ status: 'CONFIRMED', display_status_code: 'UPCOMING' }), true);
  assert.equal(canCancelBooking({ status: 'CONFIRMED', display_status_code: 'IN_PROGRESS' }), false);
});

test('định dạng thời gian đến giờ thi đấu', () => {
  assert.equal(formatStartCountdown(5352), '1 giờ 29 phút 12 giây');
  assert.equal(formatStartCountdown(42), '42 giây');
  assert.equal(formatStartCountdown(-1), 'Đã bắt đầu');
});

test('xác định mức hoàn chính xác tại ranh 24 giờ và 6 giờ', () => {
  assert.equal(getRefundPercentBySeconds(24 * 60 * 60), 100);
  assert.equal(getRefundPercentBySeconds(24 * 60 * 60 - 1), 50);
  assert.equal(getRefundPercentBySeconds(6 * 60 * 60), 50);
  assert.equal(getRefundPercentBySeconds(6 * 60 * 60 - 1), 0);
});

test('nhãn nút xác nhận theo khoản hoàn thực tế', () => {
  assert.equal(getCancelConfirmationLabel('100000'), 'Xác nhận hủy & hoàn 100.000 đ');
  assert.equal(getCancelConfirmationLabel('0'), 'Xác nhận hủy (không hoàn tiền)');
  assert.equal(getCancelConfirmationLabel('0', true), 'Xác nhận hủy đơn');
});
