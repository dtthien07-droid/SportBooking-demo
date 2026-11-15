'use strict';

(() => {
  const state = window.SportBookingAdminPageState;
  const api = window.SportBookingAdminApi;
  const exportDownload = window.SportBookingExportDownload;
  const shell = window.SportBookingAdminShell;
  const incidentDialogApi = window.SportBookingIncidentCancelDialog;
  if (!state || !api || !exportDownload || !shell || !incidentDialogApi) {
    throw new Error('Thiếu cấu hình trang quản trị.');
  }
  shell.mountAdminShell({ active: 'bookings' });

  const elements = {
    guard: document.getElementById('adminGuard'),
    guardMessage: document.getElementById('adminGuardMessage'),
    guardRetry: document.getElementById('adminGuardRetry'),
    app: document.getElementById('adminApp'),
    headerMount: document.getElementById('adminHeaderMount'),
    period: document.getElementById('dashboardPeriod'),
    dashboardMessage: document.getElementById('dashboardMessage'),
    navigationLinks: [...document.querySelectorAll('[data-admin-nav]')],
    tabs: [...document.querySelectorAll('[data-filter]')],
    counts: [...document.querySelectorAll('[data-count]')],
    filters: document.getElementById('bookingFilters'),
    search: document.getElementById('bookingSearch'),
    date: document.getElementById('bookingDate'),
    facility: document.getElementById('facilityFilter'),
    retryFacilities: document.getElementById('retryFacilities'),
    applyFilters: document.getElementById('applyBookingFilters'),
    resetFilters: document.getElementById('resetBookingFilters'),
    exportButton: document.getElementById('exportBookings'),
    rows: document.getElementById('bookingRows'),
    rowTemplate: document.getElementById('bookingRowTemplate'),
    pageTemplate: document.getElementById('paginationPageTemplate'),
    ellipsisTemplate: document.getElementById('paginationEllipsisTemplate'),
    paginationPages: document.getElementById('paginationPages'),
    paginationSummary: document.getElementById('paginationSummary'),
    previousPage: document.getElementById('previousPage'),
    nextPage: document.getElementById('nextPage'),
    refreshButtons: [...document.querySelectorAll('#refreshBookings, #refreshBookingsIcon')],
    notice: document.getElementById('adminNotice')
  };
  const PAGE_SIZE = 10;
  const COUNT_FILTERS = Object.freeze([
    { key: 'all', status: '' },
    { key: 'pending', status: 'PENDING' },
    { key: 'completed', status: 'COMPLETED' },
    { key: 'cancelled', status: 'CANCELLED' },
    { key: 'expired', status: 'EXPIRED' }
  ]);
  let filterState = state.restoreFilterState(window.location.search);
  let totalPages = 1;
  let facilities = [];
  let noticeTimer = null;
  let bookingsRequestId = 0;
  let dashboardRequestId = 0;
  let countsRequestId = 0;
  let adminPolling = null;
  let visibleBookingIds = null;

  function makeElement(tag, className = '', text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }

  function safeCount(value) {
    const count = Number(value);
    return Number.isSafeInteger(count) && count >= 0 ? count : 0;
  }

  function hasValidPagination(result) {
    const pagination = result?.pagination;
    return Boolean(pagination)
      && Number.isSafeInteger(Number(pagination.page))
      && Number(pagination.page) > 0
      && Number.isSafeInteger(Number(pagination.page_size))
      && Number(pagination.page_size) > 0
      && Number.isSafeInteger(Number(pagination.total))
      && Number(pagination.total) >= 0
      && Number.isSafeInteger(Number(pagination.total_pages))
      && Number(pagination.total_pages) >= 0;
  }

  function syncFilterControls() {
    elements.search.value = filterState.draft.query;
    elements.date.value = filterState.draft.date;
    elements.facility.value = filterState.draft.facilityId;
  }

  function syncFilterUrl() {
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${state.serializeFilterState(filterState.applied)}${window.location.hash}`
    );
  }

  function updateDraftFilter(key, value) {
    filterState = state.updateDraftFilter(filterState, key, value);
    syncFilterControls();
  }

  function renderSelectedTab() {
    for (const tab of elements.tabs) {
      const active = (tab.dataset.filter || '') === filterState.applied.status;
      tab.setAttribute('class', active
        ? 'px-3.5 py-1.5 rounded-lg bg-white border border-[#E2E8F0] font-semibold text-[#0F172A] shadow-sm flex items-center gap-2 whitespace-nowrap'
        : 'px-3.5 py-1.5 rounded-lg text-[#64748B] hover:text-[#0F172A] hover:bg-white/80 font-medium flex items-center gap-2 whitespace-nowrap transition');
      tab.setAttribute('aria-selected', String(active));
    }
  }

  function renderAdminNavigation(selected) {
    for (const link of elements.navigationLinks) {
      const active = link.dataset.adminNav === selected;
      link.setAttribute(
        'class',
        active ? 'admin-sidebar__link is-active' : 'admin-sidebar__link'
      );
      if (active) link.setAttribute('aria-current', 'location');
      else link.removeAttribute('aria-current');
    }
  }

  function createOption(value, label) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }

  function renderFacilityOptions() {
    const selectedFacilityId = filterState.draft.facilityId;
    const options = [createOption('', state.getAllFacilitiesLabel(facilities.length))];
    for (const group of state.groupFacilitiesByDistrict(facilities)) {
      const optgroup = document.createElement('optgroup');
      optgroup.label = group.district;
      for (const facility of group.facilities) {
        optgroup.append(createOption(facility.id, facility.name));
      }
      options.push(optgroup);
    }
    elements.facility.replaceChildren(...options);
    elements.facility.disabled = false;
    elements.retryFacilities.hidden = true;
    let facilityFilterWasRemoved = false;
    if (selectedFacilityId && !facilities.some((facility) => (
      String(facility.id ?? facility.facility_id) === selectedFacilityId
    ))) {
      filterState = {
        draft: { ...filterState.draft, facilityId: '' },
        applied: {
          ...filterState.applied,
          facilityId: '',
          page: 1
        }
      };
      facilityFilterWasRemoved = true;
      syncFilterUrl();
    }
    syncFilterControls();
    if (facilityFilterWasRemoved) loadBookings();
  }

  async function loadFacilities() {
    elements.facility.disabled = true;
    elements.retryFacilities.hidden = true;
    elements.facility.replaceChildren(createOption('', 'Đang tải danh sách cơ sở...'));
    try {
      const allFacilities = [];
      let page = 1;
      let totalPagesForFacilities = 1;
      do {
        const result = await api.getFacilities({ page, pageSize: 50 });
        if (!Array.isArray(result.facilities) || !hasValidPagination(result)) {
          throw new Error('Máy chủ trả về danh sách cơ sở không hợp lệ.');
        }
        allFacilities.push(...result.facilities);
        totalPagesForFacilities = safeCount(result.pagination.total_pages);
        page += 1;
      } while (page <= totalPagesForFacilities);
      facilities = allFacilities;
      renderFacilityOptions();
    } catch (error) {
      elements.facility.replaceChildren(createOption('', 'Không tải được danh sách cơ sở'));
      elements.facility.disabled = true;
      elements.retryFacilities.hidden = false;
    }
  }

  function showNotice(message, kind = 'success') {
    elements.notice.textContent = message;
    elements.notice.dataset.kind = kind;
    elements.notice.hidden = false;
    window.clearTimeout(noticeTimer);
    noticeTimer = window.setTimeout(() => {
      elements.notice.hidden = true;
    }, 6000);
  }

  function redirectForStatus(status) {
    if (status === 401) {
      window.location.replace('/dang-nhap.html');
      return true;
    }
    if (status === 403) {
      window.location.replace(state.USER_HOME);
      return true;
    }
    return false;
  }

  function showGuardError(message) {
    elements.guard.hidden = false;
    elements.guardMessage.textContent = message;
    elements.guardRetry.hidden = false;
  }

  async function loadScript(source) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = source;
      script.onload = resolve;
      script.onerror = () => reject(new Error('Không thể tải thành phần điều hướng.'));
      document.head.append(script);
    });
  }

  async function loadSharedHeader() {
    if (!window.SportBookingIcons) throw new Error('Không thể tải biểu tượng dùng chung.');
    await loadScript('/shared/header-state.js');
    await loadScript('/shared/header.js');
    if (window.SportBookingHeaderReady) await window.SportBookingHeaderReady;
    if (!elements.headerMount.querySelector('.sb-shared-header')) {
      throw new Error('Không thể hiển thị thanh điều hướng.');
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
      header: elements.headerMount,
      ensureHeader: loadSharedHeader
    }));
  }

  function setMetric(name, value, isMoney = false) {
    const target = document.querySelector(`[data-metric="${name}"]`);
    if (!target) return;
    target.textContent = isMoney
      ? state.formatMoney(value)
      : String(safeCount(value));
  }

  function dashboardHasData(result) {
    const countKeys = ['new_bookings', 'cancelled_bookings', 'completed_bookings'];
    if (countKeys.some((key) => safeCount(result[key]) > 0)) return true;
    const revenue = String(result.net_revenue ?? '0');
    return /^-?\d+$/.test(revenue) && BigInt(revenue) !== 0n;
  }

  async function loadDashboard(isPolling = false) {
    const requestId = ++dashboardRequestId;
    elements.dashboardMessage.dataset.kind = 'info';
    if (!isPolling) elements.dashboardMessage.textContent = 'Đang tải số liệu...';
    try {
      const result = await api.getDashboard(elements.period?.value || '7d');
      if (requestId !== dashboardRequestId) return;
      setMetric('new_bookings', result.new_bookings);
      setMetric('net_revenue', result.net_revenue, true);
      setMetric('cancelled_bookings', result.cancelled_bookings);
      setMetric('completed_bookings', result.completed_bookings);
      elements.dashboardMessage.textContent = dashboardHasData(result)
        ? 'Các thẻ số liệu là toàn hệ thống; bộ lọc danh sách không áp dụng.'
        : 'Chưa có dữ liệu trong khoảng thời gian này. Các thẻ số liệu là toàn hệ thống.';
      delete elements.dashboardMessage.dataset.kind;
    } catch (error) {
      if (redirectForStatus(error.status)) return;
      if (requestId === dashboardRequestId && !isPolling) {
        elements.dashboardMessage.textContent = '';
        delete elements.dashboardMessage.dataset.kind;
      }
      if (isPolling) throw error;
    }
  }

  async function getAllBookingsByStatus(status, applied) {
    const firstPage = await api.getBookings({
      ...state.buildQuery({ ...applied, status, page: 1 }),
      page_size: 50
    });
    if (!Array.isArray(firstPage.bookings) || !hasValidPagination(firstPage)) {
      throw new Error('Máy chủ trả về danh sách đơn không hợp lệ.');
    }
    const totalPages = safeCount(firstPage.pagination.total_pages);
    if (totalPages <= 1) return firstPage.bookings;

    const remainingPages = await Promise.all(Array.from(
      { length: totalPages - 1 },
      (_, index) => api.getBookings({
        ...state.buildQuery({ ...applied, status, page: index + 2 }),
        page_size: 50
      })
    ));
    for (const result of remainingPages) {
      if (!Array.isArray(result.bookings) || !hasValidPagination(result)) {
        throw new Error('Máy chủ trả về danh sách đơn không hợp lệ.');
      }
    }
    return firstPage.bookings.concat(...remainingPages.map((result) => result.bookings));
  }

  function getAllConfirmedBookings(applied) {
    return getAllBookingsByStatus('CONFIRMED', applied);
  }

  function appendEmptyState(message, actionLabel = '', actionHandler = null) {
    const row = document.createElement('tr');
    const cell = makeElement('td', 'admin-empty', message);
    cell.colSpan = 7;
    if (actionLabel && actionHandler) {
      const button = makeElement('button', 'admin-button admin-button--quiet admin-empty__action', actionLabel);
      button.type = 'button';
      button.addEventListener('click', actionHandler);
      cell.append(document.createElement('br'), button);
    }
    row.append(cell);
    elements.rows.replaceChildren(row);
  }

  function renderBookingRow(booking, isNew = false) {
    const model = state.getBookingRowModel(booking);
    const fragment = elements.rowTemplate.content.cloneNode(true);
    const row = fragment.querySelector('[data-booking-row]');
    if (!row) throw new Error('Mẫu hàng đơn đặt sân không hợp lệ.');
    const setField = (name, value) => {
      const field = row.querySelector(`[data-field="${name}"]`);
      if (!field) throw new Error(`Thiếu trường hiển thị ${name} trong mẫu hàng.`);
      field.textContent = value == null ? '' : String(value);
      return field;
    };
    const owner = booking.owner && typeof booking.owner === 'object' ? booking.owner : {};
    const status = row.querySelector('[data-field="status"]');
    if (!status) throw new Error('Thiếu vùng hiển thị trạng thái trong mẫu hàng.');
    const statusClass = {
      pending: 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 text-[11px] font-semibold w-fit',
      upcoming: 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-[#087A45] border border-emerald-200 text-[11px] font-semibold w-fit',
      'in-progress': 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-50 text-blue-600 border border-blue-100 text-[11px] font-semibold w-fit',
      completed: 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#F1F5F9] text-[#475569] border border-slate-200 text-[11px] font-semibold w-fit',
      cancelled: 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-[11px] font-semibold w-fit',
      expired: 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 border border-rose-200 text-[11px] font-semibold w-fit',
      unknown: 'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#F1F5F9] text-[#64748B] border border-[#E2E8F0] text-[11px] font-semibold w-fit'
    }[model.statusClass] || '';
    if (!statusClass) throw new Error(`Không có kiểu hiển thị trạng thái ${model.statusClass}.`);

    row.setAttribute('data-booking-id', String(booking.booking_id || ''));
    row.setAttribute('data-status', model.displayStatus);
    setField('booking-code', model.bookingCode);
    setField('created-at', booking.created_at || '');
    const initials = model.ownerName.split(/\s+/).filter(Boolean).map((part) => (
      Array.from(part)[0]
    )).slice(-2).join('').toLocaleUpperCase('vi');
    const avatar = setField('owner-initials', initials);
    const avatarClass = {
      pending: 'w-9 h-9 rounded-full bg-amber-50 text-amber-700 font-semibold flex items-center justify-center text-[12px] border border-amber-200 shrink-0',
      upcoming: 'w-9 h-9 rounded-full bg-emerald-50 text-[#087A45] font-semibold flex items-center justify-center text-[12px] border border-emerald-100 shrink-0',
      'in-progress': 'w-9 h-9 rounded-full bg-blue-50 text-blue-600 font-semibold flex items-center justify-center text-[12px] border border-blue-100 shrink-0',
      completed: 'w-9 h-9 rounded-full bg-slate-100 text-[#475569] font-semibold flex items-center justify-center text-[12px] border border-slate-200 shrink-0',
      cancelled: 'w-9 h-9 rounded-full bg-rose-50 text-rose-600 font-semibold flex items-center justify-center text-[12px] border border-rose-100 shrink-0',
      expired: 'w-9 h-9 rounded-full bg-rose-50 text-rose-600 font-semibold flex items-center justify-center text-[12px] border border-rose-100 shrink-0',
      unknown: 'w-9 h-9 rounded-full bg-slate-100 text-[#475569] font-semibold flex items-center justify-center text-[12px] border border-slate-200 shrink-0'
    }[model.statusClass] || '';
    if (!avatarClass) throw new Error(`Không có kiểu hiển thị khách hàng ${model.statusClass}.`);
    avatar.setAttribute('class', avatarClass);
    setField('owner-name', model.ownerName);
    setField('owner-contact', owner.phone || model.ownerEmail);
    setField('venue', model.venue);
    setField('court', booking.slots?.[0]?.court_name || '');
    setField('schedule', model.schedule);
    setField('schedule-extra', '');
    setField('paid-amount', model.paidAmount);
    setField('refunded-label', `Đã hoàn ${model.refundedAmount}`);
    setField('status-label', model.label);
    status.setAttribute('class', statusClass);
    status.setAttribute('data-status', model.displayStatus);
    avatar.setAttribute('aria-hidden', 'true');
    row.setAttribute('class', booking.status === 'CANCELLED'
      ? 'bg-rose-50/30 hover:bg-rose-50/50 transition-colors'
      : 'hover:bg-[#F8FAFC] transition-colors');
    if (isNew) {
      row.classList.add('admin-booking-row--new');
      row.setAttribute('data-new-booking', 'true');
      row.setAttribute('aria-label', 'Đơn đặt sân mới');
    }
    const canCancel = booking.can_cancel_incident === true;
    const cancel = row.querySelector('[data-action="cancel"]');
    const emptyAction = setField('action-empty', canCancel ? '' : '—');
    emptyAction.hidden = canCancel;
    cancel.hidden = !canCancel;
    if (canCancel) cancel.addEventListener('click', () => openCancellation(booking, cancel));
    return row;
  }

  function showSkeletonRows() {
    const rows = [];
    for (let index = 0; index < 3; index += 1) {
      const row = makeElement('tr', 'admin-skeleton-row');
      row.setAttribute('aria-hidden', 'true');
      const cell = document.createElement('td');
      cell.colSpan = 7;
      cell.append(makeElement('span'), makeElement('span'), makeElement('span'));
      row.append(cell);
      rows.push(row);
    }
    elements.rows.replaceChildren(...rows);
  }

  function renderBookings(result, newBookingIds = new Set()) {
    const bookings = Array.isArray(result.bookings) ? result.bookings : [];
    const pagination = result.pagination || {};
    totalPages = Math.max(1, safeCount(pagination.total_pages));
    const page = Math.min(filterState.applied.page, totalPages);
    if (page !== filterState.applied.page) {
      filterState = state.setAppliedPage(filterState, page);
      syncFilterUrl();
    }
    const start = (page - 1) * PAGE_SIZE;
    const visibleBookings = result.clientPaginated
      ? bookings.slice(start, start + PAGE_SIZE)
      : bookings;
    const total = safeCount(pagination.total);
    const firstVisible = total === 0 ? 0 : start + 1;
    const lastVisible = total === 0 ? 0 : Math.min(start + visibleBookings.length, total);
    elements.paginationSummary.textContent =
      `Hiển thị ${firstVisible} - ${lastVisible} của ${total} đơn đặt sân`;
    elements.previousPage.disabled = page <= 1;
    elements.nextPage.disabled = page >= totalPages;
    renderPaginationPages();

    if (visibleBookings.length === 0) {
      appendEmptyState(
        'Không có đơn phù hợp với bộ lọc',
        'Đặt lại bộ lọc',
        resetFiltersAndLoad
      );
      return;
    }
    elements.rows.replaceChildren(...visibleBookings.map((booking) => (
      renderBookingRow(booking, newBookingIds.has(String(booking.booking_id || '')))
    )));
  }

  function renderPaginationPages() {
    const current = filterState.applied.page;
    const total = totalPages;
    const pages = new Set([1, total, current - 1, current, current + 1]);
    const visiblePages = [...pages].filter((page) => page >= 1 && page <= total).sort((a, b) => a - b);
    const controls = [];
    let previous = 0;
    for (const page of visiblePages) {
      if (previous && page - previous > 1) {
        const ellipsis = elements.ellipsisTemplate.content.cloneNode(true).firstElementChild;
        if (!ellipsis) throw new Error('Mẫu dấu phân trang không hợp lệ.');
        controls.push(ellipsis);
      }
      const fragment = elements.pageTemplate.content.cloneNode(true);
      const button = fragment.querySelector('[data-page]');
      if (!button) throw new Error('Mẫu nút phân trang không hợp lệ.');
      button.textContent = String(page);
      button.setAttribute('aria-label', `Trang ${page}`);
      button.setAttribute('aria-current', page === current ? 'page' : 'false');
      if (page === current) {
        button.setAttribute('class', 'w-8 h-8 rounded-lg bg-[#087A45] text-white font-semibold flex items-center justify-center shadow-sm');
      }
      button.addEventListener('click', () => {
        if (filterState.applied.page === page) return;
        filterState = state.setAppliedPage(filterState, page);
        syncFilterUrl();
        loadBookings();
      });
      controls.push(button);
      previous = page;
    }
    elements.paginationPages.replaceChildren(...controls);
  }

  function setTabCounts(values) {
    for (const count of elements.counts) {
      count.textContent = String(safeCount(values[count.dataset.count]));
    }
  }

  async function loadTabCounts(isPolling = false) {
    const requestId = ++countsRequestId;
    const applied = filterState.applied;
    try {
      const [results, confirmedBookings] = await Promise.all([
        Promise.all(COUNT_FILTERS.map((filter) => (
          api.getBookings({
            ...state.buildQuery({ ...applied, status: filter.status, page: 1 }),
            page_size: 1
          })
        ))),
        getAllConfirmedBookings(applied)
      ]);
      if (requestId !== countsRequestId) return;
      const values = {};
      results.forEach((result, index) => {
        if (!hasValidPagination(result)) {
          throw new Error('Máy chủ trả về số lượng đơn không hợp lệ.');
        }
        values[COUNT_FILTERS[index].key] = result.pagination?.total;
      });
      const activeCounts = state.countDisplayStatuses(confirmedBookings);
      values.upcoming = activeCounts.UPCOMING;
      values['in-progress'] = activeCounts.IN_PROGRESS;
      values.completed += activeCounts.COMPLETED;
      setTabCounts(values);
    } catch (error) {
      if (redirectForStatus(error.status)) return;
      if (!isPolling && requestId === countsRequestId) {
        showNotice('Không thể cập nhật số lượng theo trạng thái. Vui lòng tải lại danh sách.', 'error');
      }
      if (isPolling) throw error;
    }
  }

  function captureBookingScroll() {
    const horizontalScroller = document.querySelector('#bookingTable .overflow-x-auto');
    return {
      x: window.scrollX,
      y: window.scrollY,
      horizontal: horizontalScroller?.scrollLeft || 0
    };
  }

  function restoreBookingScroll(snapshot) {
    window.scrollTo(snapshot.x, snapshot.y);
    const horizontalScroller = document.querySelector('#bookingTable .overflow-x-auto');
    if (horizontalScroller) horizontalScroller.scrollLeft = snapshot.horizontal;
  }

  async function loadBookings(isPolling = false) {
    const requestId = ++bookingsRequestId;
    const applied = filterState.applied;
    if (!isPolling) {
      showSkeletonRows();
      elements.paginationSummary.textContent = 'Đang tải danh sách...';
      elements.previousPage.disabled = true;
      elements.nextPage.disabled = true;
    }
    const countsPromise = loadTabCounts(isPolling);
    try {
      let result;
      if (applied.status === 'UPCOMING' || applied.status === 'IN_PROGRESS'
          || applied.status === 'COMPLETED') {
        const status = applied.status;
        const [matchingBookings, confirmedBookings] = await Promise.all([
          status === 'COMPLETED'
            ? getAllBookingsByStatus('COMPLETED', applied)
            : Promise.resolve([]),
          getAllConfirmedBookings(applied)
        ]);
        if (requestId !== bookingsRequestId) return;
        const confirmedMatches = state.filterBookingsByDisplayStatus(confirmedBookings, status);
        const filteredBookings = status === 'COMPLETED'
          ? matchingBookings.concat(confirmedMatches).sort((first, second) => (
            String(second.created_at || '').localeCompare(String(first.created_at || ''))
            || String(second.booking_id || '').localeCompare(String(first.booking_id || ''), undefined, { numeric: true })
          ))
          : confirmedMatches;
        const totalPages = Math.ceil(filteredBookings.length / PAGE_SIZE);
        result = {
          bookings: filteredBookings,
          clientPaginated: true,
          pagination: {
            page: applied.page,
            page_size: PAGE_SIZE,
            total: filteredBookings.length,
            total_pages: totalPages
          }
        };
      } else {
        result = await api.getBookings({
          ...state.buildQuery({
            ...applied,
            status: state.getApiStatusForFilter(applied.status)
          }),
          page_size: PAGE_SIZE
        });
      }
      if (requestId !== bookingsRequestId) return;
      if (!Array.isArray(result.bookings) || !hasValidPagination(result)) {
        throw new Error('Máy chủ trả về danh sách đơn không hợp lệ.');
      }
      const lastPage = Math.max(1, safeCount(result.pagination.total_pages));
      if (applied.page > lastPage) {
        filterState = state.setAppliedPage(filterState, lastPage);
        visibleBookingIds = null;
        syncFilterUrl();
        await countsPromise;
        await loadBookings(isPolling);
        return;
      }
      const start = (applied.page - 1) * PAGE_SIZE;
      const visibleBookings = result.clientPaginated
        ? result.bookings.slice(start, start + PAGE_SIZE)
        : result.bookings;
      const currentIds = visibleBookings.map((booking) => String(booking.booking_id || '')).filter(Boolean);
      const newBookingIds = isPolling && visibleBookingIds
        ? new Set(state.getNewBookingIds(currentIds, visibleBookingIds))
        : new Set();
      visibleBookingIds = new Set(currentIds);
      const scrollSnapshot = isPolling ? captureBookingScroll() : null;
      renderBookings(result, newBookingIds);
      if (scrollSnapshot) restoreBookingScroll(scrollSnapshot);
    } catch (error) {
      if (redirectForStatus(error.status)) return;
      if (requestId !== bookingsRequestId) return;
      if (isPolling) {
        throw error;
      } else {
        appendEmptyState(error.message || 'Không thể tải danh sách đơn.', 'Thử lại', loadBookings);
        elements.paginationSummary.textContent = 'Không thể tải danh sách.';
      }
    }
    await countsPromise;
  }

  function openCancellation(booking, trigger) {
    incidentCancellationDialog.open(booking, trigger);
  }

  const incidentCancellationDialog = incidentDialogApi.mount({
    onSubmit: (booking, reason) => api.cancelIncident(booking.booking_id, reason),
    onSuccess: async (result, booking) => {
      showNotice(
        `Đã hủy đơn ${booking.booking_code || booking.booking_id} do sự cố. Số tiền hoàn theo máy chủ: ${state.formatMoney(result.refunded_amount)}.`
      );
      await Promise.all([loadDashboard(), loadBookings()]);
    },
    onError: (error) => redirectForStatus(error.status)
  });

  function selectTab(selected) {
    filterState = state.setAppliedStatus(filterState, selected.dataset.filter || '');
    renderSelectedTab();
    syncFilterUrl();
    loadBookings();
  }

  function applyFilters(event) {
    event.preventDefault();
    filterState = state.applyDraftFilters(filterState);
    syncFilterControls();
    renderSelectedTab();
    syncFilterUrl();
    Promise.all([loadDashboard(), loadBookings()]);
  }

  async function downloadBookingsExport() {
    return exportDownload.download(
      elements.exportButton,
      elements.notice,
      () => api.exportBookings(state.buildExportFilters(filterState)),
      {
        successMessage: 'Đã tải tệp Excel đơn đặt sân.',
        onSuccess: () => showNotice('Đã tải tệp Excel đơn đặt sân.'),
        onError: (error) => {
          if (!redirectForStatus(error.status)) {
            showNotice(error.message || 'Không thể xuất dữ liệu đơn đặt sân.', 'error');
          }
          return true;
        }
      }
    );
  }

  function resetFiltersAndLoad() {
    filterState = state.resetFilterState();
    syncFilterControls();
    renderSelectedTab();
    syncFilterUrl();
    Promise.all([loadDashboard(), loadBookings()]);
  }

  function restoreFromUrl() {
    filterState = state.restoreFilterState(window.location.search);
    if (filterState.applied.facilityId && facilities.length > 0
        && !facilities.some((facility) => (
          String(facility.id ?? facility.facility_id) === filterState.applied.facilityId
        ))) {
      filterState = {
        draft: { ...filterState.draft, facilityId: '' },
        applied: { ...filterState.applied, facilityId: '', page: 1 }
      };
    }
    syncFilterControls();
    renderAdminNavigation(window.location.hash === '#adminOverview' ? 'overview' : 'bookings');
    renderSelectedTab();
    syncFilterUrl();
    Promise.all([loadDashboard(), loadBookings()]);
  }

  if (elements.period) elements.period.addEventListener('change', loadDashboard);
  elements.navigationLinks.forEach((link) => {
    link.addEventListener('click', () => renderAdminNavigation(link.dataset.adminNav));
  });
  elements.tabs.forEach((tab) => tab.addEventListener('click', () => selectTab(tab)));
  elements.refreshButtons.forEach((button) => {
    button.addEventListener('click', () => Promise.all([loadDashboard(), loadBookings()]));
  });
  elements.exportButton.addEventListener('click', downloadBookingsExport);
  elements.filters.addEventListener('submit', applyFilters);
  elements.search.addEventListener('input', () => updateDraftFilter('query', elements.search.value));
  elements.date.addEventListener('input', () => updateDraftFilter('date', elements.date.value));
  elements.facility.addEventListener('change', () => updateDraftFilter('facilityId', elements.facility.value));
  elements.retryFacilities.addEventListener('click', loadFacilities);
  elements.resetFilters.addEventListener('click', resetFiltersAndLoad);
  elements.previousPage.addEventListener('click', () => {
    if (filterState.applied.page <= 1) return;
    filterState = state.setAppliedPage(filterState, filterState.applied.page - 1);
    syncFilterUrl();
    loadBookings();
  });
  elements.nextPage.addEventListener('click', () => {
    if (filterState.applied.page >= totalPages) return;
    filterState = state.setAppliedPage(filterState, filterState.applied.page + 1);
    syncFilterUrl();
    loadBookings();
  });
  elements.guardRetry.addEventListener('click', authorize);
  window.addEventListener('hashchange', () => {
    renderAdminNavigation(window.location.hash === '#adminOverview' ? 'overview' : 'bookings');
  });
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) restoreFromUrl();
  });

  async function initialize() {
    const authorized = await authorize();
    if (!authorized) return;
    syncFilterControls();
    renderAdminNavigation(window.location.hash === '#adminOverview' ? 'overview' : 'bookings');
    renderSelectedTab();
    syncFilterUrl();
    await Promise.all([loadDashboard(), loadBookings(), loadFacilities()]);
    adminPolling = shell.startPolling(async ({ signal }) => {
      api.setPollingSignal(signal);
      try {
        await Promise.all([loadDashboard(true), loadBookings(true)]);
      } finally {
        api.setPollingSignal(null);
      }
    }, 5000, (status) => shell.mountSyncStatus(elements.dashboardMessage.parentElement, status));
  }

  window.addEventListener('admin-data-changed', () => adminPolling?.refreshNow());
  window.addEventListener('pagehide', () => adminPolling?.stop(), { once: true });

  initialize();
})();
