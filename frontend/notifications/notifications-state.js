'use strict';

(function exposeNotificationState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SportBookingNotificationState = api;
}(typeof window === 'undefined' ? null : window, () => {
  const CATEGORY_GROUPS = Object.freeze({
    all: null,
    BOOKING_HOLD: new Set(['confirmed', 'cancelled', 'holdExpiring', 'holdExpired', 'booking']),
    MATCH: new Set(['match']),
    PAYMENT: new Set(['paymentSuccess', 'refund', 'paymentFailed', 'payment']),
    SYSTEM: new Set(['system'])
  });

  function getNotificationType(notification) {
    const text = `${notification.title || ''} ${notification.body || ''}`
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .toLowerCase();
    if (notification.category === 'SYSTEM'
        || text.includes('bao tri')
        || text.includes('chinh sach')
        || text.includes('he thong')) return 'system';
    if (notification.category === 'MATCH') return 'match';
    if (text.includes('huy') || text.includes('cancel')) return 'cancelled';
    if (text.includes('sap het han') || text.includes('expires soon')) return 'holdExpiring';
    if (text.includes('het han') || text.includes('het thoi han') || text.includes('expired')) {
      return 'holdExpired';
    }
    if (text.includes('that bai')
        || text.includes('khong thanh cong')
        || text.includes('failed')) return 'paymentFailed';
    if (text.includes('hoan tien') || text.includes('hoan coc') || text.includes('refund')) {
      return 'refund';
    }
    if (text.includes('thanh toan thanh cong') || text.includes('payment successful')) {
      return 'paymentSuccess';
    }
    if (text.includes('xac nhan')
        || text.includes('dat san thanh cong')
        || text.includes('confirmed')) return 'confirmed';
    if (notification.category === 'PAYMENT') return 'payment';
    return 'booking';
  }

  function parseTimestamp(value) {
    if (value instanceof Date) return value;
    if (typeof value !== 'string' && typeof value !== 'number') return new Date(Number.NaN);
    const text = typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(value)
      ? `${value.replace(' ', 'T')}Z`
      : value;
    return new Date(text);
  }

  function formatRelativeTime(createdAt, serverTime = Date.now()) {
    const created = parseTimestamp(createdAt);
    const reference = parseTimestamp(serverTime);
    if (!Number.isFinite(created.getTime()) || !Number.isFinite(reference.getTime())) {
      throw new TypeError('Thời điểm thông báo không hợp lệ.');
    }
    const elapsed = Math.max(0, reference.getTime() - created.getTime());
    const minutes = Math.floor(elapsed / 60_000);
    if (minutes < 1) return 'Vừa xong';
    if (minutes < 60) return `${minutes} phút trước`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} giờ trước`;
    return new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Ho_Chi_Minh'
    }).format(created);
  }

  function formatUnreadBadge(count) {
    const safeCount = Math.max(0, Math.floor(Number(count) || 0));
    if (safeCount === 0) return '';
    return safeCount > 9 ? '9+' : String(safeCount);
  }

  function filterNotifications(notifications, category = 'all') {
    if (!Array.isArray(notifications)) return [];
    if (!Object.hasOwn(CATEGORY_GROUPS, category)) return [];
    const allowed = CATEGORY_GROUPS[category];
    return allowed
      ? notifications.filter((notification) => allowed.has(getNotificationType(notification)))
      : notifications;
  }

  function getDisplayState({ loading = false, error = null, items = [] } = {}) {
    if (loading) return 'loading';
    if (error) return 'error';
    return Array.isArray(items) && items.length > 0 ? 'list' : 'empty';
  }

  return {
    filterNotifications,
    formatRelativeTime,
    formatUnreadBadge,
    getDisplayState,
    getNotificationType
  };
}));
