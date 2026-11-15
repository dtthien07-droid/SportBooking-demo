'use strict';

(() => {
  const state = window.SportBookingAdminState;
  if (!state) throw new Error('Admin state helpers are not available.');

  const guard = document.getElementById('adminGuard');
  const guardMessage = document.getElementById('adminGuardMessage');
  const guardReturn = document.getElementById('adminGuardReturn');
  const guardRetry = document.getElementById('adminGuardRetry');
  const app = document.getElementById('adminApp');
  const headerMount = document.getElementById('adminHeaderMount');
  const notice = document.getElementById('adminNotice');
  const dashboardMessage = document.getElementById('dashboardMessage');
  const periodSelect = document.getElementById('dashboardPeriod');
  const statusFilter = document.getElementById('statusFilter');
  const searchInput = document.getElementById('bookingSearch');
  const rows = document.getElementById('bookingRows');
  const paginationSummary = document.getElementById('paginationSummary');
  const previousPage = document.getElementById('previousPage');
  const nextPage = document.getElementById('nextPage');
  const pageSize = 10;
  const listState = { page: 1, totalPages: 1, query: '', status: '' };
  let incidentDialog = null;
  let searchTimer = null;
  let bookingsRequestId = 0;
  let dashboardRequestId = 0;

  function addScript(source) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = source;
      script.onload = resolve;
      script.onerror = () => reject(new Error('SCRIPT_LOAD_FAILED'));
      document.head.append(script);
    });
  }

  async function loadSharedHeader() {
    const response = await fetch('/shared/header.css', {
      credentials: 'same-origin',
      cache: 'no-store'
    });
    if (!response.ok) throw new Error('HEADER_STYLE_LOAD_FAILED');
    const source = await response.text();
    const localStyles = source
      .replace(/^\s*@import\s+url\(['"][^'"]+['"]\);\s*/, '')
      .replace(/^(?:<<<<<<<.*|=======|>>>>>>>.*)\r?$/gm, '');
    const style = document.createElement('style');
    style.textContent = localStyles;
    document.head.append(style);

    headerMount.setAttribute('data-shared-header', '');
    if (!window.SportBookingIcons) throw new Error('SHARED_ICONS_UNAVAILABLE');
    await addScript('/shared/header-state.js');
    await addScript('/shared/header.js');
    if (window.SportBookingHeaderReady) await window.SportBookingHeaderReady;
  }

  async function requestJson(url, options = {}) {
    const response = await fetch(url, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(options.body ? { 'Content-Type': 'application/json' } : {})
      }
    });
    let result;
    try {
      result = await response.json();
    } catch {
      result = null;
    }
    if (!response.ok) {
      const error = new Error(result?.error?.message || 'Yêu cầu chưa thể hoàn tất.');
      error.status = response.status;
      error.code = result?.error?.code || result?.code;
      throw error;
    }
    if (!result || typeof result !== 'object') throw new Error('INVALID_RESPONSE');
    return result;
  }

  function errorMessage(error, action) {
    if (error?.status === 401) return 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.';
    if (error?.status === 403) return 'Bạn không có quyền thực hiện thao tác này.';
    if (error?.status === 404) return 'Không tìm thấy đơn đặt sân.';
    if (error?.status === 409) {
      return 'Đơn đã thay đổi hoặc đã được xử lý. Danh sách và số liệu đã được tải lại.';
    }
    if (error?.status === 400) return 'Thông tin chưa hợp lệ. Vui lòng kiểm tra và thử lại.';
    return action === 'dashboard'
      ? 'Không thể tải số liệu. Vui lòng thử lại.'
      : 'Không thể tải danh sách đơn. Vui lòng thử lại.';
  }

  function showNotice(message, kind = 'info') {
    notice.hidden = false;
    notice.dataset.kind = kind;
    notice.textContent = message;
  }

  function showGuardMessage(message, options = {}) {
    guard.hidden = false;
    guardMessage.textContent = message;
    guardReturn.hidden = !options.showHome;
    guardRetry.hidden = !options.retry;
  }

  function redirectToLogin() {
    window.location.replace(state.getAdminAccessDestination(false));
  }

  function denyUser() {
    showGuardMessage('Bạn không có quyền truy cập', { showHome: true });
    window.setTimeout(() => {
      window.location.replace(state.getAdminAccessDestination(true));
    }, 1400);
  }

  function setMetric(name, value, isMoney = false) {
    const target = document.querySelector(`[data-metric="${name}"]`);
    if (!target) return;
    target.textContent = isMoney ? state.formatMoney(value) : String(value ?? 0);
  }

  function setDashboardError(message) {
    dashboardMessage.dataset.kind = 'error';
    dashboardMessage.replaceChildren(document.createTextNode(`${message} `));
    const retry = makeElement('button', 'admin-button admin-button--quiet', 'Thử lại');
    retry.type = 'button';
    retry.addEventListener('click', loadDashboard);
    dashboardMessage.append(retry);
  }

  async function loadDashboard() {
    const requestId = ++dashboardRequestId;
    dashboardMessage.dataset.kind = 'info';
    dashboardMessage.textContent = 'Đang tải số liệu...';
    try {
      const result = await requestJson(
        `/api/v1/admin/dashboard?period=${encodeURIComponent(periodSelect.value)}`
      );
      if (requestId !== dashboardRequestId) return;
      setMetric('new_bookings', result.new_bookings);
      setMetric('net_revenue', result.net_revenue, true);
      setMetric('cancelled_bookings', result.cancelled_bookings);
      setMetric('completed_bookings', result.completed_bookings);
      dashboardMessage.textContent = '';
    } catch (error) {
      if (error?.status === 401) {
        redirectToLogin();
        return;
      }
      if (requestId !== dashboardRequestId) return;
      setDashboardError(errorMessage(error, 'dashboard'));
    }
  }

  function makeElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function addCell(row, primary, secondary) {
    const cell = document.createElement('td');
    const primaryText = makeElement('span', 'admin-table__primary', primary);
    cell.append(primaryText);
    if (secondary) cell.append(makeElement('span', 'admin-table__secondary', secondary));
    row.append(cell);
    return cell;
  }

  function formatDate(value) {
    const dateText = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) return '--';
    return new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'Asia/Ho_Chi_Minh'
    }).format(new Date(`${dateText}T12:00:00+07:00`));
  }

  function formatTime(value) {
    const time = String(value || '');
    return /^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : '--:--';
  }

  function bookingSchedule(booking) {
    if (!Array.isArray(booking.slots) || booking.slots.length === 0) return '--';
    return booking.slots.map((slot) => (
      `${formatDate(slot.service_date)} · ${formatTime(slot.starts_at)}–${formatTime(slot.ends_at)}`
    )).join(', ');
  }

  function facilityNames(booking) {
    if (!Array.isArray(booking.slots) || booking.slots.length === 0) return 'Chưa có thông tin sân';
    const names = booking.slots.map((slot) => {
      const facility = String(slot.facility_name || '').trim();
      const court = String(slot.court_name || '').trim();
      if (facility && court && facility.toLocaleLowerCase('vi') !== court.toLocaleLowerCase('vi')) {
        return `${facility} · ${court}`;
      }
      return facility || court || 'Chưa có thông tin sân';
    });
    return [...new Set(names)].join(', ');
  }

  function appendEmptyState(message, retryAction) {
    const row = document.createElement('tr');
    const cell = makeElement('td', 'admin-empty', message);
    cell.colSpan = 7;
    if (retryAction) {
      const button = makeElement('button', 'admin-button admin-button--quiet', 'Thử lại');
      button.type = 'button';
      button.addEventListener('click', retryAction);
      cell.append(document.createTextNode(' '), button);
    }
    row.append(cell);
    rows.replaceChildren(row);
  }

  function renderBooking(booking) {
    const row = document.createElement('tr');
    addCell(row, booking.booking_code || '--', `Đơn tạo ${formatDate(booking.created_at)}`);

    const owner = booking.owner || {};
    addCell(row, owner.full_name || 'Chưa cập nhật', owner.email || owner.phone || '');
    addCell(row, facilityNames(booking));
    addCell(row, bookingSchedule(booking));

    const statusCell = document.createElement('td');
    const displayStatus = state.getDisplayStatus(booking);
    const statusModifier = {
      PENDING: 'pending',
      UPCOMING: 'confirmed',
      IN_PROGRESS: 'confirmed',
      COMPLETED: 'completed',
      EXPIRED: 'expired',
      CANCELLED: 'cancelled'
    }[displayStatus] || 'unknown';
    const status = makeElement('span', `admin-status admin-status--${statusModifier}`,
      state.getBookingStatusLabel(displayStatus));
    statusCell.append(status);
    row.append(statusCell);

    addCell(row, state.formatMoney(booking.paid_amount ?? '0'));
    const actions = document.createElement('td');
    if (booking.can_cancel_incident) {
      const cancel = makeElement('button', 'admin-button admin-button--danger admin-table__cancel', 'Hủy do sự cố');
      cancel.type = 'button';
      cancel.addEventListener('click', () => openCancellation(booking, cancel));
      actions.append(cancel);
    } else {
      actions.textContent = '—';
    }
    row.append(actions);
    return row;
  }

  function renderBookings(result) {
    const bookings = Array.isArray(result.bookings) ? result.bookings : [];
    listState.totalPages = Math.max(1, Number(result.pagination?.total_pages) || 1);
    listState.page = Math.min(listState.page, listState.totalPages);
    paginationSummary.textContent = `Trang ${listState.page}/${listState.totalPages} · ${Number(result.pagination?.total) || 0} đơn`;
    previousPage.disabled = listState.page <= 1;
    nextPage.disabled = listState.page >= listState.totalPages;

    if (bookings.length === 0) {
      appendEmptyState('Chưa có đơn nào phù hợp. Hãy thay đổi bộ lọc hoặc từ khóa.');
      return;
    }
    rows.replaceChildren(...bookings.map(renderBooking));
  }

  async function loadBookings() {
    const requestId = ++bookingsRequestId;
    appendEmptyState('Đang tải danh sách đơn...');
    paginationSummary.textContent = 'Đang tải...';
    previousPage.disabled = true;
    nextPage.disabled = true;

    const params = new URLSearchParams({
      page: String(listState.page),
      page_size: String(pageSize)
    });
    if (listState.status) params.set('status', listState.status);
    if (listState.query) params.set('q', listState.query);

    try {
      const result = await requestJson(`/api/v1/admin/bookings?${params.toString()}`);
      if (requestId !== bookingsRequestId) return;
      renderBookings(result);
    } catch (error) {
      if (error?.status === 401) {
        redirectToLogin();
        return;
      }
      if (requestId !== bookingsRequestId) return;
      appendEmptyState(errorMessage(error, 'bookings'), loadBookings);
      paginationSummary.textContent = 'Không thể tải danh sách.';
    }
  }

  function loadAll() {
    return Promise.all([loadDashboard(), loadBookings()]);
  }

  function openCancellation(booking, trigger) {
    incidentDialog?.open(booking, trigger);
  }

  async function authorize() {
    guardRetry.hidden = true;
    guardMessage.textContent = 'Đang kiểm tra quyền truy cập...';
    try {
      const result = await requestJson('/api/v1/auth/me');
      if (result.user?.role !== 'ADMIN') {
        denyUser();
        return false;
      }
      return true;
    } catch (error) {
      if (error?.status === 401) {
        redirectToLogin();
        return false;
      }
      showGuardMessage('Không thể xác minh quyền truy cập. Vui lòng thử lại.', { retry: true });
      return false;
    }
  }

  async function initialize() {
    const authorized = await authorize();
    if (!authorized) return;
    try {
      await loadSharedHeader();
    } catch {
      showGuardMessage('Không thể tải giao diện quản trị. Vui lòng thử lại.', { retry: true });
      return;
    }
    guard.hidden = true;
    app.hidden = false;
    await loadAll();
  }

  periodSelect.addEventListener('change', loadDashboard);
  statusFilter.addEventListener('change', () => {
    listState.status = statusFilter.value;
    listState.page = 1;
    loadBookings();
  });
  searchInput.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      listState.query = searchInput.value.trim();
      listState.page = 1;
      loadBookings();
    }, 300);
  });
  previousPage.addEventListener('click', () => {
    if (listState.page <= 1) return;
    listState.page -= 1;
    loadBookings();
  });
  nextPage.addEventListener('click', () => {
    if (listState.page >= listState.totalPages) return;
    listState.page += 1;
    loadBookings();
  });
  incidentDialog = window.SportBookingIncidentCancelDialog.mount({
    document,
    onSubmit: (booking, reason) => requestJson(
      `/api/v1/admin/bookings/${encodeURIComponent(booking.booking_id)}/incident-cancellation`,
      { method: 'POST', body: JSON.stringify({ cancellation_reason: reason }) }
    ),
    onError: async (error) => {
      if (error?.status === 401) {
        redirectToLogin();
        return true;
      }
      if (error?.status === 409) {
        showNotice(errorMessage(error), 'error');
        await loadAll();
      }
      return false;
    },
    onSuccess: async (result, booking) => {
      showNotice(`Đã hủy đơn ${booking.booking_code}. Hoàn ${state.formatMoney(result.refunded_amount)}.`, 'success');
      await loadAll();
    }
  });
  guardRetry.addEventListener('click', initialize);
  initialize();
})();
