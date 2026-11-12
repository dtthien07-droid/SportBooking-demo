'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  filterNotifications,
  formatRelativeTime,
  formatUnreadBadge,
  getDisplayState,
  getBookingTarget,
  getNotificationAction,
  getNotificationStyle,
  dedupeFacilityLabel,
  countUnreadByCategory
} = require('../notifications/notifications-state.js');
const icons = require('../shared/icons.js');

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

test('maps each known notification event to one shared SVG presentation', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'shared', 'header.css'), 'utf8');
  const cases = [
    [{ category: 'BOOKING_HOLD', title: 'Đặt sân thành công' }, 'BOOKED', 'Đã đặt', 'check_circle', '#087443', '#F0FDF4'],
    [{ category: 'PAYMENT', title: 'Thanh toán thành công' }, 'PAID', 'Thanh toán', 'credit_card', '#1D4ED8', '#EFF6FF'],
    [{ category: 'PAYMENT', title: 'Hoàn tiền 100.000 đ' }, 'REFUND', 'Hoàn tiền', 'replay', '#C2410C', '#FFF7ED'],
    [{ category: 'BOOKING_HOLD', title: 'Đã hủy đơn SPB-1234' }, 'CANCELLED', 'Đã hủy', 'close', '#B91C1C', '#FEF2F2'],
    [{ category: 'BOOKING_HOLD', title: 'Giữ chỗ đã hết hạn' }, 'EXPIRED', 'Hết hạn', 'timer', '#A16207', '#FEFCE8'],
    [{ category: 'MATCH', title: 'Thông báo mới' }, 'MATCH', 'Ghép kèo', 'groups', '#7C3AED', '#F5F3FF'],
    [{ category: 'SYSTEM', title: 'Thông báo mới' }, 'SYSTEM', 'Hệ thống', 'notifications', '#475569', '#F8FAFC'],
    [{ category: 'OTHER', title: 'Nội dung lạ' }, 'SYSTEM', 'Hệ thống', 'notifications', '#475569', '#F8FAFC']
  ];
  for (const [notification, type, label, icon, accent, background] of cases) {
    const style = getNotificationStyle(notification);
    assert.equal(style.type, type);
    assert.equal(style.label, label);
    assert.equal(style.icon, icon);
    assert.ok(icons.names.has(style.icon), `${style.icon} is registered as an inline SVG icon`);
    const accentVariable = style.borderColor.match(/^var\((--[^)]+)\)$/)[1];
    const backgroundVariable = style.cardBackground.match(/^var\((--[^)]+)\)$/)[1];
    assert.match(css, new RegExp(`${accentVariable}:\\s*${accent}`));
    assert.match(css, new RegExp(`${backgroundVariable}:\\s*${background}`));
  }
});

test('notification foreground and type labels meet WCAG AA contrast on every card background', () => {
  const css = fs.readFileSync(path.join(__dirname, '..', 'shared', 'header.css'), 'utf8');
  const resolve = (reference) => {
    const variable = reference.match(/^var\((--[^)]+)\)$/)?.[1];
    assert.ok(variable, `${reference} references a CSS custom property`);
    const value = css.match(new RegExp(`${variable}:\\s*(#[0-9A-Fa-f]{6})`))?.[1];
    assert.ok(value, `${variable} is defined in header.css`);
    return value;
  };
  const luminance = (hex) => {
    const channels = hex.slice(1).match(/.{2}/g).map((part) => parseInt(part, 16) / 255);
    const linear = channels.map((channel) => (
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
    ));
    return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  };
  const contrast = (foreground, background) => {
    const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
    return (values[0] + 0.05) / (values[1] + 0.05);
  };
  const cases = [
    { category: 'BOOKING_HOLD', title: 'Đặt sân thành công' },
    { category: 'PAYMENT', title: 'Thanh toán thành công' },
    { category: 'PAYMENT', title: 'Hoàn tiền 100.000 đ' },
    { category: 'BOOKING_HOLD', title: 'Đã hủy đơn SPB-1234' },
    { category: 'BOOKING_HOLD', title: 'Giữ chỗ đã hết hạn' },
    { category: 'MATCH', title: 'Thông báo mới' },
    { category: 'SYSTEM', title: 'Thông báo mới' }
  ];
  for (const notification of cases) {
    const style = getNotificationStyle(notification);
    const background = resolve(style.cardBackground);
    const unreadBackground = resolve(style.unreadBackground);
    assert.ok(contrast(resolve(style.textColor), background) >= 4.5, `${style.type} text contrast`);
    assert.ok(contrast(resolve(style.labelColor), background) >= 4.5, `${style.type} label contrast`);
    assert.ok(
      contrast(resolve(style.labelColor), unreadBackground) >= 4.5,
      `${style.type} unread label contrast`
    );
  }
});

test('deduplicates repeated facility labels case-insensitively and preserves distinct labels', () => {
  assert.equal(dedupeFacilityLabel('Sân A — Sân A, 12/11/2026'), 'Sân A, 12/11/2026');
  assert.equal(
    dedupeFacilityLabel('Hoàn tiền 100.000 đ cho Cơ sở A — cơ sở   a, đơn SPB-1234'),
    'Hoàn tiền 100.000 đ cho Cơ sở A, đơn SPB-1234'
  );
  assert.equal(dedupeFacilityLabel('Sân A — Sân B, 12/11/2026'), 'Sân A — Sân B, 12/11/2026');
});

test('provides booking, ticket, and cancellation actions with safe return paths', () => {
  const notification = {
    category: 'BOOKING_HOLD',
    resource_type: 'BOOKING',
    resource_id: '412'
  };
  assert.deepEqual(getNotificationAction({
    ...notification,
    title: 'Đặt sân thành công'
  }, '/thong-bao.html?page=2'), {
    href: '/chi-tiet-don-dat-san.html?booking_id=412&from=%2Fthong-bao.html%3Fpage%3D2',
    label: 'Xem đơn'
  });
  assert.deepEqual(getNotificationAction({
    ...notification,
    title: 'Đã hủy đơn SPB-1234'
  }, '/thong-bao.html'), {
    href: '/chi-tiet-don-dat-san.html?booking_id=412&from=%2Fthong-bao.html',
    label: 'Xem chi tiết đơn hủy'
  });
  assert.deepEqual(getNotificationAction({
    ...notification,
    title: 'Vé điện tử đã sẵn sàng'
  }, '/thong-bao.html'), {
    href: '/ve-dien-tu.html?booking_id=412&from=%2Fthong-bao.html',
    label: 'Xem vé'
  });
  assert.equal(getNotificationAction({ title: 'Thông báo' }, '/thong-bao.html'), null);
});

test('counts unread notifications overall and by category', () => {
  assert.deepEqual(countUnreadByCategory([
    { category: 'BOOKING_HOLD', read_at: null },
    { category: 'PAYMENT', read_at: null },
    { category: 'PAYMENT', read_at: '2026-11-12T00:00:00Z' },
    { category: 'UNKNOWN', read_at: null }
  ]), { all: 3, BOOKING_HOLD: 1, MATCH: 0, PAYMENT: 1, SYSTEM: 0 });
});

test('notification tabs display the requested category labels', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'thong-bao.html'), 'utf8');
  assert.match(html, /data-category="BOOKING_HOLD" data-label="Lịch đặt sân &amp; Giữ chỗ"/);
  assert.match(html, /data-category="PAYMENT" data-label="Thanh toán &amp; Hoàn cọc"/);
});

test('category tabs count and display only notifications assigned to that category', () => {
  const notifications = [
    { category: 'BOOKING_HOLD', title: 'Giữ chỗ của đơn SPB-1234 đã hết hạn' },
    { category: 'MATCH', title: 'Tìm đối' },
    { category: 'PAYMENT', title: 'Thanh toán thành công', body: 'Đơn SPB-1234 đã được xác nhận.' },
    { category: 'BOOKING_HOLD', title: 'Đơn SPB-2345 đã hủy', body: 'Không có khoản hoàn theo chính sách hủy.' },
    { category: 'PAYMENT', title: 'Hoàn tiền 100.000 đ', body: 'Đơn SPB-2346 đã hoàn 100.000 đ.' },
    { category: 'SYSTEM', title: 'Cập nhật hệ thống' }
  ];
  assert.deepEqual(
    filterNotifications(notifications, 'BOOKING_HOLD'),
    [notifications[0], notifications[3]]
  );
  assert.deepEqual(filterNotifications(notifications, 'PAYMENT'), [notifications[2], notifications[4]]);
  assert.deepEqual(filterNotifications(notifications, 'MATCH'), [notifications[1]]);
  assert.deepEqual(filterNotifications(notifications, 'SYSTEM'), [notifications[5]]);
  assert.deepEqual(filterNotifications(notifications, 'all'), notifications);
  assert.deepEqual(filterNotifications(notifications, 'unknown'), []);
});

test('booking notifications from both booking and payment categories link to the same order', () => {
  for (const category of ['BOOKING_HOLD', 'PAYMENT']) {
    assert.equal(
      getBookingTarget({
        category,
        resource_type: 'BOOKING',
        resource_id: '412'
      }, '/thong-bao.html?page=2'),
      '/chi-tiet-don-dat-san.html?booking_id=412&from=%2Fthong-bao.html%3Fpage%3D2'
    );
  }
});

test('chooses loading, error, empty, and list states in priority order', () => {
  assert.equal(getDisplayState({ loading: true, error: 'network', items: [{ id: 1 }] }), 'loading');
  assert.equal(getDisplayState({ error: 'network', items: [{ id: 1 }] }), 'error');
  assert.equal(getDisplayState({ items: [] }), 'empty');
  assert.equal(getDisplayState({ items: [{ id: 1 }] }), 'list');
});
