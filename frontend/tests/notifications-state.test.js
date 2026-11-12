'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  filterNotifications,
  formatRelativeTime,
  formatUnreadBadge,
  getDisplayState,
  getNotificationType
} = require('../notifications/notifications-state.js');

test('formats relative time from server time and switches to Vietnam time after 24 hours', () => {
  const serverTime = '2026-11-11T12:00:00.000Z';
  assert.equal(formatRelativeTime('2026-11-11T11:58:00.000Z', serverTime), '2 phút trước');
  assert.equal(formatRelativeTime('2026-11-10T10:00:00.000Z', serverTime), '17:00 10/11/2026');
});

test('formats unread count badges with a maximum of 9+', () => {
  assert.equal(formatUnreadBadge(0), '');
  assert.equal(formatUnreadBadge(9), '9');
  assert.equal(formatUnreadBadge(10), '9+');
});

test('classifies notification types by their meaning rather than database category', () => {
  const paymentConfirmingBooking = {
    category: 'PAYMENT',
    title: 'Thanh toán thành công',
    body: 'Đơn SPB-1234 đã được xác nhận.'
  };
  assert.equal(getNotificationType(paymentConfirmingBooking), 'paymentSuccess');
  assert.equal(getNotificationType({
    category: 'BOOKING_HOLD',
    title: 'Đơn SPB-7654 đã được xác nhận',
    body: 'Đặt sân thành công.'
  }), 'confirmed');
  assert.equal(getNotificationType({
    category: 'PAYMENT',
    title: 'Đơn SPB-2345 đã hủy',
    body: 'Số tiền hoàn thực tế: 100.000đ'
  }), 'cancelled');
  assert.equal(getNotificationType({
    category: 'BOOKING_HOLD',
    title: 'Giữ chỗ sắp hết hạn',
    body: 'Đơn SPB-3456'
  }), 'holdExpiring');
  assert.equal(getNotificationType({
    category: 'PAYMENT',
    title: 'Hoàn tiền',
    body: '100.000đ đã được hoàn cho đơn SPB-4567.'
  }), 'refund');
  assert.equal(getNotificationType({
    category: 'PAYMENT',
    title: 'Thanh toán thất bại',
    body: 'Vui lòng thử lại.'
  }), 'paymentFailed');
  assert.equal(getNotificationType({
    category: 'PAYMENT',
    title: 'Thanh toán không thành công',
    body: 'Đơn SPB-5678'
  }), 'paymentFailed');
  assert.equal(getNotificationType({
    category: 'SYSTEM',
    title: 'Đơn bị hủy',
    body: 'Thông báo bảo trì hệ thống.'
  }), 'system');
});

test('filters notifications into semantic user-facing groups', () => {
  const notifications = [
    { category: 'BOOKING_HOLD', title: 'Giữ chỗ của đơn SPB-1234 đã hết hạn' },
    { category: 'MATCH', title: 'Tìm đối' },
    { category: 'PAYMENT', title: 'Thanh toán thành công', body: 'Đơn SPB-1234 đã được xác nhận.' },
    { category: 'PAYMENT', title: 'Đơn SPB-2345 đã hủy', body: 'Số tiền hoàn thực tế: 0đ' },
    { category: 'SYSTEM', title: 'Cập nhật hệ thống' }
  ];
  assert.deepEqual(
    filterNotifications(notifications, 'BOOKING_HOLD'),
    [notifications[0], notifications[3]]
  );
  assert.deepEqual(filterNotifications(notifications, 'PAYMENT'), [notifications[2]]);
  assert.deepEqual(filterNotifications(notifications, 'MATCH'), [notifications[1]]);
  assert.deepEqual(filterNotifications(notifications, 'SYSTEM'), [notifications[4]]);
  assert.deepEqual(filterNotifications(notifications, 'all'), notifications);
  assert.deepEqual(filterNotifications(notifications, 'unknown'), []);
});

test('chooses loading, error, empty, and list states in priority order', () => {
  assert.equal(getDisplayState({ loading: true, error: 'network', items: [{ id: 1 }] }), 'loading');
  assert.equal(getDisplayState({ error: 'network', items: [{ id: 1 }] }), 'error');
  assert.equal(getDisplayState({ items: [] }), 'empty');
  assert.equal(getDisplayState({ items: [{ id: 1 }] }), 'list');
});
