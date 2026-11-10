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

  function loginRedirect() {
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.assign(`/dang-nhap.html?returnTo=${encodeURIComponent(returnTo)}`);
  }

  let pendingHoldPollTimer = null;
  let pendingHoldCountdownTimer = null;
  let pendingHoldRequestActive = false;

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
    const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
    return Number.isNaN(date.valueOf())
      ? String(value || '')
      : new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(date);
  }

  function renderPendingHoldBanner(booking) {
    clearPendingHoldBanner();
    const slots = Array.isArray(booking.slots) ? booking.slots : [];
    if (slots.length === 0 || Number(booking.remaining_seconds) <= 0) return;
    const first = slots[0];
    const ranges = slots.map((slot) => `${String(slot.starts_at).slice(0, 5)}–${String(slot.ends_at).slice(0, 5)}`).join(', ');
    const venue = [first.facility_name, first.court_name].filter(Boolean).join(' — ');
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
      cancelButton.disabled = true;
      try {
        const response = await fetch(`/api/v1/bookings/${encodeURIComponent(booking.booking_id || booking.id)}/cancel`, {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({})
        });
        if (response.status === 401) { loginRedirect(); return; }
        if (response.ok || response.status === 410) { clearPendingHoldBanner(); return; }
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
    }, 250);
  }

  async function refreshPendingHoldBanner() {
    if ([
      '/thanh-toan.html',
      '/dat-san.html',
      '/lich-su-dat-san.html',
      '/chi-tiet-don-dat-san.html'
    ].includes(window.location.pathname) || pendingHoldRequestActive) return;
    pendingHoldRequestActive = true;
    try {
      const response = await fetch('/api/v1/bookings/pending', { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) { loginRedirect(); return; }
      if (!response.ok) return;
      const booking = await response.json();
      if (!booking || booking.status !== 'PENDING' || Number(booking.remaining_seconds) <= 0) {
        clearPendingHoldBanner();
        return;
      }
      renderPendingHoldBanner(booking);
    } catch {
      // Keep the current banner if a background refresh briefly fails.
    } finally {
      pendingHoldRequestActive = false;
    }
  }

  window.addEventListener('pageshow', (event) => {
    if (event.persisted) refreshPendingHoldBanner();
  });

  function render(user) {
    const header = element('header', 'sb-shared-header');
    const inner = element('div', 'sb-shared-header__inner');
    const brandGroup = element('div', 'sb-shared-header__brand-group');
    const brand = element('a', 'sb-shared-header__brand', 'SportBooking');
    brand.href = '/trangchu-user.html';

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
    if (['/lich-su-dat-san.html', '/chi-tiet-don-dat-san.html'].includes(window.location.pathname)) {
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
    brandGroup.append(menuButton, brand, nav);

    const controls = element('div', 'sb-shared-header__controls');
    const notification = element('div', 'sb-shared-header__notification');
    const notificationButton = element('button', 'sb-shared-header__icon-button');
    notificationButton.type = 'button';
    notificationButton.setAttribute('aria-label', 'Thông báo');
    notificationButton.setAttribute('aria-expanded', 'false');
    notificationButton.append(icon('notifications'));
    const popover = element('div', 'sb-shared-header__popover');
    popover.hidden = true;
    popover.setAttribute('role', 'status');
    popover.append(element('p', 'sb-shared-header__empty', 'Chưa có thông báo'));
    const readAll = element('button', 'sb-shared-header__read-all', 'Đã đọc tất cả');
    readAll.type = 'button';
    readAll.disabled = true;
    readAll.setAttribute('aria-disabled', 'true');
    popover.append(readAll);
    notificationButton.addEventListener('click', () => {
      popover.hidden = !popover.hidden;
      notificationButton.setAttribute('aria-expanded', String(!popover.hidden));
    });
    notification.append(notificationButton, popover);

    const account = element('div', 'sb-shared-header__account');
    const identity = element('a', 'sb-shared-header__identity');
    identity.href = '/profile/profile.html';
    identity.setAttribute('aria-label', 'Mở hồ sơ cá nhân');
    const sourceName = String(user.fullName || user.email || '').trim();
    const initials = sourceName.split(/\s+/).slice(-2).map((part) => part[0] || '').join('').toLocaleUpperCase('vi');
    identity.append(element('span', 'sb-shared-header__avatar', initials));
    const userDetails = element('span', 'sb-shared-header__user');
    userDetails.append(
      element('span', 'sb-shared-header__name', user.fullName || user.email || ''),
      element('span', 'sb-shared-header__role', user.role === 'ADMIN' ? 'Quản trị viên' : 'Người chơi')
    );
    identity.append(userDetails);

    const logout = element('button', 'sb-shared-header__logout');
    logout.type = 'button';
    logout.setAttribute('aria-label', 'Đăng xuất');
    logout.append(icon('logout'), element('span', 'sb-shared-header__logout-label', 'Đăng xuất'));
    logout.addEventListener('click', async () => {
      logout.disabled = true;
      try {
        const response = await fetch('/api/v1/auth/logout', {
          method: 'POST',
          credentials: 'same-origin'
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
    controls.append(notification, account);
    inner.append(brandGroup, controls);
    header.append(inner);
    mount.replaceChildren(header);
    if (![
      '/dat-san.html',
      '/thanh-toan.html',
      '/lich-su-dat-san.html',
      '/chi-tiet-don-dat-san.html'
    ].includes(window.location.pathname)) {
      refreshPendingHoldBanner();
      pendingHoldPollTimer = window.setInterval(refreshPendingHoldBanner, 5000);
    }
  }

  window.SportBookingHeaderReady = fetch('/api/v1/auth/me', { credentials: 'same-origin' })
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
})();
