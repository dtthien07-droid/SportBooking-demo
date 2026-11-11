'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  formatCountdown,
  getBookingStatusLabel,
  getBookingErrorAction,
  getBookingErrorView,
  getBookingPresentation,
  getBookingSummaryPresentation
} = require('../booking/booking-history-state.js');

function booking(status, displayStatusCode, extra = {}) {
  return {
    booking_id: '42',
    status,
    display_status_code: displayStatusCode,
    display_status: 'Trạng thái',
    remaining_seconds: 90,
    slots: [{ facility_id: '7' }],
    ...extra
  };
}

test('PENDING còn hạn hiển thị nhãn, đồng hồ và nút tiếp tục thanh toán', () => {
  const view = getBookingPresentation(booking('PENDING', 'PENDING'));
  assert.equal(view.action, 'continue-payment');
  assert.equal(view.href, '/thanh-toan.html?booking_id=42');
  assert.equal(view.remainingSeconds, 90);
  assert.equal(view.label, 'Chờ thanh toán');
});

test('CONFIRMED hiển thị nút mở vé', () => {
  const view = getBookingPresentation(booking('CONFIRMED', 'UPCOMING'));
  assert.equal(view.action, 'view-ticket');
  assert.equal(view.href, '/ve-dien-tu.html?booking_id=42&from=%2Flich-su-dat-san.html');
  assert.equal(view.label, 'Sắp tới');
});

test('CONFIRMED đang diễn ra vẫn hiển thị nút mở vé', () => {
  const view = getBookingPresentation(booking('CONFIRMED', 'IN_PROGRESS'));
  assert.equal(view.action, 'view-ticket');
  assert.equal(view.label, 'Đang trong trận');
});

test('Đơn hết hạn không điều hướng tới luồng đặt lại chưa được hỗ trợ', () => {
  const view = getBookingPresentation(booking('PENDING', 'EXPIRED'));
  assert.equal(view.action, 'view-details');
  assert.equal(view.href, '/chi-tiet-don-dat-san.html?booking_id=42&from=%2Flich-su-dat-san.html');
  assert.equal(view.remainingSeconds, null);
});

test('COMPLETED và CANCELLED mở trang chi tiết, không mở vé', () => {
  for (const [status, code] of [['COMPLETED', 'COMPLETED'], ['CANCELLED', 'CANCELLED']]) {
    const view = getBookingPresentation(booking(status, code));
    assert.equal(view.action, 'view-details');
    assert.equal(view.href, '/chi-tiet-don-dat-san.html?booking_id=42&from=%2Flich-su-dat-san.html');
  }
});

test('PENDING không bao giờ hiển thị QR hoặc stepper', () => {
  const view = getBookingPresentation(booking('PENDING', 'PENDING'));
  assert.equal(view.showQr, false);
  assert.equal(view.showStepper, false);
});

test('Nhãn trạng thái dùng đúng thuật ngữ nghiệp vụ', () => {
  assert.deepEqual(
    ['PENDING', 'UPCOMING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXPIRED']
      .map(getBookingStatusLabel),
    ['Chờ thanh toán', 'Sắp tới', 'Đang trong trận', 'Hoàn thành', 'Đã hủy', 'Hết hạn']
  );
});

test('404 chỉ quyết định hiện trạng thái không tìm thấy', () => {
  assert.equal(getBookingErrorAction(404), 'not-found');
  assert.deepEqual(getBookingErrorView(404), {
    action: 'not-found',
    title: 'Không tìm thấy đơn',
    message: '',
    showRetry: false
  });
});

test('401 chuyển người dùng đến đăng nhập', () => {
  assert.equal(getBookingErrorAction(401), 'login');
  assert.equal(getBookingErrorView(401).action, 'login');
});

test('Định dạng đồng hồ giữ phút và giây', () => {
  assert.equal(formatCountdown(600), '10:00');
  assert.equal(formatCountdown(59), '00:59');
  assert.equal(formatCountdown(-1), '00:00');
});

test('biến số liệu lịch sử thành nhãn và số đếm hiển thị', () => {
  assert.deepEqual(getBookingSummaryPresentation({
    upcoming_count: 2,
    completed_count: 3,
    total_spent: '1234567',
    counts_by_status: {
      'Chờ thanh toán': 1,
      'Sắp tới/Đang trong trận': 2,
      'Hoàn thành': 3,
      'Đã hủy': 4,
      'Hết hạn': 5
    }
  }), {
    upcomingCount: '2',
    completedCount: '3',
    totalSpent: '1.234.567 đ',
    counts: {
      all: '15',
      upcoming: '2',
      'payment-pending': '1',
      completed: '3',
      cancelled: '4',
      expired: '5'
    }
  });
});

test('rejects invalid summary values instead of displaying placeholders', () => {
  assert.throws(() => getBookingSummaryPresentation({
    upcoming_count: -1,
    completed_count: 0,
    total_spent: '0',
    counts_by_status: {}
  }), /Số lượng trạng thái/);
});
