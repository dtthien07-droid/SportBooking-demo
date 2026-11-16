'use strict';

(() => {
  const state = window.SportBookingAdminState;
  const shell = window.SportBookingAdminShell;
  const api = window.SportBookingAdminApi;
  const exportDownload = window.SportBookingExportDownload;
  const dashboardState = window.SportBookingDashboardState;
  const historyState = window.SportBookingHistoryState;
  if (!state || !shell || !api || !exportDownload || !dashboardState || !historyState) {
    throw new Error('Thiếu cấu hình trang tổng quan quản trị.');
  }

  shell.mountAdminShell({ active: 'overview' });
  const elements = {
    guard: document.getElementById('adminGuard'),
    guardMessage: document.getElementById('adminGuardMessage'),
    guardRetry: document.getElementById('adminGuardRetry'),
    app: document.getElementById('adminApp'),
    header: document.getElementById('adminHeaderMount'),
    range: document.getElementById('dashboardRange'),
    message: document.getElementById('dashboardMessage'),
    exportButton: document.getElementById('dashboardExport'),
    exportStatus: document.getElementById('dashboardExportStatus'),
    chart: document.getElementById('revenueChart'),
    chartTooltip: document.getElementById('revenueTooltip'),
    topCourts: document.getElementById('topCourts'),
    manageFacilities: document.getElementById('manageFacilities')
  };
  const validRanges = new Set(['today', '7d', '30d']);
  const requestedRange = new URLSearchParams(window.location.search).get('range');
  if (validRanges.has(requestedRange)) elements.range.value = requestedRange;
  let polling = null;
  let requestId = 0;
  let bookingsRequestId = 0;
  let dashboardBookings = [];
  let bookingStatusFilter = '';
  let bookingSearchQuery = '';
  let bookingPage = 1;
  let bookingTotal = 0;
  let bookingTotalPages = 0;
  let bookingPageSize = 10;
  const bookingDetailModal = document.getElementById('dashboardBookingDetailModal');
  let incidentDialog = null;
  let detailTrigger = null;

  function element(tag, className = '', text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  elements.chart?.replaceChildren(element('p', 'text-[12px] text-slate-500', 'Đang tải biểu đồ...'));
  elements.topCourts?.replaceChildren(element('p', 'py-3 text-[12px] text-slate-500', 'Đang tải danh sách sân...'));
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

  function closeBookingDetail() {
    if (!bookingDetailModal || bookingDetailModal.hidden) return;
    bookingDetailModal.hidden = true;
    document.removeEventListener('keydown', onBookingDetailKeydown);
    if (detailTrigger?.isConnected) detailTrigger.focus();
  }

  function onBookingDetailKeydown(event) {
    if (!bookingDetailModal || bookingDetailModal.hidden) return;
    if (!document.getElementById('incidentCancelModal')?.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeBookingDetail();
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = bookingDetailModal.querySelector('[role="dialog"]');
    const focusable = [...dialog.querySelectorAll('button:not([disabled]), a[href]')]
      .filter((node) => !node.hidden);
    if (!focusable.length) {
      event.preventDefault();
    } else if (event.shiftKey && document.activeElement === focusable[0]) {
      event.preventDefault();
      focusable[focusable.length - 1].focus();
    } else if (!event.shiftKey && document.activeElement === focusable[focusable.length - 1]) {
      event.preventDefault();
      focusable[0].focus();
    }
  }

  function setDetailValue(name, value) {
    const target = bookingDetailModal?.querySelector(`[data-booking-detail="${name}"]`);
    if (target) target.textContent = value || 'Chưa cập nhật';
  }

  function displayBookingStatus(booking) {
    const status = state.getDisplayStatus(booking);
    return { status, label: historyState.getBookingStatusLabel(status) };
  }

  function renderBookingDetail(booking) {
    const status = displayBookingStatus(booking);
    setDetailValue('code', booking.booking_code);
    setDetailValue('status', status.label);
    const statusBadge = bookingDetailModal.querySelector('[data-booking-detail="status"]');
    statusBadge.className = `rounded-full border px-3 py-0.5 text-xs font-semibold ${
      ({
        PENDING: 'border-amber-200 bg-amber-50 text-amber-700',
        UPCOMING: 'border-blue-200 bg-blue-50 text-blue-700',
        IN_PROGRESS: 'border-emerald-200 bg-emerald-50 text-emerald-700',
        COMPLETED: 'border-slate-200 bg-slate-100 text-slate-700',
        CANCELLED: 'border-rose-200 bg-rose-50 text-rose-700',
        EXPIRED: 'border-slate-200 bg-slate-100 text-slate-600'
      })[status.status] || 'border-slate-200 bg-slate-100 text-slate-700'
    }`;
    setDetailValue('owner', booking.owner?.full_name);
    setDetailValue('phone', booking.owner?.phone || 'Chưa cập nhật SĐT');
    setDetailValue('email', booking.owner?.email);
    setDetailValue('facility', booking.slots?.[0]?.facility_name);
    setDetailValue('court', booking.slots?.[0]?.court_name);
    setDetailValue('total', money(booking.total_amount));
    setDetailValue('paid', money(booking.paid_amount));
    setDetailValue('refunded', money(booking.refunded_amount));
    setDetailValue('payment-status', ({
      PENDING: 'Chưa thanh toán',
      PAID: 'Đã thanh toán',
      REFUNDED: 'Đã hoàn'
    })[booking.payment_status] || 'Chưa thanh toán');
    setDetailValue('payment-option', booking.payment_option === 'DEPOSIT_50'
      ? 'Đặt cọc 50%'
      : 'Thanh toán toàn bộ');
    setDetailValue('created-at', new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone: 'Asia/Ho_Chi_Minh'
    }).format(new Date(booking.created_at)));
    const slotList = bookingDetailModal.querySelector('[data-booking-detail-slots]');
    slotList.replaceChildren(...(booking.slots || []).map((slot) => element(
      'li',
      'flex items-center justify-between gap-3 border-t border-slate-200 py-2 text-sm',
      `${dashboardState.formatDate(slot.service_date)} · ${slot.starts_at.slice(0, 5)}–${slot.ends_at.slice(0, 5)}`
    )));
    const cancelled = booking.status === 'CANCELLED';
    const cancellationInfo = bookingDetailModal.querySelector('[data-booking-cancellation]');
    cancellationInfo.hidden = !cancelled;
    if (cancelled) {
      setDetailValue('cancelled-by', booking.cancelled_by === 'ADMIN' ? 'Quản trị viên' : 'Khách');
      setDetailValue('cancellation-reason', booking.cancellation_reason || 'Chưa cập nhật');
    }
    const incidentButton = bookingDetailModal.querySelector('[data-booking-detail-incident]');
    incidentButton.hidden = !booking.can_cancel_incident;
    incidentButton._booking = booking;
    bookingDetailModal.hidden = false;
    const closeButton = bookingDetailModal.querySelector('[data-booking-detail-close]');
    closeButton.focus();
  }

  async function openBookingDetail(booking, trigger) {
    if (!booking?.booking_id || !bookingDetailModal) return;
    detailTrigger = trigger;
    try {
      const result = await api.getBookingDetail(booking.booking_id);
      renderBookingDetail(result.booking);
      document.addEventListener('keydown', onBookingDetailKeydown);
    } catch (error) {
      if (error.status === 401) window.location.replace('/dang-nhap.html');
      else if (error.status === 403) window.location.replace(state.USER_HOME);
      else setDashboardError('Không thể tải chi tiết đơn. Vui lòng thử lại.');
    }
  }

  function setDashboardError(message) {
    elements.message.dataset.kind = 'error';
    elements.message.replaceChildren(document.createTextNode(`${message} `));
    const retry = element('button', 'admin-button admin-button--quiet', 'Thử lại');
    retry.type = 'button';
    retry.addEventListener('click', () => loadDashboard());
    elements.message.append(retry);
    for (const container of [elements.chart, elements.topCourts]) {
      if (!container) continue;
      const notice = element('p', 'py-3 text-[12px] text-rose-700', message);
      const button = element('button', 'admin-button admin-button--quiet', 'Thử lại');
      button.type = 'button';
      button.addEventListener('click', () => loadDashboard());
      container.replaceChildren(notice, button);
    }
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

  function syncRangeUrl() {
    const params = new URLSearchParams(window.location.search);
    params.set('range', elements.range.value);
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}?${params.toString()}${window.location.hash}`
    );
    document.querySelectorAll('[data-admin-nav="bookings"]').forEach((link) => {
      link.href = `/quan-tri.html?range=${encodeURIComponent(elements.range.value)}`;
    });
  }

  function renderRangeButtons() {
    document.querySelectorAll('[data-admin-range]').forEach((button) => {
      button.className = button.dataset.adminRange === elements.range.value
        ? 'px-3.5 py-1.5 rounded-lg bg-white text-slate-900 font-semibold text-[12px] shadow-sm transition-all'
        : 'px-3.5 py-1.5 rounded-lg text-slate-600 hover:text-slate-900 font-medium text-[12px] transition-all';
    });
  }

  function renderChart(series, period) {
    if (!elements.chart) return;
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    const pad = { top: 16, right: 12, bottom: 52, left: 84 };
    const rows = Array.isArray(series?.buckets) ? series.buckets : [];
    const labelCount = period === 'today' ? 8 : period === '7d' ? 7 : 6;
    const labelWidth = period === 'today' ? 32 : 55;
    const minWidth = pad.left + pad.right + labelCount * labelWidth;
    const width = Math.max(elements.chart.clientWidth || 760, minWidth);
    const height = 280;
    const chartWidth = width - pad.left - pad.right;
    const chartHeight = height - pad.top - pad.bottom;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'max-w-none h-auto');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', `Biểu đồ doanh thu theo ${series?.granularity === 'hour' ? 'giờ' : 'ngày'}`);
    const values = rows.map((row) => BigInt(row.net_revenue || '0'));
    const max = values.reduce((highest, value) => value > highest ? value : highest, 0n);
    if (max === 0n) {
      elements.chart.replaceChildren(element('p', 'py-8 text-center text-[12px] text-slate-500', 'Chưa có doanh thu trong kỳ'));
      return;
    }
    const ticks = dashboardState.axisTicks(max);
    const axisMax = ticks[ticks.length - 1] || max;
    const axis = document.createElementNS(svgNs, 'line');
    axis.setAttribute('x1', String(pad.left));
    axis.setAttribute('x2', String(width - pad.right));
    axis.setAttribute('y1', String(pad.top + chartHeight));
    axis.setAttribute('y2', String(pad.top + chartHeight));
    axis.setAttribute('stroke', '#CBD5E1');
    svg.append(axis);
    for (const tick of ticks) {
      const y = pad.top + chartHeight - Number(tick * 10000n / axisMax) / 10000 * chartHeight;
      const grid = document.createElementNS(svgNs, 'line');
      grid.setAttribute('x1', String(pad.left));
      grid.setAttribute('x2', String(width - pad.right));
      grid.setAttribute('y1', String(y));
      grid.setAttribute('y2', String(y));
      grid.setAttribute('stroke', '#E2E8F0');
      svg.append(grid);
      const label = document.createElementNS(svgNs, 'text');
      label.setAttribute('x', String(pad.left - 10));
      label.setAttribute('y', String(y + 4));
      label.setAttribute('text-anchor', 'end');
      label.setAttribute('fill', '#64748B');
      label.setAttribute('font-size', '11');
      label.textContent = dashboardState.formatAxisValue(tick);
      svg.append(label);
    }
    const gap = rows.length >= 24 ? 4 : 7;
    const barWidth = Math.max(4, (chartWidth - gap * (rows.length - 1)) / rows.length);
    const labelEvery = series?.granularity === 'hour' ? 3 : rows.length === 7 ? 1 : 5;
    const labelCandidates = rows.map((_, index) => index)
      .filter((index) => index % labelEvery === 0);
    const visibleLabels = new Set(dashboardState.thinLabels(labelCandidates.length, chartWidth, labelWidth)
      .map((index) => labelCandidates[index]));
    rows.forEach((row, index) => {
      const value = values[index];
      const barHeight = Number(value * 10000n / axisMax) / 10000 * chartHeight;
      const x = pad.left + index * (barWidth + gap);
      const bar = document.createElementNS(svgNs, 'rect');
      bar.setAttribute('x', String(x));
      bar.setAttribute('y', String(pad.top + chartHeight - barHeight));
      bar.setAttribute('width', String(barWidth));
      bar.setAttribute('height', String(Math.max(value > 0n ? 2 : 0, barHeight)));
      bar.setAttribute('rx', '3');
      bar.setAttribute('fill', '#087A45');
      bar.setAttribute('tabindex', '0');
      bar.setAttribute('focusable', 'true');
      bar.setAttribute('role', 'img');
      const tooltipText = dashboardState.formatBucketTooltip(row, series.granularity);
      bar.setAttribute('aria-label', tooltipText);
      const showTooltip = () => {
        if (elements.chartTooltip) {
          elements.chartTooltip.hidden = false;
          elements.chartTooltip.textContent = tooltipText;
        }
      };
      bar.addEventListener('mouseenter', showTooltip);
      bar.addEventListener('focus', showTooltip);
      bar.addEventListener('mouseleave', () => {
        if (elements.chartTooltip) elements.chartTooltip.hidden = true;
      });
      bar.addEventListener('blur', () => {
        if (elements.chartTooltip) elements.chartTooltip.hidden = true;
      });
      const tooltip = document.createElementNS(svgNs, 'title');
      tooltip.textContent = tooltipText;
      bar.append(tooltip);
      svg.append(bar);
      if (!visibleLabels.has(index)) return;
      const dateLabel = document.createElementNS(svgNs, 'text');
      dateLabel.setAttribute('x', String(x + barWidth / 2));
      dateLabel.setAttribute('y', String(height - 22));
      dateLabel.setAttribute('text-anchor', 'middle');
      dateLabel.setAttribute('fill', '#64748B');
      dateLabel.setAttribute('font-size', '11');
      const labelGranularity = period === '7d' ? 'week' : series.granularity;
      dateLabel.textContent = dashboardState.formatBucketLabel(row.start, labelGranularity);
      svg.append(dateLabel);
    });
    elements.chart.replaceChildren(svg);
  }

  function renderTopCourts(courts) {
    if (!elements.topCourts) return;
    const highlight = document.querySelector('[data-admin-top-highlight]');
    if (highlight) highlight.textContent = courts[0]?.facility_name || '';
    const highlightFooter = highlight?.parentElement?.parentElement;
    if (highlightFooter) highlightFooter.hidden = courts.length === 0;
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

  function renderBookingPagination() {
    const container = document.querySelector('[data-admin-booking-pagination]');
    if (!container) return;
    const currentPage = bookingTotalPages ? bookingPage : 0;
    const previous = element(
      'button',
      'px-2.5 py-1 rounded border border-gray-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50',
      '← Trước'
    );
    previous.type = 'button';
    previous.disabled = !bookingTotalPages || currentPage <= 1;
    previous.dataset.page = String(Math.max(1, currentPage - 1));
    const label = element('span', 'px-2 text-slate-600', `${currentPage}/${bookingTotalPages}`);
    label.setAttribute('aria-live', 'polite');
    const next = element(
      'button',
      'px-2.5 py-1 rounded border border-gray-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50',
      'Sau →'
    );
    next.type = 'button';
    next.disabled = !bookingTotalPages || currentPage >= bookingTotalPages;
    next.dataset.page = String(Math.min(bookingTotalPages || 1, currentPage + 1));
    container.replaceChildren(previous, label, next);
  }

  function renderMockupBookings() {
    const body = document.getElementById('mockupBookingRows');
    if (!body) return;
    const filteredBookings = dashboardBookings;
    const range = document.querySelector('[data-admin-booking-range]');
    const total = document.querySelector('[data-admin-booking-total]');
    const first = bookingTotal ? (bookingPage - 1) * bookingPageSize + 1 : 0;
    const last = bookingTotal
      ? Math.min(first + dashboardBookings.length - 1, bookingTotal)
      : 0;
    if (range) range.textContent = bookingTotal ? `${first} - ${last}` : '0';
    if (total) total.textContent = String(bookingTotal);
    renderBookingPagination();
    const rows = filteredBookings.map((booking) => {
      const row = element('tr', 'hover:bg-slate-50/80 transition-colors');
      const slots = Array.isArray(booking.slots) ? booking.slots : [];
      const firstSlot = slots[0];
      const lastSlot = slots[slots.length - 1];
      const customer = booking.owner?.full_name || 'Khách';
      const facility = [...new Set(slots.map((slot) => slot.facility_name).filter(Boolean))].join(', ') || '—';
      const court = [...new Set(slots.map((slot) => slot.court_name).filter(Boolean))].join(', ') || '—';
      const date = dashboardState.formatDate(firstSlot?.service_date);
      const time = [firstSlot?.starts_at, lastSlot?.ends_at]
        .filter(Boolean)
        .map((value) => value.slice(0, 5))
        .join(' - ');
      const displayStatus = dashboardState.getDisplayStatus(booking);
      const status = historyState.getBookingStatusLabel(displayStatus);
      const statusStyle = {
        PENDING: 'bg-amber-50 text-amber-800 border-amber-200',
        UPCOMING: 'bg-emerald-50 text-emerald-700 border-emerald-200',
        IN_PROGRESS: 'bg-amber-50 text-amber-800 border-amber-200',
        CANCELLED: 'bg-slate-100 text-slate-700 border-slate-200',
        COMPLETED: 'bg-slate-100 text-slate-700 border-slate-200',
        EXPIRED: 'bg-slate-100 text-slate-700 border-slate-200'
      };
      const codeCell = element('td', 'py-3 px-3 font-semibold text-slate-900 font-mono text-[12px]',
        booking.booking_code || '—');
      codeCell.classList.add('max-w-[150px]', 'truncate');
      const customerCell = element('td', 'py-3 px-3');
      const customerBox = element('div', 'min-w-0');
      customerBox.append(
        element('div', 'font-bold text-slate-900 text-[13px] truncate', customer),
        element('div', 'text-[11px] text-slate-400 truncate', booking.owner?.phone || 'Chưa cập nhật SĐT')
      );
      customerCell.append(customerBox);
      const facilityCell = element('td', 'py-3 px-3');
      facilityCell.append(
        element('div', 'font-medium text-slate-900 text-[13px] truncate', facility),
        element('div', 'text-[11px] text-slate-500 truncate', court)
      );
      const timeCell = element('td', 'py-3 px-3');
      timeCell.append(
        element('div', 'font-semibold text-slate-900 text-[12px]', time || 'Chưa có giờ'),
        element('div', 'text-[11px] text-slate-500 font-medium', date)
      );
      const paymentLabels = {
        PENDING: 'Chưa thanh toán',
        PAID: 'Đã thanh toán',
        REFUNDED: 'Đã hoàn'
      };
      const paymentCell = element('td', 'py-3 px-3 text-right');
      paymentCell.append(
        element('div', 'font-bold text-slate-900 text-[13px]', `Đã trả ${money(booking.paid_amount || 0)}`),
        element('span', 'text-[10px] text-slate-600 font-semibold bg-slate-100 px-1.5 py-0.5 rounded',
          paymentLabels[booking.payment_status] || 'Chưa thanh toán')
      );
      const statusCell = element('td', 'py-3 px-3 text-center');
      const statusBadge = element('span',
        `inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold border ${statusStyle[displayStatus] || 'bg-slate-100 text-slate-700 border-slate-200'}`,
        status);
      statusBadge.prepend(element('span', 'w-1.5 h-1.5 rounded-full bg-current'));
      statusCell.append(statusBadge);
      const action = element('td', 'py-3 px-3 text-right');
      const actionButton = element('button',
        'px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-[11px] font-semibold',
        'Chi tiết');
      actionButton.type = 'button';
      actionButton.disabled = !booking.booking_id;
      actionButton.title = booking.booking_code
        ? `Mở đơn ${booking.booking_code}`
        : 'Không có mã đơn';
      actionButton.addEventListener('click', () => {
        openBookingDetail(booking, actionButton);
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

  async function loadBookings(isPolling = false) {
    const currentRequest = ++bookingsRequestId;
    try {
      const result = await withTimeout(
        api.getBookings({
          page: bookingPage,
          range: elements.range.value,
          status: bookingStatusFilter,
          q: bookingSearchQuery
        }),
        'Quá thời gian tải danh sách đặt sân. Vui lòng thử lại.'
      );
      if (currentRequest !== bookingsRequestId) return;
      if (!Array.isArray(result.bookings) || !result.pagination) {
        throw new Error('Dữ liệu danh sách đặt sân không hợp lệ.');
      }
      bookingTotal = Math.max(0, Number(result.pagination.total) || 0);
      bookingPageSize = Math.max(1, Number(result.pagination.page_size) || bookingPageSize);
      bookingTotalPages = Math.max(0, Number(result.pagination.total_pages) || 0);
      if (bookingTotalPages > 0 && bookingPage > bookingTotalPages) {
        bookingPage = bookingTotalPages;
        return loadBookings(isPolling);
      }
      dashboardBookings = result.bookings;
      renderMockupBookings();
    } catch (error) {
      if (error.status === 401) window.location.replace('/dang-nhap.html');
      else if (error.status === 403) window.location.replace(state.USER_HOME);
      else if (!isPolling) {
        dashboardBookings = [];
        const row = element('tr');
        const cell = element('td', 'py-4 px-3 text-center text-slate-500',
          `${error.message || 'Không thể tải danh sách đặt sân.'} `);
        cell.colSpan = 7;
        const retry = element('button', 'admin-button admin-button--quiet', 'Thử lại');
        retry.type = 'button';
        retry.addEventListener('click', () => loadBookings());
        cell.append(retry);
        row.append(cell);
        document.getElementById('mockupBookingRows')?.replaceChildren(row);
        bookingTotal = 0;
        bookingTotalPages = 0;
        renderBookingPagination();
        const range = document.querySelector('[data-admin-booking-range]');
        const total = document.querySelector('[data-admin-booking-total]');
        if (range) range.textContent = '0';
        if (total) total.textContent = '0';
      }
      if (isPolling) throw error;
    }
  }

  async function loadDashboard(isPolling = false) {
    const currentRequest = ++requestId;
    try {
      const result = await withTimeout(
        api.getDashboard(elements.range.value, {
          status: bookingStatusFilter,
          q: bookingSearchQuery
        }),
        'Quá thời gian tải số liệu (10 giây). Vui lòng thử lại.'
      );
      if (currentRequest !== requestId) return;
      if (!result.kpis || !Array.isArray(result.revenue_by_day) || !result.series
        || !Array.isArray(result.series.buckets)
        || !Array.isArray(result.top_courts) || !Array.isArray(result.recent_bookings)) {
        throw new Error('Dữ liệu tổng quan không hợp lệ.');
      }
      const metrics = result.kpis;
      for (const [key, value] of Object.entries(metrics)) {
        const target = document.querySelector(`[data-kpi="${key}"]`);
        if (target) target.textContent = key === 'net_revenue'
          ? money(value)
          : key === 'fill_rate_percent' ? dashboardState.formatPercent(value) : String(Number(value) || 0);
        const mockupTarget = document.querySelector(`[data-admin-kpi="${key}"]`);
        if (mockupTarget) mockupTarget.textContent = key === 'net_revenue'
          ? money(value)
          : key === 'fill_rate_percent' ? dashboardState.formatPercent(value) : String(Number(value) || 0);
      }
      renderChart(result.series, elements.range.value);
      const statusCounts = result.bookings_by_status || {};
      document.querySelectorAll('[data-admin-booking-status]').forEach((target) => {
        target.textContent = String(Number(statusCounts[target.dataset.adminBookingStatus]) || 0);
      });
      document.querySelectorAll('[data-admin-court-count]').forEach((target) => {
        target.textContent = String(Number(metrics[target.dataset.adminCourtCount]) || 0);
      });
      const fillRate = Number(metrics.fill_rate_percent) || 0;
      const fillLabel = document.querySelector('[data-admin-fill-ring-label]');
      const fillText = document.querySelector('[data-admin-fill-label]');
      const fillRing = document.querySelector('[data-admin-fill-ring]');
      if (fillLabel) fillLabel.textContent = dashboardState.formatPercent(fillRate);
      if (fillText) fillText.textContent = `${dashboardState.formatPercent(fillRate)} lấp đầy`;
      if (fillRing) fillRing.setAttribute('stroke-dasharray', `${Math.min(100, Math.max(0, fillRate))}, 100`);
      const previousRevenue = BigInt(metrics.net_revenue_prev || '0');
      const previousTarget = document.querySelector('[data-admin-revenue-prev]');
      const changeTarget = document.querySelector('[data-admin-revenue-change]');
      if (previousTarget) previousTarget.textContent = money(previousRevenue);
      if (changeTarget) {
        const currentRevenue = BigInt(metrics.net_revenue || '0');
        changeTarget.hidden = previousRevenue <= 0n;
        if (previousRevenue > 0n) {
          const difference = currentRevenue - previousRevenue;
          const percent = Number((difference * 10000n / previousRevenue)) / 100;
          const direction = difference > 0n ? '↑' : difference < 0n ? '↓' : '→';
          changeTarget.textContent = `${direction} ${Math.abs(percent).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}% so với kỳ trước`;
        }
      }
      const title = document.getElementById('dashboardPeriodTitle');
      if (title) title.textContent = `Tổng quan hoạt động ${{
        today: 'hôm nay',
        '7d': '7 ngày qua',
        '30d': '30 ngày qua'
      }[elements.range.value]}`;
      renderTopCourts(result.top_courts || []);
      elements.message.dataset.kind = '';
      elements.message.textContent = `Kỳ theo ngày tạo đơn: ${dashboardState.formatDate(result.range.from)} – ${dashboardState.formatDate(result.range.to)}. Ngày chơi là bộ lọc riêng.`;
    } catch (error) {
      if (error.status === 401) window.location.replace('/dang-nhap.html');
      else if (error.status === 403) window.location.replace(state.USER_HOME);
      else if (currentRequest === requestId) {
        setDashboardError(error.message || 'Không thể tải số liệu tổng quan.');
      }
      if (isPolling) throw error;
    }
  }

  async function initialize() {
    if (!await authorize()) return;
    await Promise.all([loadDashboard(), loadBookings()]);
    polling = shell.startPolling(async ({ signal }) => {
      api.setPollingSignal(signal);
      try {
        await Promise.all([loadDashboard(true), loadBookings(true)]);
      } finally {
        api.setPollingSignal(null);
      }
    }, 5000, (status) => shell.mountSyncStatus(elements.message.parentElement, status));
  }

  elements.range.addEventListener('change', () => {
    syncRangeUrl();
    renderRangeButtons();
    bookingPage = 1;
    api.clearCache();
    Promise.all([loadDashboard(), loadBookings()]);
  });
  elements.exportButton.addEventListener('click', () => exportDownload.download(
    elements.exportButton,
    elements.exportStatus,
    () => api.exportDashboard(elements.range.value, {
      status: bookingStatusFilter,
      q: bookingSearchQuery
    })
  ));
  document.querySelectorAll('[data-admin-range]').forEach((button) => {
    button.addEventListener('click', () => {
      elements.range.value = button.dataset.adminRange;
      elements.range.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });
  document.querySelectorAll('[data-admin-booking-filter]').forEach((button) => {
    button.addEventListener('click', () => {
      bookingStatusFilter = button.dataset.adminBookingFilter || '';
      bookingPage = 1;
      document.querySelectorAll('[data-admin-booking-filter]').forEach((item) => {
        item.className = item === button
          ? 'px-3 py-1 rounded-lg bg-white text-slate-900 font-semibold shadow-sm'
          : 'px-3 py-1 rounded-lg text-slate-600 hover:text-slate-900 font-medium';
      });
      Promise.all([loadDashboard(), loadBookings()]);
    });
  });
  document.getElementById('dashboardBookingSearch')?.addEventListener('input', (event) => {
    bookingSearchQuery = event.currentTarget.value;
    bookingPage = 1;
    Promise.all([loadDashboard(), loadBookings()]);
  });
  document.querySelector('[data-admin-booking-pagination]')?.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-page]');
    if (!button || button.disabled) return;
    bookingPage = Number(button.dataset.page);
    loadBookings();
  });
  elements.manageFacilities?.addEventListener('click', () => {
    window.location.assign('/quan-tri-san.html');
  });
  elements.guardRetry.addEventListener('click', initialize);
  bookingDetailModal?.querySelectorAll('[data-booking-detail-close]').forEach((button) => {
    button.addEventListener('click', closeBookingDetail);
  });
  bookingDetailModal?.addEventListener('click', (event) => {
    if (event.target === bookingDetailModal) closeBookingDetail();
  });
  bookingDetailModal?.querySelector('[data-booking-detail-incident]')
    ?.addEventListener('click', (event) => {
      const booking = event.currentTarget._booking;
      if (booking) incidentDialog?.open(booking, event.currentTarget);
    });
  incidentDialog = window.SportBookingIncidentCancelDialog.mount({
    document,
    onSubmit: (booking, reason) => api.cancelIncident(booking.booking_id, reason),
    onError: (error) => {
      if (error.status === 401) {
        window.location.replace('/dang-nhap.html');
        return true;
      }
      if (error.status === 403) {
        window.location.replace(state.USER_HOME);
        return true;
      }
      return false;
    },
    onSuccess: async (result, booking) => {
      closeBookingDetail();
      api.clearCache();
      elements.message.dataset.kind = 'success';
      elements.message.textContent = `Đã hủy đơn ${booking.booking_code}. Hoàn ${money(result.refunded_amount)}.`;
      await Promise.all([loadDashboard(), loadBookings()]);
    }
  });
  window.addEventListener('admin-data-changed', () => polling?.refreshNow());
  window.addEventListener('pagehide', () => polling?.stop(), { once: true });
  syncRangeUrl();
  renderRangeButtons();
  window.SportBookingIcons?.renderAll(document);
  initialize();
})();
