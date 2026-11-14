'use strict';

(function exposeAdminShell(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SportBookingAdminShell = api;
}(typeof window === 'undefined' ? null : window, () => {
  const NAVIGATION = Object.freeze([
    { key: 'overview', label: 'Tổng quan', href: '/quan-tri-tong-quan.html', icon: 'grid_view' },
    { key: 'bookings', label: 'Đơn đặt sân', href: '/quan-tri.html', icon: 'event_available' },
    { key: 'users', label: 'Người dùng', href: '/quan-tri-nguoi-dung.html', icon: 'group_add' },
    { key: 'facilities', label: 'Cơ sở & Sân', href: '/quan-tri-san.html', icon: 'stadium' },
    { key: 'slots', label: 'Khung giờ & Giá', href: '/quan-tri-khung-gio-gia.html', icon: 'schedule' }
  ]);
  const RETRY_DELAYS = Object.freeze([10000, 20000, 30000]);

  function getRetryDelay(failures) {
    if (!Number.isInteger(failures) || failures <= 0) return 5000;
    return RETRY_DELAYS[Math.min(failures - 1, RETRY_DELAYS.length - 1)];
  }

  function mountAdminShell({ active, document: pageDocument = globalThis.document } = {}) {
    if (!pageDocument) throw new TypeError('Cần tài liệu trang quản trị.');
    const header = pageDocument.querySelector('[data-shared-header]') || pageDocument.getElementById('adminHeaderMount');
    header?.setAttribute('data-shared-header', '');
    pageDocument.querySelectorAll('.admin-main--mockup button').forEach((button) => {
      if (!button.textContent.includes('Sắp có')) return;
      button.disabled = true;
      button.setAttribute('aria-disabled', 'true');
    });
    const navigation = pageDocument.querySelector('[data-admin-sidebar]');
    if (!navigation) return;
    const list = pageDocument.createElement('ul');
    list.className = 'admin-sidebar__list';
    for (const item of NAVIGATION) {
      const row = pageDocument.createElement('li');
      const link = pageDocument.createElement('a');
      link.className = `admin-sidebar__link${active === item.key ? ' is-active' : ''}`;
      link.href = item.href;
      link.dataset.adminNav = item.key;
      if (active === item.key) link.setAttribute('aria-current', 'page');
      const icon = pageDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.classList.add('admin-sidebar__icon');
      icon.setAttribute('data-sb-icon', item.icon);
      icon.setAttribute('aria-hidden', 'true');
      const label = pageDocument.createElement('span');
      label.textContent = item.label;
      link.append(icon, label);
      row.append(link);
      list.append(row);
    }

    const settingRow = pageDocument.createElement('li');
    const disabled = pageDocument.createElement('span');
    disabled.className = 'admin-sidebar__link is-disabled';
    disabled.setAttribute('aria-disabled', 'true');
    const settingIcon = pageDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    settingIcon.classList.add('admin-sidebar__icon');
    settingIcon.setAttribute('data-sb-icon', 'tune');
    settingIcon.setAttribute('aria-hidden', 'true');
    const settingLabel = pageDocument.createElement('span');
    settingLabel.textContent = 'Cài đặt hệ thống';
    const soon = pageDocument.createElement('span');
    soon.className = 'admin-sidebar__soon';
    soon.textContent = 'Sắp có';
    disabled.append(settingIcon, settingLabel, soon);
    settingRow.append(disabled);
    list.append(settingRow);
    navigation.replaceChildren(list);
    pageDocument.defaultView?.SportBookingIcons?.renderAll?.(navigation);
  }

  async function authorizeAdmin({
    api,
    state,
    guard,
    guardMessage,
    guardRetry,
    app,
    header,
    ensureHeader,
    timeoutMs = 10000
  } = {}) {
    if (!api?.getMe || !state?.USER_HOME || !guard || !guardMessage || !guardRetry || !app) {
      throw new TypeError('Cấu hình phân quyền quản trị không hợp lệ.');
    }
    guardRetry.hidden = true;
    guardMessage.textContent = 'Đang kiểm tra quyền truy cập...';
    let timeoutId;
    try {
      const request = api.getMe();
      const result = await Promise.race([
        request,
        new Promise((resolve, reject) => {
          timeoutId = window.setTimeout(() => {
            const error = new Error('Quá thời gian xác minh quyền truy cập. Vui lòng thử lại.');
            error.code = 'REQUEST_TIMEOUT';
            reject(error);
          }, timeoutMs);
        })
      ]);
      if (result.user?.role !== 'ADMIN') {
        window.location.replace(state.USER_HOME);
        return null;
      }
      header?.setAttribute('data-shared-header', '');
      if (ensureHeader) await ensureHeader();
      else if (window.SportBookingHeaderReady) await window.SportBookingHeaderReady;
      guard.hidden = true;
      app.hidden = false;
      return result.user;
    } catch (error) {
      if (error.status === 401) {
        const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        window.location.replace(`/dang-nhap.html?returnTo=${encodeURIComponent(returnTo)}`);
      } else if (error.status === 403) {
        window.location.replace(state.USER_HOME);
      } else {
        guardMessage.textContent = error.code === 'REQUEST_TIMEOUT'
          ? error.message
          : 'Không thể xác minh quyền truy cập. Vui lòng thử lại.';
        guardRetry.hidden = false;
      }
      return null;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  function startPolling(fn, interval = 5000, onStatus = () => {}) {
    if (typeof fn !== 'function' || !Number.isFinite(interval) || interval < 1
        || typeof onStatus !== 'function') {
      throw new TypeError('Cấu hình polling quản trị không hợp lệ.');
    }
    let active = true;
    let timeout = null;
    let controller = null;
    let running = false;
    let rerunRequested = false;
    let failures = 0;
    let lastUpdatedAt = null;

    function report(status) {
      onStatus({
        status,
        lastUpdatedAt,
        retryDelay: failures === 0 ? interval : getRetryDelay(failures)
      });
    }

    function schedule(delay) {
      if (!active || document.visibilityState === 'hidden') return;
      window.clearTimeout(timeout);
      timeout = window.setTimeout(run, delay);
    }

    async function run() {
      if (!active || running || document.visibilityState === 'hidden') return;
      running = true;
      controller = new AbortController();
      report(failures > 0 ? 'retrying' : 'syncing');
      try {
        await fn({ signal: controller.signal });
        if (!active || controller.signal.aborted) return;
        failures = 0;
        lastUpdatedAt = new Date();
        report('synced');
        schedule(interval);
      } catch (error) {
        if (controller.signal.aborted || !active) return;
        failures += 1;
        report(failures >= RETRY_DELAYS.length ? 'offline' : 'retrying');
        schedule(getRetryDelay(failures));
      } finally {
        running = false;
        controller = null;
        if (active && rerunRequested && document.visibilityState !== 'hidden') {
          rerunRequested = false;
          run();
        }
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'hidden') {
        window.clearTimeout(timeout);
        controller?.abort();
        return;
      }
      if (running) rerunRequested = true;
      else run();
    }

    document.addEventListener('visibilitychange', onVisibilityChange);
    run();
    return {
      refreshNow() {
        if (!active || document.visibilityState === 'hidden') return;
        window.clearTimeout(timeout);
        controller?.abort();
        if (running) rerunRequested = true;
        else run();
      },
      stop() {
        if (!active) return;
        active = false;
        window.clearTimeout(timeout);
        controller?.abort();
        document.removeEventListener('visibilitychange', onVisibilityChange);
      }
    };
  }

  function mountSyncStatus(container, state) {
    if (!container) return;
    let status = container.querySelector('[data-admin-sync-status]');
    if (!status) {
      status = document.createElement('p');
      status.className = 'admin-sync-status';
      status.dataset.adminSyncStatus = '';
      status.setAttribute('role', 'status');
      status.setAttribute('aria-live', 'polite');
      container.append(status);
    }
    const label = state.lastUpdatedAt
      ? `Cập nhật lúc ${new Intl.DateTimeFormat('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
        timeZone: 'Asia/Ho_Chi_Minh'
      }).format(state.lastUpdatedAt)}`
      : state.status === 'offline' ? 'Mất kết nối' : 'Đang đồng bộ';
    status.dataset.state = state.status;
    status.textContent = label;
  }

  return { authorizeAdmin, getRetryDelay, mountAdminShell, mountSyncStatus, startPolling };
}));
