'use strict';

(() => {
  const stateTools = window.SportBookingNotificationState;
  const elements = {
    back: document.getElementById('notifications-back'),
    title: document.getElementById('notifications-title'),
    totalCount: document.getElementById('notifications-count-total'),
    tabs: [...document.querySelectorAll('[data-notification-category]')],
    list: document.getElementById('notifications-list'),
    loading: document.getElementById('notifications-loading'),
    error: document.getElementById('notifications-error'),
    empty: document.getElementById('notifications-empty'),
    retry: document.getElementById('notifications-retry'),
    markAll: document.getElementById('notifications-read-all'),
    pagination: document.getElementById('notifications-pagination'),
    pageInfo: document.getElementById('notifications-page-info'),
    previous: document.getElementById('notifications-previous'),
    next: document.getElementById('notifications-next')
  };
  const state = {
    category: 'all',
    page: 1,
    totalPages: 0,
    serverTime: null,
    notifications: [],
    request: 0
  };
  const notificationTypes = {
    confirmed: { icon: 'check_circle' },
    cancelled: { icon: 'cancel' },
    holdExpiring: { icon: 'timer' },
    holdExpired: { icon: 'hourglass_top' },
    paymentSuccess: { icon: 'payments' },
    refund: { icon: 'assignment_return' },
    paymentFailed: { icon: 'close' },
    payment: { icon: 'account_balance_wallet' },
    system: { icon: 'notifications' },
    match: { icon: 'groups' },
    booking: { icon: 'event_available' }
  };

  function loginRedirect() {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/dang-nhap.html?returnTo=${encodeURIComponent(returnTo)}`);
  }

  function bookingTarget(notification) {
    if (notification.resource_type !== 'BOOKING'
        || !/^[1-9]\d*$/.test(String(notification.resource_id || ''))) {
      return null;
    }
    const query = new URLSearchParams({
      booking_id: String(notification.resource_id),
      from: `${window.location.pathname}?page=${state.page}`
    });
    return `/chi-tiet-don-dat-san.html?${query}`;
  }

  function setView({ loading = false, error = null, items = [] } = {}) {
    const view = stateTools.getDisplayState({ loading, error, items });
    elements.loading.hidden = view !== 'loading';
    elements.error.hidden = view !== 'error';
    elements.empty.hidden = view !== 'empty';
    elements.list.hidden = view !== 'list';
    elements.pagination.hidden = view !== 'list' || state.totalPages <= 1;
    elements.markAll.disabled = view === 'loading' || view === 'error';
    if (error) elements.error.querySelector('[data-error-message]').textContent = error;
  }

  function makeIcon(name, className) {
    const icon = window.SportBookingIcons.createIcon(name, className);
    icon.setAttribute('aria-hidden', 'true');
    return icon;
  }

  function notificationDayKey(value) {
    const text = String(value || '');
    const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text)
      ? `${text.replace(' ', 'T')}Z`
      : text;
    const date = new Date(normalized);
    if (!Number.isFinite(date.getTime())) return '';
    return new Intl.DateTimeFormat('en-CA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'Asia/Ho_Chi_Minh'
    }).format(date);
  }

  function createNotificationGroup(title, notifications) {
    if (notifications.length === 0) return null;
    const section = document.createElement('section');
    section.className = 'notification-group';
    const heading = document.createElement('div');
    heading.className = 'notification-group__heading';
    const label = document.createElement('h3');
    label.textContent = title;
    const count = document.createElement('span');
    count.textContent = `${notifications.length} thông báo`;
    heading.append(label, count);
    const list = document.createElement('div');
    list.className = 'notification-group__list';
    list.append(...notifications.map(createNotificationCard));
    section.append(heading, list);
    return section;
  }

  function createNotificationCardFrame(notification, type, details) {
    const presentation = notificationTypes[type];
    const article = document.createElement('article');
    article.className = `notification-card notification-card--${type}${notification.read_at ? '' : ' is-unread'}`;
    const iconBox = document.createElement('span');
    iconBox.className = 'notification-card__icon';
    iconBox.append(makeIcon(presentation.icon, 'notification-card__svg'));

    const content = document.createElement('div');
    content.className = 'notification-card__content';
    const meta = document.createElement('div');
    meta.className = 'notification-card__meta';
    const time = document.createElement('time');
    time.className = 'notification-card__time';
    time.dateTime = String(notification.created_at);
    time.textContent = stateTools.formatRelativeTime(notification.created_at, state.serverTime);
    meta.append(time);
    content.append(meta, details);

    const actions = document.createElement('div');
    actions.className = 'notification-card__actions';
    if (!notification.read_at) {
      const readButton = document.createElement('button');
      readButton.className = 'notification-card__read';
      readButton.type = 'button';
      readButton.textContent = 'Đánh dấu đã đọc';
      readButton.addEventListener('click', () => markOne(notification.id));
      actions.append(readButton);
    } else {
      const readState = document.createElement('span');
      readState.className = 'notification-card__read-state';
      readState.textContent = 'Đã đọc';
      actions.append(readState);
    }

    const target = bookingTarget(notification);
    if (target) {
      const link = document.createElement('a');
      link.className = 'notification-card__link';
      link.href = target;
      link.textContent = 'Xem đơn';
      link.addEventListener('click', async (event) => {
        event.preventDefault();
        try {
          if (!notification.read_at) await markOneRequest(notification.id);
          window.location.assign(target);
        } catch (error) {
          setView({ error: error.message });
        }
      });
      actions.append(link);
    } else {
      const unavailable = document.createElement('span');
      unavailable.className = 'notification-card__unavailable';
      unavailable.textContent = 'Sắp có';
      unavailable.setAttribute('aria-disabled', 'true');
      actions.append(unavailable);
    }
    article.append(iconBox, content, actions);
    return article;
  }

  function createNotificationDetails(notification, type) {
    const details = document.createElement('div');
    details.className = `notification-card__details notification-card__details--${type}`;
    const title = document.createElement('h2');
    title.className = 'notification-card__title';
    title.textContent = notification.title;
    const body = document.createElement('p');
    body.className = 'notification-card__body';
    body.textContent = notification.body;
    details.append(title, body);
    return details;
  }

  function createConfirmedNotificationCard(notification) {
    return createNotificationCardFrame(
      notification,
      'confirmed',
      createNotificationDetails(notification, 'confirmed')
    );
  }

  function createCancelledNotificationCard(notification) {
    return createNotificationCardFrame(
      notification,
      'cancelled',
      createNotificationDetails(notification, 'cancelled')
    );
  }

  function createHoldExpiredNotificationCard(notification) {
    return createNotificationCardFrame(
      notification,
      'holdExpired',
      createNotificationDetails(notification, 'holdExpired')
    );
  }

  function createHoldExpiringNotificationCard(notification) {
    return createNotificationCardFrame(
      notification,
      'holdExpiring',
      createNotificationDetails(notification, 'holdExpiring')
    );
  }

  function createPaymentNotificationCard(notification, type) {
    return createNotificationCardFrame(
      notification,
      type,
      createNotificationDetails(notification, type)
    );
  }

  function createSystemNotificationCard(notification) {
    return createNotificationCardFrame(
      notification,
      'system',
      createNotificationDetails(notification, 'system')
    );
  }

  function createMatchNotificationCard(notification) {
    return createNotificationCardFrame(
      notification,
      'match',
      createNotificationDetails(notification, 'match')
    );
  }

  function createBookingNotificationCard(notification) {
    return createNotificationCardFrame(
      notification,
      'booking',
      createNotificationDetails(notification, 'booking')
    );
  }

  function createNotificationCard(notification) {
    const type = stateTools.getNotificationType(notification);
    const renderers = {
      confirmed: createConfirmedNotificationCard,
      cancelled: createCancelledNotificationCard,
      holdExpiring: createHoldExpiringNotificationCard,
      holdExpired: createHoldExpiredNotificationCard,
      paymentSuccess: (item) => createPaymentNotificationCard(item, 'paymentSuccess'),
      refund: (item) => createPaymentNotificationCard(item, 'refund'),
      paymentFailed: (item) => createPaymentNotificationCard(item, 'paymentFailed'),
      payment: (item) => createPaymentNotificationCard(item, 'payment'),
      system: createSystemNotificationCard,
      match: createMatchNotificationCard,
      booking: createBookingNotificationCard
    };
    return renderers[type](notification);
  }

  async function markOneRequest(id) {
    const response = await fetch(`/api/v1/notifications/${encodeURIComponent(id)}/read`, {
      method: 'PATCH',
      credentials: 'same-origin',
      cache: 'no-store'
    });
    if (response.status === 401) {
      loginRedirect();
      return null;
    }
    if (!response.ok) throw new Error('Không thể đánh dấu thông báo đã đọc. Hãy thử lại.');
  }

  async function markOne(id) {
    try {
      await markOneRequest(id);
      await loadNotifications();
    } catch (error) {
      setView({ error: error.message });
    }
  }

  function renderItems(notifications) {
    const filtered = stateTools.filterNotifications(notifications, state.category);
    state.totalPages = Math.ceil(filtered.length / 10);
    state.page = Math.min(state.page, state.totalPages || 1);
    const items = filtered.slice((state.page - 1) * 10, state.page * 10);
    elements.totalCount.textContent = `${filtered.length} thông báo`;
    const today = notificationDayKey(state.serverTime || Date.now());
    const todayItems = [];
    const olderItems = [];
    for (const item of items) {
      (notificationDayKey(item.created_at) === today ? todayItems : olderItems).push(item);
    }
    const groups = [
      createNotificationGroup('Hôm nay', todayItems),
      createNotificationGroup('Trước đó', olderItems)
    ].filter(Boolean);
    elements.list.replaceChildren(...groups);
    elements.pageInfo.textContent = state.totalPages > 0
      ? `Trang ${state.page} / ${state.totalPages}`
      : 'Chưa có trang';
    elements.previous.disabled = state.page <= 1;
    elements.next.disabled = state.page >= state.totalPages;
    elements.pagination.hidden = state.totalPages <= 1;
    setView({ items });
  }

  async function loadNotifications() {
    const requestId = ++state.request;
    elements.list.replaceChildren();
    setView({ loading: true });
    const pageSize = 10;
    try {
      const fetchPage = async (category, page) => {
        const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
        if (category) query.set('category', category);
        const response = await fetch(`/api/v1/notifications?${query}`, {
          credentials: 'same-origin',
          cache: 'no-store'
        });
        if (response.status === 401) {
          loginRedirect();
          return null;
        }
        if (!response.ok) throw new Error('Không thể tải thông báo. Hãy thử lại.');
        const result = await response.json();
        if (!Array.isArray(result.notifications) || !result.pagination
            || !Number.isSafeInteger(result.pagination.total_pages)) {
          throw new Error('Dữ liệu thông báo không hợp lệ. Hãy thử lại.');
        }
        return result;
      };
      const fetchCategory = async (category) => {
        const firstPage = await fetchPage(category, 1);
        if (!firstPage) return null;
        const notifications = [...firstPage.notifications];
        for (let page = 2; page <= firstPage.pagination.total_pages; page += 1) {
          const result = await fetchPage(category, page);
          if (!result) return null;
          notifications.push(...result.notifications);
          if (requestId !== state.request) return null;
        }
        return { notifications, serverTime: firstPage.server_time };
      };
      const categories = state.category === 'all'
        ? [null]
        : state.category === 'BOOKING_HOLD'
          ? ['BOOKING_HOLD', 'PAYMENT']
          : [state.category];
      const results = [];
      for (const category of categories) {
        const result = await fetchCategory(category);
        if (!result || requestId !== state.request) return;
        results.push(result);
      }
      const byId = new Map();
      for (const result of results) {
        for (const notification of result.notifications) {
          byId.set(notification.id, notification);
        }
      }
      const notifications = [...byId.values()].sort((first, second) =>
        String(second.created_at).localeCompare(String(first.created_at))
      );
      if (requestId !== state.request) return;
      state.notifications = notifications;
      state.serverTime = results[0]?.serverTime;
      renderItems(state.notifications);
    } catch (error) {
      if (requestId === state.request) setView({ error: error.message });
    }
  }

  async function markAllRead() {
    elements.markAll.disabled = true;
    try {
      const response = await fetch('/api/v1/notifications/read-all', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store'
      });
      if (response.status === 401) {
        loginRedirect();
        return;
      }
      if (!response.ok) throw new Error('Không thể đánh dấu tất cả đã đọc. Hãy thử lại.');
      await loadNotifications();
    } catch (error) {
      setView({ error: error.message });
    } finally {
      elements.markAll.disabled = false;
    }
  }

  elements.back.addEventListener('click', () => {
    const target = window.SportBookingBackNav.resolveBackTarget(
      window.location.search,
      document.referrer,
      window.location.origin
    );
    window.location.assign(target);
  });
  elements.tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      if (tab.disabled || tab.dataset.category === 'match') return;
      state.category = tab.dataset.category;
      state.page = 1;
      elements.tabs.forEach((item) => item.setAttribute(
        'aria-pressed',
        String(item === tab)
      ));
      elements.title.textContent = tab.dataset.label;
      loadNotifications();
    });
  });
  elements.retry.addEventListener('click', loadNotifications);
  elements.markAll.addEventListener('click', markAllRead);
  elements.previous.addEventListener('click', () => {
    if (state.page > 1) {
      state.page -= 1;
      renderItems(state.notifications);
    }
  });
  elements.next.addEventListener('click', () => {
    if (state.page < state.totalPages) {
      state.page += 1;
      renderItems(state.notifications);
    }
  });
  loadNotifications();
})();
