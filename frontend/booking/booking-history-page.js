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
    cancelResult: document.getElementById('cancel-result-message'),
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
  let summaryRefreshedAt = 0;
  let countdownTimer = null;
  let historyPollTimer = null;
  function initializeCancelResultToast() {
    const toast = document.createElement('div');
    toast.id = 'cancel-result-message';
    toast.className = 'cancel-result-toast';
    toast.hidden = true;
    toast.setAttribute('role', 'status');
    const message = document.createElement('span');
    message.dataset.cancelResultMessage = '';
    const close = document.createElement('button');
    close.className = 'cancel-result-toast-close';
    close.type = 'button';
    close.textContent = 'Đóng';
    close.setAttribute('aria-label', 'Đóng thông báo hủy');
    close.addEventListener('click', () => {
      window.clearTimeout(cancelResultTimer);
      toast.hidden = true;
    });
    toast.append(message, close);
    document.getElementById('cancel-result-message').replaceWith(toast);
    return toast;
  }

  let cancelResultTimer = null;
  elements.cancelResult = initializeCancelResultToast();

  function showCancelResult(message) {
    elements.cancelResult.querySelector('[data-cancel-result-message]').textContent = message;
    elements.cancelResult.hidden = false;
    window.clearTimeout(cancelResultTimer);
    cancelResultTimer = window.setTimeout(() => {
      elements.cancelResult.hidden = true;
    }, 6000);
  }

  const cancellationDialog = window.SportBookingCancellationDialog.initialize({
    onCancelled: async (result, message, context) => {
      if (!result) {
        if (message) showCancelResult(message);
        return;
      }
      const bookingId = String(context?.bookingId || result.booking_id || '');
      const oldCard = [...elements.list.children]
        .find((card) => card.dataset.bookingId === bookingId);
      try {
        const [bookingDetail, summary] = await Promise.all([
          window.SportBookingApi.getBooking(bookingId),
          window.SportBookingApi.getBookingSummary()
        ]);
        if (!bookingDetail || !summary) {
          throw new TypeError('Máy chủ không trả đủ dữ liệu để cập nhật đơn đã hủy.');
        }
        const refreshedBooking = {
          ...bookingDetail,
          paid_amount: bookingDetail.payment?.paid_amount ?? null,
          refunded_amount: bookingDetail.payment?.refunded_amount ?? null
        };
        const facilityData = await getFacility(refreshedBooking.slots?.[0]?.facility_id);
        const replacement = createBookingCard(refreshedBooking, facilityData);
        if (oldCard) oldCard.replaceWith(replacement);
        else await loadBookings();
        renderSummary(summary);
      } catch (error) {
        elements.errorMessage.textContent =
          `Đơn đã hủy nhưng không thể cập nhật lịch sử: ${error.message || 'Vui lòng thử lại.'}`;
        elements.error.hidden = false;
      }
      showCancelResult(state.getCancellationSuccessMessage(
        context?.bookingCode,
        result.refunded_amount,
        context?.bookingStatus
      ));
    }
  });

  function formatMoney(value) {
    if (value === null || value === undefined || value === '') return '--';
    const amount = String(value);
    if (!/^(0|[1-9]\d*)$/.test(amount)) {
      throw new TypeError('Số tiền trong đơn đặt sân không hợp lệ.');
    }
    return `${new Intl.NumberFormat('vi-VN').format(BigInt(amount))} đ`;
  }

  function formatDate(value) {
    if (value === null || value === undefined || value === '') return '--';
    const dateText = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
      throw new TypeError('Ngày trong đơn đặt sân không hợp lệ.');
    }
    const date = new Date(`${dateText}T12:00:00+07:00`);
    if (Number.isNaN(date.getTime())) return '--';
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(date);
  }

  function formatTime(value) {
    if (value === null || value === undefined || value === '') return '--';
    const match = /^(\d{2}:\d{2})(?::\d{2})?$/.exec(String(value || ''));
    if (!match) throw new TypeError('Khung giờ trong đơn đặt sân không hợp lệ.');
    return match[1];
  }

  function displayText(value, fallback = '--') {
    if (typeof value !== 'string' && typeof value !== 'number') return fallback;
    const text = String(value);
    return text.trim() ? text : fallback;
  }

  function sportPresentation(value) {
    const sport = String(value || '').toUpperCase();
    if (sport === 'FOOTBALL_MINI') {
      return {
        label: 'Bóng đá mini',
        icon: 'sports_soccer',
        color: 'text-primary',
        fallbackColor: '#006b2c',
        defaultImage: '/assets/images/court-default-football-mini.svg'
      };
    }
    if (sport === 'BADMINTON') {
      return {
        label: 'Cầu lông',
        icon: 'sports',
        color: 'text-secondary',
        fallbackColor: '#9d4300',
        defaultImage: '/assets/images/court-default-badminton.svg'
      };
    }
    if (sport === 'PICKLEBALL') {
      return {
        label: 'Pickleball',
        icon: 'sports',
        color: 'text-tertiary',
        fallbackColor: '#0051d5',
        defaultImage: '/assets/images/court-default-pickleball.svg'
      };
    }
    return {
      label: '--',
      icon: 'sports',
      color: 'text-on-surface-variant',
      fallbackColor: '#e9edff',
      defaultImage: '/assets/images/court-default-football-mini.svg'
    };
  }

  function statusClasses(code) {
    if (code === 'PENDING') return 'bg-orange-100 text-secondary';
    if (code === 'EXPIRED') return 'bg-gray-100 text-gray-400';
    if (code === 'CANCELLED') return 'bg-red-50 text-red-600';
    if (code === 'COMPLETED') return 'bg-blue-50 text-tertiary';
    if (code === 'UPCOMING') return 'bg-primary/10 text-primary';
    if (code === 'IN_PROGRESS') return 'bg-emerald-100 text-emerald-800 animate-pulse border border-emerald-200';
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
    node.title = `${node.dataset.statusLabel} · Còn lại ${state.formatCountdown(remaining)} để thanh toán`;
  }

  function createBookingFallbackCard(booking) {
    const fallback = document.createElement('article');
    const bookingCode = displayText(
      booking?.booking_code,
      booking?.booking_id ? `#${booking.booking_id}` : 'Đơn đặt sân'
    );
    fallback.className = 'booking-card bg-surface-container-lowest rounded-2xl border border-gray-100 p-4';
    fallback.dataset.bookingId = String(booking?.booking_id || '');
    fallback.setAttribute('role', 'status');
    fallback.textContent = `${bookingCode} · Không hiển thị được chi tiết`;
    return fallback;
  }

  function createBookingCard(booking, facilityData) {
    const slots = Array.isArray(booking?.slots)
      ? booking.slots.filter((slot) => slot && typeof slot === 'object')
      : [];
    const fromPath = currentPagePath();
    const presentation = state.getBookingPresentation(booking, fromPath);
    const firstSlot = slots[0] || {};
    const card = elements.template.content.firstElementChild.cloneNode(true);
    const detailUrl = window.SportBookingBackNav.buildDetailUrl(booking.booking_id, fromPath);
    const sport = sportPresentation(firstSlot.sport_type);
    const imageFrame = card.querySelector('[data-detail-image-link]');
    const image = card.querySelector('[data-booking-image]');
    const facilityHeading = card.querySelector('[data-facility-name]');
    const timeIcon = card.querySelector('[data-time-icon]');
    const status = card.querySelector('[data-status-badge]');
    const statusIcon = card.querySelector('[data-status-icon]');
    const ticketStatus = card.querySelector('[data-ticket-status]');
    const primaryAction = card.querySelector('[data-primary-action]');
    const primaryActionIcon = card.querySelector('[data-primary-action-icon]');
    const detailActionIcon = card.querySelector('[data-detail-action-icon]');
    const facilityAddressIcon = card.querySelector('[data-facility-address-icon]');
    const soonAction = card.querySelector('[data-soon-action]');
    const cancelAction = card.querySelector('[data-cancel-action]');
    const facility = facilityData?.facility;
    const facilityName = displayText(facility?.name, displayText(firstSlot.facility_name));
    const courtName = displayText(firstSlot.court_name);
    const showCourtName = courtName !== '--'
      && courtName.trim().toLowerCase() !== facilityName.trim().toLowerCase();

    card.dataset.status = booking.display_status_code;
    card.dataset.bookingId = String(booking.booking_id);
    card.dataset.category = displayText(firstSlot.sport_type, '');
    card.querySelector('[data-booking-code]').textContent = displayText(booking.booking_code);
    card.querySelector('[data-court-name]').textContent = courtName;
    card.querySelector('[data-court-name]').hidden = !showCourtName;
    card.querySelector('[data-court-separator]').hidden = !showCourtName;
    card.querySelector('[data-facility-name]').textContent = facilityName;
    image.alt = facilityName;
    const facilityAddress = card.querySelector('[data-facility-address]');
    facilityAddress.textContent = displayText(facility?.address);
    facilityAddress.title = displayText(facility?.address, '');
    const formattedDate = slots
      .map((slot) => formatDate(slot.service_date))
      .filter((date, index, dates) => dates.indexOf(date) === index)
      .join(' – ') || '--';
    card.querySelector('[data-date]').textContent = formattedDate;
    card.querySelector('[data-time-range]').textContent = slots
      .map((slot) => {
        const start = formatTime(slot.starts_at);
        const end = formatTime(slot.ends_at);
        return start === '--' || end === '--' ? '--' : `${start} – ${end}`;
      })
      .join(', ') || '--';
    const amount = card.querySelector('[data-paid-amount]');
    amount.textContent = formatMoney(booking.paid_amount);
    window.SportBookingIcons.setIcon(card.querySelector('[data-sport-icon]'), sport.icon);
    card.querySelector('[data-sport-icon]').classList.add(sport.color);
    window.SportBookingIcons.setIcon(timeIcon, 'schedule');
    window.SportBookingIcons.setIcon(facilityAddressIcon, 'location_on');
    window.SportBookingIcons.setIcon(detailActionIcon, 'arrow_forward');
    card.querySelector('[data-sport-label]').textContent = sport.label;

    imageFrame.style.backgroundColor = sport.fallbackColor;
    imageFrame.classList.toggle('grayscale', booking.display_status_code === 'CANCELLED');
    card.classList.toggle('opacity-80', booking.display_status_code === 'CANCELLED');
    facilityHeading.classList.toggle('text-gray-500', booking.display_status_code === 'CANCELLED');
    facilityHeading.classList.toggle('line-through', booking.display_status_code === 'CANCELLED');
    facilityHeading.classList.toggle('hover:text-primary', booking.display_status_code !== 'CANCELLED');
    if (booking.display_status_code === 'CANCELLED') {
      facilityHeading.classList.remove('text-on-surface');
    }

    const courtNameElement = card.querySelector('[data-court-name]');
    courtNameElement.classList.remove('text-primary', 'text-secondary', 'text-gray-600');
    courtNameElement.classList.add(
      booking.display_status_code === 'UPCOMING' || booking.display_status_code === 'IN_PROGRESS'
        ? 'text-primary'
        : (booking.display_status_code === 'PENDING' ? 'text-secondary' : 'text-gray-600')
    );
    timeIcon.classList.remove('text-primary', 'text-secondary', 'text-gray-400');
    timeIcon.classList.add(
      booking.display_status_code === 'UPCOMING' || booking.display_status_code === 'IN_PROGRESS'
        ? 'text-primary'
        : (booking.display_status_code === 'PENDING' ? 'text-secondary' : 'text-gray-400')
    );
    const statusLabel = status.querySelector('[data-status-label]');
    statusLabel.textContent = presentation.label;
    status.dataset.statusLabel = presentation.label;
    status.classList.add(...statusClasses(booking.display_status_code).split(' '));
    ticketStatus.textContent = presentation.ticketPresentation.label;
    ticketStatus.dataset.ticketStatus = presentation.ticketPresentation.status;
    ticketStatus.title = presentation.ticketPresentation.reason || presentation.ticketPresentation.label;
    const statusIcons = {
      PENDING: ['timer', 'text-secondary'],
      EXPIRED: ['timer', 'text-gray-400'],
      UPCOMING: ['check', 'text-primary'],
      IN_PROGRESS: ['timer', 'text-emerald-800'],
      COMPLETED: ['check_circle', 'text-tertiary'],
      CANCELLED: ['cancel', 'text-red-600']
    };
    const [statusIconName, statusIconColor] = statusIcons[booking.display_status_code];
    statusIcon.classList.add(statusIconColor);
    window.SportBookingIcons.setIcon(statusIcon, statusIconName);
    const detailAction = card.querySelector('[data-detail-link]');
    for (const link of [detailAction, imageFrame]) {
      link.href = detailUrl;
      link.addEventListener('click', (event) => {
        event?.preventDefault?.();
        window.location.assign(detailUrl);
      });
    }
    imageFrame.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        window.location.assign(detailUrl);
      }
    });
    facilityHeading.addEventListener('click', () => window.location.assign(detailUrl));
    let usingFacilityImage = Boolean(facility?.image_url);
    image.onerror = () => {
      if (usingFacilityImage) {
        usingFacilityImage = false;
        image.src = sport.defaultImage;
      } else {
        image.hidden = true;
      }
    };
    image.src = facility?.image_url || sport.defaultImage;

    const actionLabels = {
      'continue-payment': ['Tiếp tục thanh toán', presentation.href],
      'view-ticket': ['Xem vé', presentation.href]
    };
    if (actionLabels[presentation.action]) {
      const [label, href] = actionLabels[presentation.action];
      primaryAction.href = href;
      primaryAction.addEventListener('click', (event) => {
        event?.preventDefault?.();
        window.location.assign(href);
      });
      primaryAction.querySelector('[data-primary-action-label]').textContent = label;
      window.SportBookingIcons.setIcon(primaryActionIcon, 'arrow_forward');
      if (booking.status === 'PENDING') {
        primaryAction.classList.remove('py-2', 'bg-primary', 'hover:bg-primary-container', 'shadow-sm');
        primaryAction.classList.add('py-2.5', 'bg-secondary-container', 'hover:bg-secondary', 'shadow-md');
        detailAction.classList.replace('py-2', 'py-2.5');
      }
      primaryAction.hidden = false;
      soonAction.hidden = true;
    } else {
      primaryAction.hidden = true;
      const label = booking.display_status_code === 'COMPLETED' ? 'Đánh giá' : 'Đặt lại';
      soonAction.textContent = `${label} · Sắp có`;
      soonAction.hidden = false;
      soonAction.title = 'Sắp có';
    }
    const refundedAmount = booking.refunded_amount;
    const hasRefund = refundedAmount !== null && refundedAmount !== undefined
      && /^(?:[1-9]\d*)$/.test(String(refundedAmount));
    if (booking.display_status_code === 'CANCELLED') {
      if (hasRefund) {
        card.querySelector('[data-paid-label]').textContent = 'Đã hoàn:';
        amount.textContent = formatMoney(refundedAmount);
      }
      amount.classList.remove('text-primary');
      amount.classList.add(...(hasRefund ? ['text-gray-500'] : ['text-gray-400', 'line-through']));
    } else if (booking.display_status_code === 'COMPLETED') {
      amount.classList.remove('text-primary');
      amount.classList.add('text-on-surface');
    } else if (booking.display_status_code === 'PENDING') {
      amount.classList.remove('text-primary');
      amount.classList.add('text-secondary');
    }
    cancelAction.hidden = !state.canCancelBooking(booking);
    if (!cancelAction.hidden) {
      cancelAction.dataset.bookingId = booking.booking_id;
      cancelAction.disabled = false;
    }

    const countdown = card.querySelector('[data-countdown]');
    if (presentation.remainingSeconds !== null) {
      countdownText(status, presentation.remainingSeconds);
      current.countdowns.set(status, {
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
      let facilityData = null;
      try {
        facilityData = await getFacility(booking?.slots?.[0]?.facility_id);
      } catch (error) {
        console.error(
          `Không thể tải thông tin cơ sở của đơn ${booking?.booking_id || '(không rõ mã)'}.`,
          error
        );
      }
      try {
        return createBookingCard(booking, facilityData);
      } catch (error) {
        console.error(
          `Không thể hiển thị đơn đặt sân ${booking?.booking_id || '(không rõ mã)'}.`,
          { error, booking }
        );
        return createBookingFallbackCard(booking);
      }
    }));
    if (requestSequence !== current.requestSequence) return false;
    elements.list.replaceChildren(...cards);
    return true;
  }

  async function loadBookings({ quiet = false, refreshSummary = false } = {}) {
    if (current.loading && quiet) return;
    current.loading = true;
    const requestSequence = ++current.requestSequence;
    if (!quiet) showLoading();
    current.countdowns.clear();
    updateUrl();
    try {
      const shouldRefreshSummary = refreshSummary
        || !quiet
        || Date.now() - summaryRefreshedAt >= 30000;
      const [result, summary] = await Promise.all([
        window.SportBookingApi.listBookings({
          status: filterStatuses[current.filter],
          page: current.page,
          pageSize,
          q: current.q,
          sport: current.sport === 'all' ? undefined : current.sport
        }),
        shouldRefreshSummary
          ? window.SportBookingApi.getBookingSummary()
          : Promise.resolve(null)
      ]);
      if (requestSequence !== current.requestSequence || !result) return;
      if (shouldRefreshSummary && !summary) return;
      if (!Array.isArray(result.bookings) || !result.pagination) {
        throw new TypeError('Máy chủ trả về lịch sử đặt sân không hợp lệ.');
      }
      if (summary) {
        renderSummary(summary);
        summaryRefreshedAt = Date.now();
      }
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
      elements.errorMessage.textContent = '';
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
  elements.list.addEventListener('click', (event) => {
    const button = event.target.closest('[data-cancel-action]');
    if (!button || button.hidden) return;
    event.preventDefault();
    cancellationDialog.open(button.dataset.bookingId);
  });
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

  function startPageTimers() {
    if (document.hidden) return;
    if (!countdownTimer) countdownTimer = window.setInterval(() => {
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
    if (!historyPollTimer) {
      historyPollTimer = window.setInterval(() => loadBookings({ quiet: true }), 5000);
    }
  }

  function stopPageTimers() {
    window.clearInterval(countdownTimer);
    window.clearInterval(historyPollTimer);
    countdownTimer = null;
    historyPollTimer = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopPageTimers();
      return;
    }
    startPageTimers();
    loadBookings({ quiet: true, refreshSummary: true });
  });

  setTabStyle(elements.tabs.find((tab) => tab.dataset.filter === current.filter));
  startPageTimers();
  loadBookings();
})();
