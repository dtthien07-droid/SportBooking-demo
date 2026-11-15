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
    request: 0,
    reading: new Set()
  };

  function loginRedirect() {
    const returnTo = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/dang-nhap.html?returnTo=${encodeURIComponent(returnTo)}`);
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

  function updateUnreadCounts() {
    const counts = stateTools.countUnreadByCategory(state.notifications);
    const pageBadge = document.querySelector('[data-notifications-unread-count]');
    if (pageBadge) {
      pageBadge.textContent = `${counts.all} chưa đọc`;
      pageBadge.hidden = counts.all === 0;
    }
    for (const badge of document.querySelectorAll('[data-category-unread]')) {
      const count = counts[badge.dataset.categoryUnread] || 0;
      badge.textContent = String(count);
      badge.hidden = count === 0;
    }
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

  function applyStyle(element, style) {
    element.style.setProperty('--notification-accent', style.borderColor);
    element.style.setProperty('--notification-card-bg', style.cardBackground);
    element.style.setProperty('--notification-unread-bg', style.unreadBackground);
    element.style.setProperty('--notification-icon-bg', style.iconBackground);
    element.style.setProperty('--notification-icon-color', style.iconColor);
    element.style.setProperty('--notification-text-color', style.textColor);
    element.style.setProperty('--notification-label-color', style.labelColor);
  }

  function createNotificationCardFrame(notification, style, details) {
    const article = document.createElement('article');
    article.className = `notification-card${notification.read_at ? '' : ' is-unread'}`;
    article.tabIndex = 0;
    article.setAttribute('aria-label', notification.title);
    applyStyle(article, style);

    const iconBox = document.createElement('span');
    iconBox.className = 'notification-card__icon';
    iconBox.append(makeIcon(style.icon, 'notification-card__svg'));

    const content = document.createElement('div');
    content.className = 'notification-card__content';
    content.append(details);

    const actions = document.createElement('div');
    actions.className = 'notification-card__actions';
    const meta = document.createElement('div');
    meta.className = 'notification-card__meta';
    const time = document.createElement('time');
    time.className = 'notification-card__time';
    time.dateTime = String(notification.created_at);
    time.textContent = stateTools.formatRelativeTime(notification.created_at, state.serverTime);
    meta.append(time);
    if (!notification.read_at) {
      const unread = document.createElement('span');
      unread.className = 'notification-card__unread';
      unread.append(
        document.createElement('span'),
        document.createTextNode('Chưa đọc')
      );
      unread.firstElementChild.className = 'notification-card__unread-dot';
      unread.firstElementChild.setAttribute('aria-hidden', 'true');
      meta.append(unread);
    }
    actions.append(meta);

    const action = stateTools.getNotificationAction(
      notification,
      `${window.location.pathname}?page=${state.page}`
    );
    if (action) {
      const link = document.createElement('a');
      link.className = 'notification-card__link';
      link.href = action.href;
      link.textContent = action.label;
      link.addEventListener('click', async (event) => {
        event.preventDefault();
        try {
          if (!notification.read_at) {
            const result = await markOneRequest(notification.id);
            if (!result) return;
            markReadLocally(notification.id, result.read_at);
          }
          window.location.assign(action.href);
        } catch (error) {
          setView({ error: error.message });
        }
      });
      actions.append(link);
    }

    article.append(iconBox, content, actions);
    article.addEventListener('click', (event) => {
      if (event.target.closest('a, button') || notification.read_at) return;
      markOne(notification.id);
    });
    article.addEventListener('keydown', (event) => {
      if ((event.key === 'Enter' || event.key === ' ') && !notification.read_at) {
        event.preventDefault();
        markOne(notification.id);
      }
    });
    return article;
  }

  function createNotificationDetails(notification) {
    const details = document.createElement('div');
    details.className = 'notification-card__details';
    const title = document.createElement('h2');
    title.className = 'notification-card__title';
    title.textContent = stateTools.dedupeFacilityLabel(notification.title);
    const body = document.createElement('p');
    body.className = 'notification-card__body';
    body.textContent = stateTools.dedupeFacilityLabel(notification.body);
    details.append(title, body);
    return details;
  }

  function createNotificationCard(notification) {
    const style = stateTools.getNotificationStyle(notification);
    return createNotificationCardFrame(
      notification,
      style,
      createNotificationDetails(notification)
    );
  }

  async function markOneRequest(id) {
    const response = await fetch(`/api/v1/notifications/${encodeURIComponent(id)}/read`, {
      method: 'PATCH',
      credentials: 'same-origin',
      cache: 'no-store'
    });
    if (response.status === 401) {
      if (await window.SportBookingHeaderAuth?.redirectIfAccountLocked(response)) return null;
      loginRedirect();
      return null;
    }
    if (!response.ok) throw new Error('Không thể đánh dấu thông báo đã đọc. Hãy thử lại.');
    const result = await response.json();
    if (!result || !result.read_at) {
      throw new Error('Phản hồi đánh dấu đã đọc không hợp lệ.');
    }
    return result;
  }

  function dispatchStateChanged(detail) {
    window.dispatchEvent(new CustomEvent('notification-state-changed', { detail }));
  }

  function markReadLocally(id, readAt) {
    const notification = state.notifications.find((item) => String(item.id) === String(id));
    if (!notification || notification.read_at) return;
    notification.read_at = readAt;
    renderItems(state.notifications);
    dispatchStateChanged({ id: String(id), readAt });
  }

  async function markOne(id) {
    if (state.reading.has(String(id))) return;
    state.reading.add(String(id));
    try {
      const result = await markOneRequest(id);
      if (result) markReadLocally(id, result.read_at);
    } catch (error) {
      setView({ error: error.message });
    } finally {
      state.reading.delete(String(id));
    }
  }

  function renderItems(notifications) {
    updateUnreadCounts();
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
    const pageSize = 50;
    try {
      const fetchPage = async (page) => {
        const query = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
        const response = await fetch(`/api/v1/notifications?${query}`, {
          credentials: 'same-origin',
          cache: 'no-store'
        });
        if (response.status === 401) {
          if (await window.SportBookingHeaderAuth?.redirectIfAccountLocked(response)) return null;
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
      const firstPage = await fetchPage(1);
      if (!firstPage || requestId !== state.request) return;
      const notifications = [...firstPage.notifications];
      for (let page = 2; page <= firstPage.pagination.total_pages; page += 1) {
        const result = await fetchPage(page);
        if (!result || requestId !== state.request) return;
        notifications.push(...result.notifications);
      }
      const byId = new Map(notifications.map((item) => [item.id, item]));
      state.notifications = [...byId.values()].sort((first, second) => {
        const byCreatedAt = String(second.created_at).localeCompare(String(first.created_at));
        if (byCreatedAt !== 0) return byCreatedAt;
        const firstId = BigInt(String(first.id));
        const secondId = BigInt(String(second.id));
        return firstId < secondId ? 1 : firstId > secondId ? -1 : 0;
      });
      state.serverTime = firstPage.server_time;
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
        if (await window.SportBookingHeaderAuth?.redirectIfAccountLocked(response)) return;
        loginRedirect();
        return;
      }
      if (!response.ok) throw new Error('Không thể đánh dấu tất cả đã đọc. Hãy thử lại.');
      const readAt = new Date().toISOString();
      for (const notification of state.notifications) {
        if (!notification.read_at) notification.read_at = readAt;
      }
      renderItems(state.notifications);
      dispatchStateChanged({ readAll: true, readAt });
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
      renderItems(state.notifications);
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
  window.addEventListener('notification-state-changed', (event) => {
    const { id, readAt, readAll } = event.detail || {};
    let changed = false;
    for (const notification of state.notifications) {
      if (readAll || String(notification.id) === String(id)) {
        if (!notification.read_at) {
          notification.read_at = readAt || new Date().toISOString();
          changed = true;
        }
      }
    }
    if (changed) renderItems(state.notifications);
  });
  loadNotifications();
})();
