'use strict';

(function exposeNotificationState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SportBookingNotificationState = api;
}(typeof window === 'undefined' ? null : window, () => {
  const CATEGORY_GROUPS = Object.freeze({
    all: null,
    BOOKING_HOLD: 'BOOKING_HOLD',
    MATCH: 'MATCH',
    PAYMENT: 'PAYMENT',
    SYSTEM: 'SYSTEM'
  });

  const NOTIFICATION_STYLES = Object.freeze({
    BOOKED: Object.freeze({
      type: 'BOOKED',
      borderColor: 'var(--notification-booked-accent)',
      cardBackground: 'var(--notification-booked-bg)',
      unreadBackground: 'var(--notification-booked-unread-bg)',
      iconBackground: 'var(--notification-booked-icon-bg)',
      iconColor: 'var(--notification-booked-accent)',
      textColor: 'var(--notification-text)',
      labelColor: 'var(--notification-booked-accent)',
      icon: 'check_circle',
      label: 'Đã đặt'
    }),
    PAID: Object.freeze({
      type: 'PAID',
      borderColor: 'var(--notification-paid-accent)',
      cardBackground: 'var(--notification-paid-bg)',
      unreadBackground: 'var(--notification-paid-unread-bg)',
      iconBackground: 'var(--notification-paid-icon-bg)',
      iconColor: 'var(--notification-paid-accent)',
      textColor: 'var(--notification-text)',
      labelColor: 'var(--notification-paid-accent)',
      icon: 'credit_card',
      label: 'Thanh toán'
    }),
    REFUND: Object.freeze({
      type: 'REFUND',
      borderColor: 'var(--notification-refund-accent)',
      cardBackground: 'var(--notification-refund-bg)',
      unreadBackground: 'var(--notification-refund-unread-bg)',
      iconBackground: 'var(--notification-refund-icon-bg)',
      iconColor: 'var(--notification-refund-accent)',
      textColor: 'var(--notification-text)',
      labelColor: 'var(--notification-refund-accent)',
      icon: 'replay',
      label: 'Hoàn tiền'
    }),
    CANCELLED: Object.freeze({
      type: 'CANCELLED',
      borderColor: 'var(--notification-cancelled-accent)',
      cardBackground: 'var(--notification-cancelled-bg)',
      unreadBackground: 'var(--notification-cancelled-unread-bg)',
      iconBackground: 'var(--notification-cancelled-icon-bg)',
      iconColor: 'var(--notification-cancelled-accent)',
      textColor: 'var(--notification-text)',
      labelColor: 'var(--notification-cancelled-accent)',
      icon: 'close',
      label: 'Đã hủy'
    }),
    EXPIRED: Object.freeze({
      type: 'EXPIRED',
      borderColor: 'var(--notification-expired-accent)',
      cardBackground: 'var(--notification-expired-bg)',
      unreadBackground: 'var(--notification-expired-unread-bg)',
      iconBackground: 'var(--notification-expired-icon-bg)',
      iconColor: 'var(--notification-expired-accent)',
      textColor: 'var(--notification-text)',
      labelColor: 'var(--notification-expired-accent)',
      icon: 'timer',
      label: 'Hết hạn'
    }),
    MATCH: Object.freeze({
      type: 'MATCH',
      borderColor: 'var(--notification-match-accent)',
      cardBackground: 'var(--notification-match-bg)',
      unreadBackground: 'var(--notification-match-unread-bg)',
      iconBackground: 'var(--notification-match-icon-bg)',
      iconColor: 'var(--notification-match-accent)',
      textColor: 'var(--notification-text)',
      labelColor: 'var(--notification-match-accent)',
      icon: 'groups',
      label: 'Ghép kèo'
    }),
    SYSTEM: Object.freeze({
      type: 'SYSTEM',
      borderColor: 'var(--notification-system-accent)',
      cardBackground: 'var(--notification-system-bg)',
      unreadBackground: 'var(--notification-system-unread-bg)',
      iconBackground: 'var(--notification-system-icon-bg)',
      iconColor: 'var(--notification-system-accent)',
      textColor: 'var(--notification-text)',
      labelColor: 'var(--notification-system-accent)',
      icon: 'notifications',
      label: 'Hệ thống'
    })
  });

  function normalizeNotificationText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[đĐ]/g, 'd')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  }

  function getNotificationStyle(notification = {}) {
    if (notification.category === 'SYSTEM') return NOTIFICATION_STYLES.SYSTEM;
    if (notification.category === 'MATCH') return NOTIFICATION_STYLES.MATCH;
    if (notification.category !== 'BOOKING_HOLD' && notification.category !== 'PAYMENT') {
      return NOTIFICATION_STYLES.SYSTEM;
    }

    const title = normalizeNotificationText(notification.title);
    if (title.startsWith('dat san thanh cong')) return NOTIFICATION_STYLES.BOOKED;
    if (title.startsWith('thanh toan thanh cong')) return NOTIFICATION_STYLES.PAID;
    if (title.startsWith('hoan tien') || title.startsWith('hoan 100%')) {
      return NOTIFICATION_STYLES.REFUND;
    }
    if (title.includes('da huy') || title.includes('bi huy') || title.includes('cancel')) {
      return NOTIFICATION_STYLES.CANCELLED;
    }
    if (title.includes('het han') || title.includes('expired')) {
      return NOTIFICATION_STYLES.EXPIRED;
    }
    return NOTIFICATION_STYLES.SYSTEM;
  }

  function dedupeFacilityLabel(value) {
    return String(value || '').replace(
      /([^,;.\n]+?)\s+—\s+([^,;.\n]+?)(?=[,;.\n]|$)/g,
      (match, left, right) => {
        const normalizedLeft = normalizeNotificationText(left);
        const normalizedRight = normalizeNotificationText(right);
        return normalizedLeft === normalizedRight
          || normalizedLeft.endsWith(` ${normalizedRight}`)
          ? left.trimEnd()
          : match;
      }
    );
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
      ? notifications.filter((notification) => notification.category === allowed)
      : notifications;
  }

  function getBookingTarget(notification, from) {
    if (notification.resource_type !== 'BOOKING'
        || !/^[1-9]\d*$/.test(String(notification.resource_id || ''))) {
      return null;
    }
    const query = new URLSearchParams({
      booking_id: String(notification.resource_id),
      from
    });
    return `/chi-tiet-don-dat-san.html?${query}`;
  }

  function getNotificationAction(notification, from) {
    const bookingTarget = getBookingTarget(notification, from);
    if (!bookingTarget) return null;
    const text = normalizeNotificationText(notification.title);
    if (text.includes('ve dien tu') || text.includes('ticket')) {
      const query = new URLSearchParams({
        booking_id: String(notification.resource_id),
        from
      });
      return { href: `/ve-dien-tu.html?${query}`, label: 'Xem vé' };
    }
    return {
      href: bookingTarget,
      label: getNotificationStyle(notification).type === 'CANCELLED'
        ? 'Xem chi tiết đơn hủy'
        : 'Xem đơn'
    };
  }

  function countUnreadByCategory(notifications) {
    const counts = { all: 0, BOOKING_HOLD: 0, MATCH: 0, PAYMENT: 0, SYSTEM: 0 };
    for (const notification of Array.isArray(notifications) ? notifications : []) {
      if (notification.read_at) continue;
      counts.all += 1;
      if (Object.prototype.hasOwnProperty.call(counts, notification.category)) {
        counts[notification.category] += 1;
      }
    }
    return counts;
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
    countUnreadByCategory,
    getBookingTarget,
    getDisplayState,
    getNotificationAction,
    getNotificationStyle,
    dedupeFacilityLabel
  };
}));
