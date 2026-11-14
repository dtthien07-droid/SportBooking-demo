'use strict';

(() => {
  const state = window.SportBookingAdminState;
  const shell = window.SportBookingAdminShell;
  const api = window.SportBookingAdminApi;
  if (!state || !shell || !api) throw new Error('Thiếu cấu hình trang tổng quan quản trị.');

  shell.mountAdminShell({ active: 'overview' });
  const elements = {
    guard: document.getElementById('adminGuard'),
    guardMessage: document.getElementById('adminGuardMessage'),
    guardRetry: document.getElementById('adminGuardRetry'),
    app: document.getElementById('adminApp'),
    header: document.getElementById('adminHeaderMount'),
    range: document.getElementById('dashboardRange'),
    message: document.getElementById('dashboardMessage'),
    chart: document.getElementById('revenueChart'),
    topCourts: document.getElementById('topCourts'),
    recentBookings: document.getElementById('recentBookings'),
    manageFacilities: document.getElementById('manageFacilities')
  };
  let polling = null;
  let requestId = 0;
  let dashboardBookings = [];
  let bookingStatusFilter = '';
  let bookingSearchQuery = '';

  function element(tag, className = '', text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  elements.chart.replaceChildren(element('p', 'text-[12px] text-slate-500', 'Đang tải biểu đồ...'));
  elements.topCourts.replaceChildren(element('p', 'py-3 text-[12px] text-slate-500', 'Đang tải danh sách sân...'));
  const initialBookingRow = element('tr');
  const initialBookingCell = element('td', 'py-4 px-3 text-center text-slate-500', 'Đang tải danh sách đặt sân...');
  initialBookingCell.colSpan = 7;
  initialBookingRow.append(initialBookingCell);
  document.getElementById('mockupBookingRows')?.replaceChildren(initialBookingRow);

  function withTimeout(promise, timeoutMessage, timeoutMs = 10_000) {
    let timeoutId;
    const timeout = new Promise((resolve, reject) => {
      timeoutId = window.setTimeout(() => {
        const error = new Error(timeoutMessage);
        error.code = 'REQUEST_TIMEOUT';
        reject(error);
      }, timeoutMs);
    });
    return Promise.race([promise, timeout]).finally(() => window.clearTimeout(timeoutId));
  }

  function setDashboardError(message) {
    elements.message.dataset.kind = 'error';
    const retry = element('button', 'admin-button admin-button--quiet', 'Thử lại');
    retry.type = 'button';
    retry.addEventListener('click', () => loadDashboard());
    elements.message.replaceChildren(document.createTextNode(`${message} `), retry);
  }

  async function authorize() {
    return Boolean(await shell.authorizeAdmin({
      api,
      state,
      guard: elements.guard,
      guardMessage: elements.guardMessage,
      guardRetry: elements.guardRetry,
      app: elements.app,
      header: elements.header,
      timeoutMs: 10000
    }));
  }

  function money(value) {
    return state.formatMoney(value);
  }

  function renderChart(rows) {
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    const width = 760;
    const height = 260;
    const pad = { top: 16, right: 12, bottom: 52, left: 100 };
    const chartWidth = width - pad.left - pad.right;
    const chartHeight = height - pad.top - pad.bottom;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', String(height));
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'w-full h-auto');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Biểu đồ cột doanh thu thực thu theo ngày');
    const values = rows.map((row) => BigInt(row.net_revenue || '0'));
    const max = values.reduce((highest, value) => value > highest ? value : highest, 0n) || 1n;
    const axis = document.createElementNS(svgNs, 'line');
    axis.setAttribute('x1', String(pad.left));
    axis.setAttribute('x2', String(width - pad.right));
    axis.setAttribute('y1', String(pad.top + chartHeight));
    axis.setAttribute('y2', String(pad.top + chartHeight));
    axis.setAttribute('stroke', '#CBD5E1');
    svg.append(axis);
    for (let tick = 0; tick <= 4; tick += 1) {
      const y = pad.top + chartHeight - (chartHeight * tick / 4);
      const label = document.createElementNS(svgNs, 'text');
      label.setAttribute('x', String(pad.left - 10));
      label.setAttribute('y', String(y + 4));
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('fill', '#64748B');
      label.setAttribute('font-size', '11');
      label.textContent = money(String(max * BigInt(tick) / 4n));
      svg.append(label);
    }
    const gap = 5;
    const barWidth = rows.length ? Math.max(2, (chartWidth - gap * (rows.length - 1)) / rows.length) : 0;
    rows.forEach((row, index) => {
      const value = values[index];
      const barHeight = Number(value * 10000n / max) / 10000 * chartHeight;
      const x = pad.left + index * (barWidth + gap);
      const bar = document.createElementNS(svgNs, 'rect');
      bar.setAttribute('x', String(x));
      bar.setAttribute('y', String(pad.top + chartHeight - barHeight));
      bar.setAttribute('width', String(barWidth));
      bar.setAttribute('height', String(Math.max(value > 0n ? 2 : 0, barHeight)));
      bar.setAttribute('rx', '3');
      bar.setAttribute('fill', '#087A45');
      const tooltip = document.createElementNS(svgNs, 'title');
      tooltip.textContent = `${row.date}: ${money(row.net_revenue)}`;
      bar.append(tooltip);
      svg.append(bar);
      const dateLabel = document.createElementNS(svgNs, 'text');
      dateLabel.setAttribute('x', String(x + barWidth / 2));
      dateLabel.setAttribute('y', String(height - 22));
      dateLabel.setAttribute('text-anchor', 'middle');
      dateLabel.setAttribute('fill', '#64748B');
      dateLabel.setAttribute('font-size', '10');
      dateLabel.textContent = row.date.slice(5);
      svg.append(dateLabel);
    });
    elements.chart.replaceChildren(svg);
  }

  function renderTopCourts(courts) {
    const highlight = document.querySelector('[data-admin-top-highlight]');
    if (highlight) highlight.textContent = courts[0]?.facility_name || '—';
    const rows = courts.map((court, index) => {
      const row = element('article', 'py-3 flex items-center justify-between gap-3');
      const left = element('div', 'flex items-center gap-3 min-w-0');
      const rank = element('div',
        index === 0
          ? 'w-10 h-10 rounded-xl bg-emerald-50 border border-emerald-100 flex items-center justify-center text-primary font-bold text-[14px] flex-shrink-0'
          : 'w-10 h-10 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center text-slate-700 font-bold text-[14px] flex-shrink-0',
        `#${index + 1}`);
      const details = element('div', 'min-w-0');
      const name = element('h4', 'text-[13px] font-bold text-slate-900 truncate',
        `${court.facility_name || '—'} · ${court.court_name || '—'}`);
      const meta = element('p', 'text-[11px] text-slate-500 truncate',
        `${Number(court.booking_count) || 0} lượt đặt trong kỳ`);
      details.append(name, meta);
      left.append(rank, details);
      const summary = element('div', 'text-right flex-shrink-0');
      summary.append(
        element('div', 'text-[13px] font-bold text-primary', money(court.revenue || 0)),
        element('div', 'text-[11px] text-slate-500', 'Doanh thu')
      );
      row.append(left, summary);
      return row;
    });
    elements.topCourts.replaceChildren(...(rows.length ? rows : [
      element('p', 'py-3 text-[12px] text-slate-500', 'Chưa có dữ liệu sân trong kỳ này.')
    ]));
  }

  function renderRecentBookings(bookings) {
    const rows = bookings.map((booking) => {
      const link = element('a', 'admin-dashboard-row admin-dashboard-row--link');
      link.href = `/quan-tri.html?q=${encodeURIComponent(booking.booking_code)}`;
      link.append(
        element('span', 'admin-dashboard-row__main', booking.booking_code || '—'),
        element('span', 'admin-dashboard-row__meta',
          `${booking.owner_name || 'Khách'} · ${booking.facility_name || '—'} · ${booking.court_name || '—'}`),
        element('span', 'admin-dashboard-row__meta',
          `${booking.service_date || 'Chưa có lịch'} ${booking.starts_at?.slice(0, 5) || ''} · ${money(booking.paid_amount)}`)
      );
      return link;
    });
    elements.recentBookings.replaceChildren(...(rows.length ? rows : [element('p', 'admin-empty', 'Chưa có đơn đặt sân.')]));
    renderMockupBookings(bookings);
  }

  function renderMockupBookings(bookings) {
    const body = document.getElementById('mockupBookingRows');
    if (!body) return;
    dashboardBookings = bookings;
    const filteredBookings = dashboardBookings.filter((booking) => {
      const status = String(booking.status || booking.booking_status || '').toUpperCase();
      const query = bookingSearchQuery.trim().toLocaleLowerCase('vi');
      const matchesStatus = !bookingStatusFilter || status === bookingStatusFilter;
      const haystack = [
        booking.booking_code,
        booking.owner_name,
        booking.phone,
        booking.facility_name,
        booking.court_name
      ].filter(Boolean).join(' ').toLocaleLowerCase('vi');
      return matchesStatus && (!query || haystack.includes(query));
    });
    const range = document.querySelector('[data-admin-booking-range]');
    const total = document.querySelector('[data-admin-booking-total]');
    if (range) range.textContent = filteredBookings.length ? `1 - ${filteredBookings.length}` : '0';
    if (total) total.textContent = String(dashboardBookings.length);
    document.querySelectorAll('[data-admin-booking-page]').forEach((control) => {
      const page = control.dataset.adminBookingPage;
      control.hidden = page === 'unused';
      if (page === 'previous' || page === 'next' || page === 'current') control.disabled = true;
    });
    const rows = filteredBookings.map((booking) => {
      const row = element('tr', 'hover:bg-slate-50/80 transition-colors');
      const customer = booking.owner_name || 'Khách';
      const facility = booking.facility_name || '—';
      const court = booking.court_name || '—';
      const date = booking.service_date || 'Chưa có lịch';
      const time = [booking.starts_at, booking.ends_at]
        .filter(Boolean)
        .map((value) => value.slice(0, 5))
        .join(' - ');
      const status = String(booking.status || booking.booking_status || '').toUpperCase();
      const statusLabels = {
        PENDING: 'Chờ xác nhận',
        CONFIRMED: 'Đã xác nhận',
        CANCELLED: 'Đã hủy',
        COMPLETED: 'Hoàn thành',
        REJECTED: 'Từ chối'
      };
      const statusStyle = {
        PENDING: 'bg-amber-50 text-amber-800 border-amber-200',
        CONFIRMED: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        CANCELLED: 'bg-slate-100 text-slate-700 border-slate-200',
        COMPLETED: 'bg-slate-100 text-slate-700 border-slate-200',
        REJECTED: 'bg-rose-50 text-rose-700 border-rose-200'
      };
      const codeCell = element('td', 'py-3 px-3 font-semibold text-slate-900 font-mono text-[12px]',
        booking.booking_code || '—');
      codeCell.classList.add('max-w-[150px]', 'truncate');
      const customerCell = element('td', 'py-3 px-3');
      const customerBox = element('div', 'min-w-0');
      customerBox.append(
        element('div', 'font-bold text-slate-900 text-[13px] truncate', customer),
        element('div', 'text-[11px] text-slate-400 truncate', booking.phone || '—')
      );
      customerCell.append(customerBox);
      const facilityCell = element('td', 'py-3 px-3');
      facilityCell.append(
        element('div', 'font-medium text-slate-900 text-[13px] truncate', facility),
        element('div', 'text-[11px] text-slate-500 truncate', court)
      );
      const timeCell = element('td', 'py-3 px-3');
      timeCell.append(
        element('div', 'font-semibold text-slate-900 text-[12px]', time || '—'),
        element('div', 'text-[11px] text-slate-500 font-medium', date)
      );
      const paymentValue = Number(booking.paid_amount) || 0;
      const paymentCell = element('td', 'py-3 px-3 text-right');
      paymentCell.append(
        element('div', 'font-bold text-slate-900 text-[13px]', money(booking.paid_amount || 0)),
        element('span', 'text-[10px] text-slate-600 font-semibold bg-slate-100 px-1.5 py-0.5 rounded',
          paymentValue > 0 ? 'Đã ghi nhận' : 'Chưa ghi nhận')
      );
      const statusCell = element('td', 'py-3 px-3 text-center');
      const statusBadge = element('span',
        `inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border ${statusStyle[status] || 'bg-slate-100 text-slate-700 border-slate-200'}`,
        statusLabels[status] || status || '—');
      statusBadge.prepend(element('span', 'w-1.5 h-1.5 rounded-full bg-current'));
      statusCell.append(statusBadge);
      const action = element('td', 'py-3 px-3 text-right');
      const actionButton = element('button',
        'px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-semibold',
        'Chi tiết');
      actionButton.type = 'button';
      actionButton.disabled = !booking.booking_code;
      actionButton.title = booking.booking_code
        ? `Mở đơn ${booking.booking_code}`
        : 'Không có mã đơn để tra cứu';
      actionButton.addEventListener('click', () => {
        if (booking.booking_code) {
          window.location.assign(`/quan-tri.html?q=${encodeURIComponent(booking.booking_code)}`);
        }
      });
      action.append(actionButton);
      row.append(codeCell, customerCell, facilityCell, timeCell, paymentCell, statusCell, action);
      return row;
    });
    if (!rows.length) {
      const row = element('tr');
      const cell = element('td', 'py-4 px-3 text-center text-slate-500',
        dashboardBookings.length ? 'Không có đơn đặt sân phù hợp.' : 'Chưa có đơn đặt sân.');
      cell.colSpan = 7;
      row.append(cell);
      rows.push(row);
    }
    body.replaceChildren(...rows);
  }

  async function loadDashboard(isPolling = false) {
    const currentRequest = ++requestId;
    try {
      const result = await withTimeout(
        api.getDashboard(elements.range.value),
        'Quá thời gian tải số liệu (10 giây). Vui lòng thử lại.'
      );
      if (currentRequest !== requestId) return;
      if (!result.kpis || !Array.isArray(result.revenue_by_day)
        || !Array.isArray(result.top_courts) || !Array.isArray(result.recent_bookings)) {
        throw new Error('Dữ liệu tổng quan không hợp lệ.');
      }
      const metrics = result.kpis;
      for (const [key, value] of Object.entries(metrics)) {
        const target = document.querySelector(`[data-kpi="${key}"]`);
        if (target) target.textContent = key === 'net_revenue'
          ? money(value)
          : key === 'fill_rate_percent' ? `${Number(value) || 0}%` : String(Number(value) || 0);
        const mockupTarget = document.querySelector(`[data-admin-kpi="${key}"]`);
        if (mockupTarget) mockupTarget.textContent = key === 'net_revenue'
          ? money(value)
          : key === 'fill_rate_percent' ? `${Number(value) || 0}%` : String(Number(value) || 0);
      }
      renderChart(result.revenue_by_day || []);
      renderTopCourts(result.top_courts || []);
      renderRecentBookings(result.recent_bookings || []);
      const revenueTotal = result.revenue_by_day.reduce(
        (sum, row) => sum + BigInt(row.net_revenue || '0'),
        0n
      );
      const revenueLabel = document.querySelector('[data-admin-revenue-total]');
      if (revenueLabel) revenueLabel.textContent = money(String(revenueTotal));
      elements.message.dataset.kind = '';
      elements.message.textContent = `Dữ liệu ${result.range.from} – ${result.range.to}`;
    } catch (error) {
      if (error.status === 401) window.location.replace('/dang-nhap.html');
      else if (error.status === 403) window.location.replace(state.USER_HOME);
      else {
        setDashboardError(error.code === 'REQUEST_TIMEOUT'
          ? error.message
          : 'Không thể tải số liệu. Vui lòng thử lại.');
      }
      if (isPolling) throw error;
    }
  }

  async function initialize() {
    if (!await authorize()) return;
    await loadDashboard();
    polling = shell.startPolling(async ({ signal }) => {
      api.setPollingSignal(signal);
      try {
        await loadDashboard(true);
      } finally {
        api.setPollingSignal(null);
      }
    }, 5000, (status) => shell.mountSyncStatus(elements.message.parentElement, status));
  }

  elements.range.addEventListener('change', () => {
    api.clearCache();
    if (polling) polling.refreshNow();
    else loadDashboard();
  });
  document.querySelectorAll('[data-admin-range]').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelectorAll('[data-admin-range]').forEach((item) => {
        item.className = item === button
          ? 'px-3.5 py-1.5 rounded-lg bg-white text-slate-900 font-semibold text-[12px] shadow-sm transition-all'
          : 'px-3.5 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 font-medium text-[12px] transition-all';
      });
      elements.range.value = button.dataset.adminRange;
      elements.range.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  document.querySelectorAll('[data-admin-booking-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      bookingStatusFilter = button.dataset.adminBookingFilter || '';
      document.querySelectorAll('[data-admin-booking-filter]').forEach((item) => {
        item.className = item === button
          ? 'px-3 py-1 rounded-lg bg-white text-slate-900 font-semibold shadow-sm'
          : 'px-3 py-1 rounded-lg text-slate-600 hover:text-slate-900 font-medium';
      });
      renderMockupBookings(dashboardBookings);
    });
  });
  document.getElementById('dashboardBookingSearch')?.addEventListener('input', (event) => {
    bookingSearchQuery = event.currentTarget.value;
    renderMockupBookings(dashboardBookings);
  });
  elements.manageFacilities?.addEventListener('click', () => {
    window.location.assign('/quan-tri-san.html');
  });
  elements.guardRetry.addEventListener('click', initialize);
  window.addEventListener('admin-data-changed', () => polling?.refreshNow());
  window.addEventListener('pagehide', () => polling?.stop(), { once: true });
  window.SportBookingIcons?.renderAll(document);
  initialize();
})();
