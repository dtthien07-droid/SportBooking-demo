'use strict';

(() => {
  const state = window.SportBookingHistoryState;
  const pageSize = 10;
  const filterStatuses = Object.freeze({
    all: '',
    upcoming: 'CONFIRMED',
    'payment-pending': 'PENDING',
    completed: 'COMPLETED',
    cancelled: 'CANCELLED',
    expired: 'EXPIRED'
  });
  const statusFilters = Object.freeze({
    PENDING: 'payment-pending',
    CONFIRMED: 'upcoming',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    EXPIRED: 'expired'
  });
  const allowedSports = new Set(['all', 'FOOTBALL_MINI', 'BADMINTON', 'PICKLEBALL']);
  const elements = {
    tabs: [...document.querySelectorAll('.status-tab')],
    loading: document.getElementById('history-loading'),
    error: document.getElementById('history-error'),
    errorMessage: document.getElementById('history-error-message'),
    retry: document.getElementById('history-retry'),
    empty: document.getElementById('history-empty'),
    emptyTitle: document.getElementById('history-empty-title'),
    emptyDescription: document.getElementById('history-empty-description'),
    list: document.getElementById('bookings-list'),
    template: document.getElementById('booking-card-template'),
    pagination: document.getElementById('history-pagination'),
    paginationInfo: document.getElementById('pagination-info'),
    currentPage: document.getElementById('current-page'),
    previous: document.getElementById('previous-page'),
    next: document.getElementById('next-page'),
    search: document.getElementById('search-input'),
    sport: document.getElementById('sport-filter'),
    upcomingCount: document.getElementById('stat-upcoming-count'),
    completedCount: document.getElementById('stat-completed-count'),
    totalSpent: document.getElementById('stat-total-spent'),
    counts: {
      all: document.getElementById('count-all'),
      upcoming: document.getElementById('count-upcoming'),
      'payment-pending': document.getElementById('count-payment-pending'),
      completed: document.getElementById('count-completed'),
      cancelled: document.getElementById('count-cancelled'),
      expired: document.getElementById('count-expired')
    }
  };
  const params = new URLSearchParams(window.location.search);
  const requestedSport = params.get('sport') || 'all';
  const current = {
    filter: statusFilters[params.get('status')] || 'all',
    page: Number.isSafeInteger(Number(params.get('page'))) && Number(params.get('page')) > 0
      ? Number(params.get('page'))
      : 1,
    q: params.get('q') || '',
    sport: allowedSports.has(requestedSport) ? requestedSport : 'all',
    totalPages: 0,
    countdowns: new Map(),
    facilities: new Map(),
    requestSequence: 0,
    loading: false
  };

  function formatMoney(value) {
    if (value === null || value === undefined || value === '') return '--';
    const amount = String(value);
    if (!/^(0|[1-9]\d*)$/.test(amount)) {
      throw new TypeError('Số tiền trong đơn đặt sân không hợp lệ.');
    }
    return `${new Intl.NumberFormat('vi-VN').format(BigInt(amount))} đ`;
  }

  function formatDate(value) {
    const dateText = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
      throw new TypeError('Ngày trong đơn đặt sân không hợp lệ.');
    }
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(new Date(`${dateText}T12:00:00+07:00`));
  }

  function formatTime(value) {
    const match = /^(\d{2}:\d{2})(?::\d{2})?$/.exec(String(value || ''));
    if (!match) throw new TypeError('Khung giờ trong đơn đặt sân không hợp lệ.');
    return match[1];
  }

  function sportPresentation(value) {
    const sport = String(value || '').toUpperCase();
    if (sport === 'FOOTBALL_MINI') return { label: 'Bóng đá mini', icon: 'sports_soccer', color: 'text-primary' };
    if (sport === 'BADMINTON') return { label: 'Cầu lông', icon: 'sports_tennis', color: 'text-secondary' };
    if (sport === 'PICKLEBALL') return { label: 'Pickleball', icon: 'sports_tennis', color: 'text-tertiary' };
    return { label: '--', icon: 'sports', color: 'text-on-surface-variant' };
  }

  function statusClasses(code) {
    if (code === 'PENDING') return 'bg-orange-100 text-secondary';
    if (code === 'EXPIRED' || code === 'CANCELLED') return 'bg-gray-100 text-on-surface-variant';
    if (code === 'COMPLETED') return 'bg-blue-100 text-tertiary';
    if (code === 'UPCOMING' || code === 'IN_PROGRESS') return 'bg-emerald-100 text-primary';
    throw new TypeError('Trạng thái hiển thị của đơn đặt sân không hợp lệ.');
  }

  function currentPagePath() {
    return `${window.location.pathname}${window.location.search}`;
  }

  function updateUrl() {
    const query = new URLSearchParams({ page: String(current.page), page_size: String(pageSize) });
    const status = filterStatuses[current.filter];
    if (status) query.set('status', status);
    if (current.q) query.set('q', current.q);
    if (current.sport !== 'all') query.set('sport', current.sport);
    window.history.replaceState(null, '', `${window.location.pathname}?${query.toString()}`);
  }

  function renderSummary(summary) {
    const presentation = state.getBookingSummaryPresentation(summary);
    elements.upcomingCount.textContent = presentation.upcomingCount;
    elements.completedCount.textContent = presentation.completedCount;
    elements.totalSpent.textContent = presentation.totalSpent;
    for (const [filter, count] of Object.entries(presentation.counts)) {
      elements.counts[filter].textContent = `(${count})`;
    }
  }

  function setTabStyle(activeTab) {
    for (const tab of elements.tabs) {
      tab.className = tab === activeTab
        ? 'status-tab px-4 py-2 rounded-xl text-sm transition-all whitespace-nowrap bg-primary-container text-on-primary-container font-bold shadow-sm cursor-pointer'
        : 'status-tab px-4 py-2 rounded-xl text-sm transition-all whitespace-nowrap bg-surface-container-low hover:bg-surface-container text-on-surface-variant font-medium cursor-pointer';
    }
  }

  function showLoading() {
    elements.loading.hidden = false;
    elements.error.hidden = true;
    elements.empty.hidden = true;
    elements.list.replaceChildren();
    elements.pagination.hidden = true;
  }

  function showError(error) {
    const action = state.getBookingErrorAction(error?.status);
    if (action === 'login') {
      const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.assign(`/dang-nhap.html?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
    elements.loading.hidden = true;
    elements.empty.hidden = true;
    elements.list.replaceChildren();
    elements.pagination.hidden = true;
    elements.errorMessage.textContent = 'Không tải được dữ liệu, vui lòng thử lại';
    elements.error.hidden = false;
  }

  async function getFacility(id) {
    const facilityId = String(id || '');
    if (!/^[1-9]\d*$/.test(facilityId)) return null;
    if (!current.facilities.has(facilityId)) {
      const request = window.SportBookingApi.getFacility(facilityId)
        .catch((error) => {
          if (error?.status === 404) return null;
          current.facilities.delete(facilityId);
          throw error;
        });
      current.facilities.set(facilityId, request);
    }
    return current.facilities.get(facilityId);
  }

  function countdownText(node, remaining) {
    node.textContent = `Còn lại ${state.formatCountdown(remaining)} để thanh toán`;
  }

  function createBookingCard(booking, facilityData) {
    if (!Array.isArray(booking.slots) || booking.slots.length === 0) {
      throw new TypeError('Đơn đặt sân không có khung giờ.');
    }
    const fromPath = currentPagePath();
    const presentation = state.getBookingPresentation(booking, fromPath);
    const firstSlot = booking.slots[0];
    const card = elements.template.content.firstElementChild.cloneNode(true);
    const detailUrl = window.SportBookingBackNav.buildDetailUrl(booking.booking_id, fromPath);
    const sport = sportPresentation(firstSlot.sport_type);
    const image = card.querySelector('[data-booking-image]');
    const status = card.querySelector('[data-status-badge]');
    const primaryAction = card.querySelector('[data-primary-action]');
    const soonAction = card.querySelector('[data-soon-action]');
    const facility = facilityData?.facility;

    card.dataset.status = booking.display_status_code;
    card.querySelector('[data-booking-code]').textContent = booking.booking_code || '--';
    card.querySelector('[data-court-name]').textContent = firstSlot.court_name || '--';
    card.querySelector('[data-facility-name]').textContent = facility?.name || firstSlot.facility_name || '--';
    card.querySelector('[data-facility-address]').textContent = facility?.address || '--';
    card.querySelector('[data-date]').textContent = booking.slots
      .map((slot) => formatDate(slot.service_date))
      .filter((date, index, dates) => dates.indexOf(date) === index)
      .join(' – ');
    card.querySelector('[data-time-range]').textContent = booking.slots
      .map((slot) => `${formatTime(slot.starts_at)} – ${formatTime(slot.ends_at)}`)
      .join(', ');
    card.querySelector('[data-paid-amount]').textContent = formatMoney(booking.paid_amount);
    card.querySelector('[data-sport-icon]').textContent = sport.icon;
    card.querySelector('[data-sport-icon]').classList.add(sport.color);
    card.querySelector('[data-sport-label]').textContent = sport.label;

    status.textContent = presentation.label;
    status.classList.add(...statusClasses(booking.display_status_code).split(' '));
    for (const link of card.querySelectorAll('[data-detail-link], [data-detail-image-link]')) {
      link.href = detailUrl;
    }
    if (facility?.image_url) {
      image.src = facility.image_url;
      image.alt = facility.name || firstSlot.facility_name || 'Sân thể thao';
    } else {
      image.remove();
    }

    const disabledAction = card.querySelector('[data-disabled-action]');
    const actionLabels = {
      'continue-payment': ['Tiếp tục thanh toán', presentation.href],
      'view-ticket': ['Xem vé', presentation.href]
    };
    if (actionLabels[presentation.action]) {
      const [label, href] = actionLabels[presentation.action];
      primaryAction.href = href;
      primaryAction.textContent = label;
      primaryAction.hidden = false;
      disabledAction.hidden = true;
    } else {
      const label = booking.display_status_code === 'COMPLETED' ? 'Đánh giá' : 'Đặt lại';
      soonAction.textContent = `${label} · Sắp có`;
      soonAction.hidden = false;
      soonAction.title = 'Sắp có';
    }

    const countdown = card.querySelector('[data-countdown]');
    if (presentation.remainingSeconds !== null) {
      countdown.hidden = false;
      countdownText(countdown, presentation.remainingSeconds);
      current.countdowns.set(countdown, {
        remaining: presentation.remainingSeconds,
        updatedAt: Date.now()
      });
    }
    return card;
  }

  function renderPagination(pagination) {
    current.totalPages = pagination.total_pages;
    elements.paginationInfo.textContent = pagination.total_pages > 0
      ? `Trang ${pagination.page} / ${pagination.total_pages} · ${pagination.total} đơn`
      : `${pagination.total} đơn`;
    elements.currentPage.textContent = pagination.total_pages > 0
      ? String(pagination.page)
      : '0';
    elements.previous.disabled = pagination.page <= 1;
    elements.next.disabled = pagination.page >= pagination.total_pages;
    elements.pagination.hidden = pagination.total_pages <= 1;
  }

  async function renderBookings(bookings, requestSequence) {
    const cards = await Promise.all(bookings.map(async (booking) => {
      const facilityData = await getFacility(booking.slots?.[0]?.facility_id);
      return createBookingCard(booking, facilityData);
    }));
    if (requestSequence !== current.requestSequence) return false;
    elements.list.replaceChildren(...cards);
    return true;
  }

  async function loadBookings({ quiet = false } = {}) {
    if (current.loading && quiet) return;
    current.loading = true;
    const requestSequence = ++current.requestSequence;
    if (!quiet) showLoading();
    current.countdowns.clear();
    updateUrl();
    try {
      const result = await window.SportBookingApi.listBookings({
        status: filterStatuses[current.filter],
        page: current.page,
        pageSize,
        q: current.q,
        sport: current.sport === 'all' ? undefined : current.sport
      });
      if (requestSequence !== current.requestSequence || !result) return;
      const summary = await window.SportBookingApi.getBookingSummary();
      if (requestSequence !== current.requestSequence || !summary) return;
      if (!Array.isArray(result.bookings) || !result.pagination) {
        throw new TypeError('Máy chủ trả về lịch sử đặt sân không hợp lệ.');
      }
      renderSummary(summary);
      if (result.pagination.total_pages > 0 && current.page > result.pagination.total_pages) {
        current.page = result.pagination.total_pages;
        current.loading = false;
        await loadBookings();
        return;
      }
      if (result.bookings.length === 0) {
        elements.loading.hidden = true;
        elements.error.hidden = true;
        elements.list.replaceChildren();
        elements.emptyTitle.textContent = current.filter === 'all'
          ? 'Bạn chưa có đơn đặt sân nào'
          : 'Không có đơn đặt sân ở trạng thái này';
        elements.emptyDescription.textContent = 'Hãy tìm sân và đặt khung giờ phù hợp để đơn xuất hiện tại đây.';
        elements.empty.hidden = false;
        elements.pagination.hidden = true;
        return;
      }
      const rendered = await renderBookings(result.bookings, requestSequence);
      if (!rendered) return;
      elements.loading.hidden = true;
      elements.error.hidden = true;
      elements.empty.hidden = true;
      renderPagination(result.pagination);
    } catch (error) {
      if (requestSequence === current.requestSequence) showError(error);
    } finally {
      if (requestSequence === current.requestSequence) current.loading = false;
    }
  }

  for (const tab of elements.tabs) {
    tab.addEventListener('click', () => {
      if (!(tab.dataset.filter in filterStatuses)) return;
      current.filter = tab.dataset.filter;
      current.page = 1;
      setTabStyle(tab);
      loadBookings();
    });
  }
  let searchTimer = null;
  elements.search.value = current.q;
  elements.sport.value = current.sport;
  elements.search.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      current.q = elements.search.value.trim();
      current.page = 1;
      loadBookings();
    }, 300);
  });
  elements.sport.addEventListener('change', () => {
    current.sport = elements.sport.value;
    current.page = 1;
    loadBookings();
  });
  elements.retry.addEventListener('click', () => loadBookings());
  elements.previous.addEventListener('click', () => {
    if (current.page > 1) {
      current.page -= 1;
      loadBookings();
    }
  });
  elements.next.addEventListener('click', () => {
    if (current.page < current.totalPages) {
      current.page += 1;
      loadBookings();
    }
  });
  window.addEventListener('popstate', () => {
    const query = new URLSearchParams(window.location.search);
    const status = query.get('status') || '';
    current.filter = statusFilters[status] || 'all';
    const page = Number(query.get('page') || 1);
    current.page = Number.isSafeInteger(page) && page > 0 ? page : 1;
    current.q = query.get('q') || '';
    const sport = query.get('sport') || 'all';
    current.sport = allowedSports.has(sport) ? sport : 'all';
    elements.search.value = current.q;
    elements.sport.value = current.sport;
    setTabStyle(elements.tabs.find((tab) => tab.dataset.filter === current.filter));
    loadBookings();
  });

  window.setInterval(() => {
    for (const [node, timer] of current.countdowns) {
      const elapsed = Math.floor((Date.now() - timer.updatedAt) / 1000);
      if (elapsed < 1) continue;
      timer.updatedAt += elapsed * 1000;
      timer.remaining = Math.max(0, timer.remaining - elapsed);
      if (!node.isConnected) {
        current.countdowns.delete(node);
      } else {
        countdownText(node, timer.remaining);
      }
    }
  }, 250);
  window.setInterval(() => loadBookings({ quiet: true }), 5000);

  setTabStyle(elements.tabs.find((tab) => tab.dataset.filter === current.filter));
  loadBookings();
})();
