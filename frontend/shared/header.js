'use strict';

(() => {
  const mount = document.querySelector('[data-shared-header]');
  if (!mount) return;

  const element = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const iconPaths = {
    menu: 'M4 6h16M4 12h16M4 18h16',
    close: 'M6 6l12 12M18 6 6 18',
    notifications: 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-8 12a2 2 0 0 0 4 0',
    logout: 'M10 17l5-5-5-5m5 5H3m9-9h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-8'
  };

  function icon(name) {
    if (name === 'notifications' && window.SportBookingIcons) {
      return window.SportBookingIcons.createIcon(name, 'sb-shared-header__icon');
    }
    const pathData = iconPaths[name];
    if (!pathData) throw new Error(`Unknown shared-header icon: ${name}`);
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    svg.classList.add('sb-shared-header__icon');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '1.8');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    path.setAttribute('d', pathData);
    svg.append(path);
    return svg;
  }

  window.addEventListener('notification-state-changed', () => {
    const header = document.querySelector('.sb-shared-header');
    if (!header) return;
    const popover = document.querySelector('.sb-shared-header__popover');
    refreshHeaderNotifications(header, Boolean(popover && !popover.hidden), true);
  });

  function loginRedirect() {
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.assign(`/dang-nhap.html?returnTo=${encodeURIComponent(returnTo)}`);
  }

  function relativeNotificationTime(createdAt, serverTime) {
    const created = new Date(createdAt);
    const reference = new Date(serverTime || Date.now());
    if (!Number.isFinite(created.getTime()) || !Number.isFinite(reference.getTime())) return '';
    const minutes = Math.max(0, Math.floor((reference.getTime() - created.getTime()) / 60_000));
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

  function showNotificationError(header, message) {
    let error = header.querySelector('.sb-shared-header__error');
    if (!error) {
      error = element('p', 'sb-shared-header__error');
      error.setAttribute('role', 'alert');
      header.append(error);
    }
    error.textContent = message;
  }

  async function markQuickNotification(notification, header) {
    try {
      let readAt = notification.read_at;
      if (!notification.read_at) {
        const response = await fetch(
          `/api/v1/notifications/${encodeURIComponent(notification.id)}/read`,
          { method: 'PATCH', credentials: 'same-origin', cache: 'no-store' }
        );
        if (response.status === 401) { loginRedirect(); return; }
        if (!response.ok) throw new Error('Không thể đánh dấu thông báo đã đọc.');
        const result = await response.json();
        if (!result || !result.read_at) {
          throw new Error('Phản hồi đánh dấu đã đọc không hợp lệ.');
        }
        readAt = result.read_at;
        notification.read_at = readAt;
        window.dispatchEvent(new CustomEvent('notification-state-changed', {
          detail: { id: String(notification.id), readAt }
        }));
      }
      const action = window.SportBookingNotificationState.getNotificationAction(
        notification,
        '/thong-bao.html'
      );
      if (action) {
        window.location.assign(action.href);
      } else {
        await refreshHeaderNotifications(header, true);
      }
    } catch (error) {
      showNotificationError(header, error.message);
    }
  }

  async function refreshHeaderNotifications(header, includeList = false, force = false) {
    if (document.hidden && !force) return;
    if (notificationRequestActive) {
      notificationRefreshRequested = true;
      return;
    }
    const notification = document.querySelector('.sb-shared-header__notification');
    if (!notification) return;
    notificationRequestActive = true;
    try {
      const countResponse = await fetch('/api/v1/notifications/unread-count', {
        credentials: 'same-origin',
        cache: 'no-store'
      });
      if (countResponse.status === 401) { loginRedirect(); return; }
      if (!countResponse.ok) throw new Error('Không thể cập nhật số thông báo chưa đọc.');
      const countResult = await countResponse.json();
      const count = Number(countResult.count);
      if (!Number.isSafeInteger(count) || count < 0) {
        throw new Error('Dữ liệu số thông báo chưa đọc không hợp lệ.');
      }
      notificationServerTime = countResult.server_time;
      const badge = notification.querySelector('.sb-shared-header__notification-badge');
      badge.textContent = count > 9 ? '9+' : String(count);
      badge.hidden = count === 0;
      badge.setAttribute('aria-label', `${count} thông báo chưa đọc`);
      const pageBadge = document.querySelector('[data-notifications-unread-count]');
      if (pageBadge) {
        pageBadge.textContent = `${count} chưa đọc`;
        pageBadge.hidden = count === 0;
      }
      const unreadLabel = notification.querySelector('.sb-shared-header__popover-count');
      unreadLabel.textContent = `${count} chưa đọc`;

      if (includeList) {
        const listResponse = await fetch('/api/v1/notifications?page=1&page_size=5', {
          credentials: 'same-origin',
          cache: 'no-store'
        });
        if (listResponse.status === 401) { loginRedirect(); return; }
        if (!listResponse.ok) throw new Error('Không thể tải thông báo mới nhất.');
        const result = await listResponse.json();
        if (!Array.isArray(result.notifications)) {
          throw new Error('Dữ liệu thông báo mới nhất không hợp lệ.');
        }
        notificationItems = result.notifications.slice(0, 5);
        notificationServerTime = result.server_time || notificationServerTime;
        renderQuickNotificationList(notification, header);
      }
      header.querySelector('.sb-shared-header__error')?.remove();
    } catch (error) {
      showNotificationError(header, error.message);
      if (includeList) {
        const list = notification.querySelector('.sb-shared-header__popover-list');
        list.replaceChildren(element('p', 'sb-shared-header__popover-error', error.message));
      }
    } finally {
      notificationRequestActive = false;
      if (notificationRefreshRequested) {
        notificationRefreshRequested = false;
        const popover = document.querySelector('.sb-shared-header__popover');
        refreshHeaderNotifications(
          header,
          Boolean(popover && !popover.hidden),
          true
        );
      }
    }
  }

  function renderQuickNotificationList(notification, header) {
    const list = notification.querySelector('.sb-shared-header__popover-list');
    list.replaceChildren();
    if (notificationItems.length === 0) {
      list.append(element('p', 'sb-shared-header__empty', 'Chưa có thông báo'));
      return;
    }
    for (const item of notificationItems) {
      const style = window.SportBookingNotificationState.getNotificationStyle(item);
      const row = element(
        'button',
        `sb-shared-header__notification-item${item.read_at ? '' : ' is-unread'}`
      );
      row.type = 'button';
      row.addEventListener('click', () => markQuickNotification(item, header));
      row.style.setProperty('--notification-accent', style.borderColor);
      row.style.setProperty('--notification-card-bg', style.cardBackground);
      row.style.setProperty('--notification-unread-bg', style.unreadBackground);
      row.style.setProperty('--notification-icon-bg', style.iconBackground);
      row.style.setProperty('--notification-icon-color', style.iconColor);
      row.style.setProperty('--notification-text-color', style.textColor);
      row.style.setProperty('--notification-label-color', style.labelColor);
      const iconBox = element('span', 'sb-shared-header__notification-icon');
      iconBox.append(window.SportBookingIcons.createIcon(style.icon, 'sb-shared-header__icon'));
      const content = element('span', 'sb-shared-header__notification-content');
      const heading = element('span', 'sb-shared-header__notification-item-heading');
      const title = element(
        'span',
        'sb-shared-header__notification-title',
        window.SportBookingNotificationState.dedupeFacilityLabel(item.title)
      );
      const meta = element('span', 'sb-shared-header__notification-meta');
      meta.append(element('time', 'sb-shared-header__notification-time',
        relativeNotificationTime(item.created_at, notificationServerTime)));
      if (!item.read_at) {
        const unread = element('span', 'sb-shared-header__notification-unread');
        unread.append(
          element('span', 'sb-shared-header__notification-unread-dot'),
          element('span', '', 'Chưa đọc')
        );
        unread.firstElementChild.setAttribute('aria-hidden', 'true');
        meta.append(unread);
      }
      heading.append(title, meta);
      content.append(
        heading,
        element(
          'span',
          'sb-shared-header__notification-body',
          window.SportBookingNotificationState.dedupeFacilityLabel(item.body)
        )
      );
      row.append(iconBox, content);
      list.append(row);
    }
  }

  function startNotificationPolling(header) {
    if (document.hidden || notificationPollTimer) return;
    refreshHeaderNotifications(header, !document.querySelector('.sb-shared-header__popover')?.hidden);
    notificationPollTimer = window.setInterval(() => {
      refreshHeaderNotifications(header, !document.querySelector('.sb-shared-header__popover')?.hidden);
    }, 10_000);
  }

  function stopNotificationPolling() {
    window.clearInterval(notificationPollTimer);
    notificationPollTimer = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopNotificationPolling();
      stopPendingHoldPolling();
    }
    else {
      const header = document.querySelector('.sb-shared-header');
      if (header) {
        startNotificationPolling(header);
        startPendingHoldPolling();
      }
    }
  });

  let pendingHoldPollTimer = null;
  let pendingHoldCountdownTimer = null;
  let pendingHoldRequestActive = false;
  let pendingHoldRefreshRequested = false;
  let notificationPollTimer = null;
  let notificationRequestActive = false;
  let notificationRefreshRequested = false;
  let notificationServerTime = null;
  let notificationItems = [];

  function clearPendingHoldBanner() {
    document.querySelector('[data-pending-hold-banner]')?.remove();
    document.body.classList.remove('sb-has-pending-hold');
    window.clearInterval(pendingHoldCountdownTimer);
    pendingHoldCountdownTimer = null;
  }

  function formatPendingHoldTime(seconds) {
    const safe = Math.max(0, Math.floor(Number(seconds) || 0));
    return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
  }

  function formatPendingHoldDate(value) {
    const date = new Date(`${String(value).slice(0, 10)}T12:00:00+07:00`);
    return Number.isNaN(date.valueOf())
      ? String(value || '')
      : new Intl.DateTimeFormat('vi-VN', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        timeZone: 'Asia/Ho_Chi_Minh'
      }).format(date);
  }

  function renderPendingHoldBanner(booking) {
    clearPendingHoldBanner();
    const slots = Array.isArray(booking.slots) ? booking.slots : [];
    if (slots.length === 0 || Number(booking.remaining_seconds) <= 0) return;
    const first = slots[0];
    const last = slots[slots.length - 1];
    const ranges = `${String(first.starts_at).slice(0, 5)}–${String(last.ends_at).slice(0, 5)}`;
    const venue = window.SportBookingHeaderState.mergeVenueNames(
      first.facility_name,
      first.court_name
    );
    const countdown = element('span', 'sb-pending-hold__countdown', formatPendingHoldTime(booking.remaining_seconds));
    const bar = element('div', 'sb-pending-hold');
    bar.dataset.pendingHoldBanner = '';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Đơn đặt sân đang chờ thanh toán');
    const summary = element('p', 'sb-pending-hold__summary');
    summary.append(
      document.createTextNode(`Bạn đang giữ chỗ ${venue} (${formatPendingHoldDate(first.service_date)}, ${ranges}) - còn `),
      countdown
    );
    const actions = element('div', 'sb-pending-hold__actions');
    const continueLink = element('a', 'sb-pending-hold__continue', 'Tiếp tục thanh toán');
    continueLink.href = `/thanh-toan.html?booking_id=${encodeURIComponent(booking.booking_id || booking.id)}`;
    const cancelButton = element('button', 'sb-pending-hold__cancel', 'Hủy giữ chỗ');
    cancelButton.type = 'button';
    cancelButton.addEventListener('click', async () => {
      if (!window.confirm('Bạn muốn hủy giữ chỗ này?')) return;
      cancelButton.disabled = true;
      try {
        const response = await fetch(`/api/v1/bookings/${encodeURIComponent(booking.booking_id || booking.id)}/cancel`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({})
        });
        if (response.status === 401) { loginRedirect(); return; }
        if (response.ok || response.status === 410) {
          window.dispatchEvent(new Event('pending-booking-changed'));
          clearPendingHoldBanner();
          return;
        }
        const result = await response.json().catch(() => null);
        throw new Error(result?.error?.message || 'Không thể hủy giữ chỗ. Hãy thử lại.');
      } catch (error) {
        cancelButton.disabled = false;
        let feedback = bar.querySelector('.sb-pending-hold__error');
        if (!feedback) {
          feedback = element('p', 'sb-pending-hold__error');
          feedback.setAttribute('role', 'alert');
          bar.append(feedback);
        }
        feedback.textContent = error.message;
      }
    });
    actions.append(continueLink, cancelButton);
    bar.append(summary, actions);
    mount.after(bar);
    document.body.classList.add('sb-has-pending-hold');

    let remaining = Math.max(0, Number(booking.remaining_seconds) || 0);
    let lastTick = Date.now();
    pendingHoldCountdownTimer = window.setInterval(() => {
      const now = Date.now();
      const elapsed = Math.floor((now - lastTick) / 1000);
      if (elapsed < 1) return;
      lastTick = now;
      remaining = Math.max(0, remaining - elapsed);
      countdown.textContent = formatPendingHoldTime(remaining);
      if (remaining === 0) clearPendingHoldBanner();
    }, 1000);
  }

  async function refreshPendingHoldBanner() {
    if (!window.SportBookingHeaderState.shouldShowPendingBanner(window.location.pathname, true)) return;
    if (pendingHoldRequestActive) {
      pendingHoldRefreshRequested = true;
      return;
    }
    pendingHoldRequestActive = true;
    try {
      const response = await fetch('/api/v1/bookings/pending', { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) { loginRedirect(); return; }
      if (!response.ok) throw new Error('Không thể tải thông tin giữ chỗ.');
      const booking = await response.json();
      if (!booking || booking.status !== 'PENDING' || Number(booking.remaining_seconds) <= 0) {
        clearPendingHoldBanner();
        return;
      }
      renderPendingHoldBanner(booking);
    } catch {
      const header = document.querySelector('.sb-shared-header');
      if (header) showNotificationError(header, 'Không thể cập nhật thông tin giữ chỗ.');
    } finally {
      pendingHoldRequestActive = false;
      if (pendingHoldRefreshRequested) {
        pendingHoldRefreshRequested = false;
        refreshPendingHoldBanner();
      }
    }
  }

  function startPendingHoldPolling() {
    if (!window.SportBookingHeaderState.shouldShowPendingBanner(window.location.pathname, true)
        || document.hidden
        || pendingHoldPollTimer) return;
    refreshPendingHoldBanner();
    pendingHoldPollTimer = window.setInterval(refreshPendingHoldBanner, 10_000);
  }

  function stopPendingHoldPolling() {
    window.clearInterval(pendingHoldPollTimer);
    pendingHoldPollTimer = null;
  }

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) {
      if (window.SportBookingCurrentUser?.role === 'ADMIN') return;
      refreshPendingHoldBanner();
      const header = document.querySelector('.sb-shared-header');
      if (header) {
        startNotificationPolling(header);
        refreshHeaderNotifications(
          header,
          !document.querySelector('.sb-shared-header__popover')?.hidden,
          true
        );
        startPendingHoldPolling();
      }
    }
  });

  function render(user) {
    const isAdmin = user.role === 'ADMIN';
    const showNavigation = window.SportBookingHeaderState.shouldShowNavigation(user.role);
    const header = element('header', 'sb-shared-header');
    const inner = element('div', 'sb-shared-header__inner');
    const brandGroup = element('div', 'sb-shared-header__brand-group');
    const brand = element('a', 'sb-shared-header__brand', 'SportBooking');
    brand.href = isAdmin ? '/quan-tri-tong-quan.html' : '/trangchu-user.html';

    brandGroup.append(brand);
    if (showNavigation) {
      const menuButton = element('button', 'sb-shared-header__menu-button');
      menuButton.type = 'button';
      menuButton.setAttribute('aria-label', 'Mở menu');
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.append(icon('menu'));

      const nav = element('nav', 'sb-shared-header__nav');
      nav.setAttribute('aria-label', 'Điều hướng chính');
      const pages = [
        { label: 'Trang chủ', href: '/trangchu-user.html', paths: ['/trangchu-user.html'] },
        { label: 'Tìm sân', href: '/tim-san.html', paths: ['/tim-san.html', '/chi-tiet-san.html', '/dat-san.html'] }
      ];
      for (const item of pages) {
        const link = element('a', 'sb-shared-header__link', item.label);
        link.href = item.href;
        if (item.paths.includes(window.location.pathname)) link.setAttribute('aria-current', 'page');
        nav.append(link);
      }

      const history = element('a', 'sb-shared-header__link', 'Lịch sử đặt sân');
      history.href = '/lich-su-dat-san.html';
      if ([
        '/lich-su-dat-san.html',
        '/chi-tiet-don-dat-san.html',
        '/ve-dien-tu.html'
      ].includes(window.location.pathname)) {
        history.setAttribute('aria-current', 'page');
      }
      nav.append(history);

      for (const label of ['Tin tức thể thao']) {
        const item = element('span', 'sb-shared-header__disabled');
        item.setAttribute('aria-disabled', 'true');
        item.append(document.createTextNode(label), element('span', 'sb-shared-header__soon', 'Sắp có'));
        nav.append(item);
      }
        menuButton.addEventListener('click', () => {
          const expanded = menuButton.getAttribute('aria-expanded') === 'true';
          menuButton.setAttribute('aria-expanded', String(!expanded));
          menuButton.setAttribute('aria-label', expanded ? 'Mở menu' : 'Đóng menu');
          menuButton.replaceChildren(icon(expanded ? 'menu' : 'close'));
          nav.classList.toggle('is-open', !expanded);
        });
        brandGroup.prepend(menuButton);
        brandGroup.append(nav);
    }

    const controls = element('div', 'sb-shared-header__controls');
    let notification = null;
    if (!isAdmin) {
      notification = element('div', 'sb-shared-header__notification');
    const notificationButton = element('button', 'sb-shared-header__icon-button');
    notificationButton.type = 'button';
    notificationButton.setAttribute('aria-label', 'Thông báo');
    notificationButton.setAttribute('aria-expanded', 'false');
    notificationButton.append(icon('notifications'));
    const notificationBadge = element('span', 'sb-shared-header__notification-badge');
    notificationBadge.hidden = true;
    notificationButton.append(notificationBadge);
    const popover = element('div', 'sb-shared-header__popover');
    popover.hidden = true;
    popover.setAttribute('aria-label', 'Thông báo mới nhất');
    const popoverHeader = element('div', 'sb-shared-header__popover-header');
    const popoverTitle = element('div', 'sb-shared-header__popover-title');
    const readAll = element('button', 'sb-shared-header__read-all', 'Đã đọc tất cả');
    readAll.type = 'button';
    readAll.addEventListener('click', async () => {
      readAll.disabled = true;
      try {
        const response = await fetch('/api/v1/notifications/read-all', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store'
        });
        if (response.status === 401) { loginRedirect(); return; }
        if (!response.ok) throw new Error('Không thể đánh dấu tất cả đã đọc.');
        window.dispatchEvent(new CustomEvent('notification-state-changed', {
          detail: { readAll: true, readAt: new Date().toISOString() }
        }));
        await refreshHeaderNotifications(header, true);
      } catch (error) {
        showNotificationError(header, error.message);
      } finally {
        readAll.disabled = false;
      }
    });
    popoverHeader.append(
      popoverTitle,
      readAll
    );
    popoverTitle.append(
      element('strong', '', 'Thông báo'),
      element('span', 'sb-shared-header__popover-count', '0 chưa đọc')
    );
    const notificationList = element('div', 'sb-shared-header__popover-list');
    const viewAll = element('a', 'sb-shared-header__view-all', 'Xem tất cả thông báo');
    viewAll.href = '/thong-bao.html';
    viewAll.append(window.SportBookingIcons.createIcon('chevron_right', 'sb-shared-header__view-all-icon'));
    const popoverFooter = element('div', 'sb-shared-header__popover-footer');
    popoverFooter.append(viewAll);
    popover.append(popoverHeader, notificationList, popoverFooter);
    notificationButton.addEventListener('click', async () => {
      popover.hidden = !popover.hidden;
      notificationButton.setAttribute('aria-expanded', String(!popover.hidden));
      if (!popover.hidden) await refreshHeaderNotifications(header, true);
    });
    document.addEventListener('click', (event) => {
      if (!notification.contains(event.target) && !popover.hidden) {
        popover.hidden = true;
        notificationButton.setAttribute('aria-expanded', 'false');
      }
    });
    notification.append(notificationButton, popover);
    }

    const account = element('div', 'sb-shared-header__account');
    const identity = element(isAdmin ? 'span' : 'a', 'sb-shared-header__identity');
    if (!isAdmin) {
      identity.href = '/profile/profile.html';
      identity.setAttribute('aria-label', 'Mở hồ sơ cá nhân');
    }
    const sourceName = String(user.fullName || user.email || '').trim();
    const initials = sourceName.split(/\s+/).slice(-2).map((part) => part[0] || '').join('').toLocaleUpperCase('vi');
    identity.append(element('span', 'sb-shared-header__avatar', initials));
    const userDetails = element('span', 'sb-shared-header__user');
    userDetails.append(
      element('span', 'sb-shared-header__name', user.fullName || user.email || '')
    );
    if (!isAdmin) userDetails.append(element('span', 'sb-shared-header__role', 'Người chơi'));
    identity.append(userDetails);
    if (isAdmin) {
      identity.append(element('span', 'sb-shared-header__role sb-shared-header__admin-role', 'Quản trị viên'));
    }

    const logout = element('button', 'sb-shared-header__logout');
    logout.type = 'button';
    logout.setAttribute('aria-label', 'Đăng xuất');
    logout.append(icon('logout'), element('span', 'sb-shared-header__logout-label', 'Đăng xuất'));
    logout.addEventListener('click', async () => {
      logout.disabled = true;
      try {
        const response = await fetch('/api/v1/auth/logout', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store'
        });
        if (response.status === 401) {
          loginRedirect();
          return;
        }
        if (!response.ok && response.status !== 204) throw new Error('Đăng xuất không thành công.');
        window.location.assign('/dang-nhap.html');
      } catch {
        logout.disabled = false;
        let error = header.querySelector('.sb-shared-header__error');
        if (!error) {
          error = element('p', 'sb-shared-header__error');
          error.setAttribute('role', 'alert');
          header.append(error);
        }
        error.textContent = 'Không thể đăng xuất. Vui lòng thử lại.';
      }
    });
    account.append(identity, logout);
    if (notification) controls.append(notification);
    controls.append(account);
    inner.append(brandGroup, controls);
    header.append(inner);
    mount.replaceChildren(header);
    if (!isAdmin) startNotificationPolling(header);
    if (!isAdmin
        && window.SportBookingHeaderState.shouldShowPendingBanner(window.location.pathname, true)) {
      startPendingHoldPolling();
    }
    if (!isAdmin) window.SportBookingHeaderState.subscribePendingBookingChanged(
      window,
      refreshPendingHoldBanner,
      () => {
        const currentHeader = document.querySelector('.sb-shared-header');
        if (!currentHeader) return;
        const currentPopover = document.querySelector('.sb-shared-header__popover');
        refreshHeaderNotifications(
          currentHeader,
          Boolean(currentPopover && !currentPopover.hidden),
          true
        );
      }
    );
  }

  function initializeHeader() {
    return fetch('/api/v1/auth/me', { credentials: 'same-origin', cache: 'no-store' })
      .then(async (response) => {
        if (response.status === 401) {
          loginRedirect();
          return null;
        }
        if (!response.ok) throw new Error('Không thể tải thông tin tài khoản.');
        const result = await response.json();
        if (!result?.user) throw new Error('Không thể tải thông tin tài khoản.');
        render(result.user);
        window.SportBookingCurrentUser = result.user;
        window.dispatchEvent(new CustomEvent('sportbooking:user-ready', { detail: result.user }));
        return result.user;
      })
      .catch(() => {
        const message = element('p', 'sb-shared-header__error', 'Không thể tải thông tin tài khoản. Hãy tải lại trang.');
        message.setAttribute('role', 'alert');
        mount.replaceChildren(message);
        return null;
      });
  }

  window.SportBookingHeaderReady = new Promise((resolve) => {
    if (window.SportBookingNotificationState) {
      initializeHeader().then(resolve);
      return;
    }
    const script = document.createElement('script');
    script.src = '/notifications/notifications-state.js';
    script.onload = () => initializeHeader().then(resolve);
    script.onerror = () => {
      const message = element('p', 'sb-shared-header__error', 'Không thể tải thông báo. Hãy tải lại trang.');
      message.setAttribute('role', 'alert');
      mount.replaceChildren(message);
      resolve(null);
    };
    document.head.append(script);
  });
})();
