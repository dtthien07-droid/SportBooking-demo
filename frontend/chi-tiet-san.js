'use strict';

(() => {
  const query = new URLSearchParams(window.location.search);
  const facilityId = query.get('id');
  const dateKeys = getNextFourteenDates();
  const requestedDate = query.get('date');
  const requestedSlots = (query.get('slots') || '').split(',')
    .filter((id) => /^[1-9]\d*$/.test(id));
  const state = {
    facility: null,
    courts: [],
    court: null,
    date: dateKeys.includes(requestedDate) ? requestedDate : dateKeys[0],
    slots: [],
    dates: new Map(),
    selectedSlotIds: new Set(requestedSlots),
    requestSequence: 0,
    redirected: false,
    calendarLoading: false
  };

  const elements = {
    loading: document.getElementById('initialLoading'),
    error: document.getElementById('facilityErrorState'),
    errorMessage: document.getElementById('facilityErrorMessage'),
    retryFacility: document.getElementById('retryFacilityLoad'),
    errorBack: document.getElementById('facilityErrorBack'),
    content: document.getElementById('detailContent'),
    mobileBookingBar: document.getElementById('mobileBookingBar'),
    title: document.getElementById('facilityTitle'),
    pageTitle: document.getElementById('pageTitle'),
    back: document.getElementById('backToSearch'),
    image: document.getElementById('mainGalleryImg'),
    imageFallback: document.getElementById('mainImageFallback'),
    imageFallbackIcon: document.getElementById('mainImageFallbackIcon'),
    galleryUnavailable: document.getElementById('galleryUnavailable'),
    address: document.getElementById('facilityAddress'),
    hours: document.getElementById('facilityHours'),
    hotline: document.getElementById('facilityHotline'),
    callHotline: document.getElementById('btnCallHotline'),
    description: document.getElementById('facilityDescription'),
    sportBadge: document.getElementById('sportBadge'),
    sportIcon: document.getElementById('sportIcon'),
    sportText: document.getElementById('sportText'),
    sportNameHeader: document.getElementById('sportNameHeader'),
    sportNameBooking: document.getElementById('sportNameBooking'),
    ratingBadge: document.getElementById('ratingBadge'),
    ratingSummary: document.getElementById('ratingSummary'),
    priceNormal: document.getElementById('priceOffPeak'),
    pricePeak: document.getElementById('pricePeak'),
    priceRange: document.getElementById('bookingCardPriceRange'),
    mobilePrice: document.getElementById('mobileBottomPrice'),
    amenitiesSection: document.getElementById('amenitiesSection'),
    amenities: document.getElementById('amenitiesGrid'),
    policiesSection: document.getElementById('policiesSection'),
    cancellationCard: document.getElementById('cancellationPolicyCard'),
    cancellationText: document.getElementById('cancellationPolicyText'),
    rulesCard: document.getElementById('venueRulesCard'),
    rulesText: document.getElementById('venueRulesList'),
    mapSection: document.getElementById('mapSection'),
    mapLink: document.getElementById('btnExternalMaps'),
    mapNote: document.getElementById('mapSourceNote'),
    reviewBadge: document.getElementById('ratingBadge'),
    reviewScoreCard: document.getElementById('reviewScoreCard'),
    reviewScore: document.getElementById('reviewBigScore'),
    reviewEmpty: document.getElementById('reviewEmptyState'),
    courtContainer: document.getElementById('courtPickerContainer'),
    courtPicker: document.getElementById('courtPicker'),
    modeContainer: document.getElementById('gameModeContainer'),
    dateOptions: document.getElementById('slotDateOptions'),
    slotLoading: document.getElementById('slotLoadingState'),
    slotError: document.getElementById('slotErrorState'),
    slotErrorMessage: document.getElementById('slotErrorMessage'),
    retrySlots: document.getElementById('retrySlotsLoad'),
    slotEmpty: document.getElementById('slotEmptyState'),
    selectionNotice: document.getElementById('selectionNotice'),
    slotGrid: document.getElementById('timeSlotsGrid'),
    hoursSummary: document.getElementById('selectedHoursSummary'),
    priceSummary: document.getElementById('selectedPriceSummary'),
    proceedBooking: document.getElementById('btnProceedBooking'),
    mobileProceedBooking: document.getElementById('mobileProceedBooking')
  };

  function getNextFourteenDates() {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Ho_Chi_Minh',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(new Date());
    const part = (type) => parts.find((item) => item.type === type).value;
    const today = `${part('year')}-${part('month')}-${part('day')}`;
    const start = new Date(`${today}T00:00:00.000Z`);
    return Array.from({ length: 14 }, (_, offset) => {
      const date = new Date(start);
      date.setUTCDate(start.getUTCDate() + offset);
      return date.toISOString().slice(0, 10);
    });
  }

  function formatDate(date) {
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      weekday: 'short',
      day: '2-digit',
      month: '2-digit'
    }).format(new Date(`${date}T00:00:00+07:00`));
  }

  function safeImageUrl(value) {
    if (typeof value !== 'string' || value.trim() === '') return null;
    try {
      const url = new URL(value, window.location.origin);
      return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
    } catch {
      return null;
    }
  }

  function formatCurrency(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('Dữ liệu giá từ API không hợp lệ.');
    }
    return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(amount)} đ`;
  }

  function formatTime(value) {
    if (typeof value !== 'string' || !/^\d{2}:\d{2}(?::\d{2})?$/.test(value)) {
      throw new Error('Dữ liệu giờ từ API không hợp lệ.');
    }
    return value.slice(0, 5);
  }

  function updateUrl() {
    const url = new URL(window.location.href);
    url.searchParams.set('id', String(state.facility.id));
    url.searchParams.set('date', state.date);
    if (state.court) url.searchParams.set('court', String(state.court.id));
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  }

  function returnSearchUrl() {
    const fallback = '/tim-san.html';
    const returnTo = query.get('returnTo');
    if (!returnTo) return fallback;
    try {
      const url = new URL(returnTo, window.location.origin);
      return url.origin === window.location.origin && url.pathname === '/tim-san.html'
        ? `${url.pathname}${url.search}${url.hash}`
        : fallback;
    } catch {
      return fallback;
    }
  }

  function redirectToLogin() {
    if (state.redirected) return;
    state.redirected = true;
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.assign(`/dang-nhap.html?returnTo=${encodeURIComponent(returnTo)}`);
  }

  async function getJson(url) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch(url, {
        credentials: 'same-origin',
        signal: controller.signal
      });
    } catch (error) {
      const requestError = new Error(error.name === 'AbortError'
        ? 'Máy chủ phản hồi quá lâu. Vui lòng thử lại.'
        : 'Không thể kết nối tới máy chủ. Vui lòng thử lại.');
      requestError.cause = error;
      throw requestError;
    } finally {
      window.clearTimeout(timeout);
    }
    if (response.status === 401) {
      redirectToLogin();
      return null;
    }

    let data;
    try {
      data = await response.json();
    } catch {
      const error = new Error('Máy chủ trả về phản hồi không hợp lệ.');
      error.status = response.status;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(data && data.error && data.error.message
        ? data.error.message
        : 'Không thể tải dữ liệu sân. Vui lòng thử lại.');
      error.status = response.status;
      error.code = data && data.error ? data.error.code : undefined;
      throw error;
    }
    return data;
  }

  function showFacilityError(message, retryable) {
    elements.loading.hidden = true;
    elements.content.hidden = true;
    elements.error.hidden = false;
    elements.errorMessage.textContent = message;
    elements.retryFacility.hidden = !retryable;
  }

  function makeTextElement(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = text;
    return element;
  }

  function renderAmenities(amenities) {
    elements.amenities.replaceChildren();
    const entries = Array.isArray(amenities)
      ? amenities.filter((item) => typeof item === 'string' && item.trim())
      : [];
    elements.amenitiesSection.hidden = false;
    if (entries.length === 0) {
      elements.amenities.append(makeTextElement(
        'p',
        'col-span-full text-sm text-on-surface-variant',
        'Chưa có thông tin tiện ích.'
      ));
      return;
    }
    entries.forEach((amenity) => {
      const item = makeTextElement(
        'span',
        'rounded-xl bg-surface-container-low px-3 py-2 text-sm text-on-surface',
        amenity
      );
      elements.amenities.append(item);
    });
  }

  function renderPolicies(facility) {
    const cancellationPolicy = typeof facility.cancellation_policy === 'string'
      ? facility.cancellation_policy.trim()
      : '';
    const rules = typeof facility.rules === 'string' ? facility.rules.trim() : '';
    elements.cancellationCard.hidden = !cancellationPolicy;
    elements.rulesCard.hidden = !rules;
    elements.cancellationText.textContent = cancellationPolicy;
    elements.rulesText.textContent = rules;
    elements.policiesSection.hidden = !cancellationPolicy && !rules;
  }

  function renderMap(facility) {
    const supplied = typeof facility.map_url === 'string' ? facility.map_url.trim() : '';
    let url = null;
    let note = '';
    if (supplied.startsWith('https://')) {
      try {
        const parsed = new URL(supplied);
        if (parsed.protocol === 'https:') url = parsed.href;
      } catch {}
    }
    if (!url && facility.latitude !== null && facility.latitude !== undefined
        && facility.longitude !== null && facility.longitude !== undefined
        && Number.isFinite(Number(facility.latitude)) && Number.isFinite(Number(facility.longitude))) {
      url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${facility.latitude},${facility.longitude}`)}`;
      note = 'Theo tọa độ';
    } else if (!url && typeof facility.address === 'string' && facility.address.trim()) {
      url = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(facility.address.trim())}`;
      note = 'Theo địa chỉ';
    }
    elements.mapSection.hidden = !url;
    if (!url) return;
    elements.mapLink.href = url;
    elements.mapLink.target = '_blank';
    elements.mapLink.rel = 'noopener noreferrer';
    elements.mapNote.textContent = note;
  }

  function renderFacilityImage(facility, court) {
    const imageUrl = safeImageUrl(facility.image_url);
    const sport = String(court.sport_type || '').toUpperCase();
    const defaultImage = {
      BADMINTON: '/assets/images/court-default-badminton.svg',
      FOOTBALL_MINI: '/assets/images/court-default-football-mini.svg',
      PICKLEBALL: '/assets/images/court-default-pickleball.svg'
    }[sport];
    window.SportBookingIcons.setIcon(
      elements.imageFallbackIcon,
      sport === 'FOOTBALL_MINI' ? 'sports_soccer' : 'sports'
    );
    elements.imageFallback.setAttribute('aria-label', `Ảnh mặc định theo môn ${court.sport_name || ''}`);
    elements.galleryUnavailable.hidden = false;
    elements.image.onerror = () => {
      if (defaultImage && elements.image.dataset.fallbackApplied !== 'true') {
        elements.image.dataset.fallbackApplied = 'true';
        elements.image.src = defaultImage;
        elements.image.alt = `Ảnh mặc định theo môn ${court.sport_name || ''}`;
        return;
      }
      elements.image.hidden = true;
      elements.imageFallback.classList.remove('hidden');
      elements.imageFallback.classList.add('flex');
    };
    delete elements.image.dataset.fallbackApplied;
    if (imageUrl || defaultImage) {
      elements.image.src = imageUrl || defaultImage;
      elements.image.alt = imageUrl
        ? facility.name || ''
        : `Ảnh mặc định theo môn ${court.sport_name || ''}`;
      elements.image.hidden = false;
      elements.imageFallback.classList.add('hidden');
      elements.imageFallback.classList.remove('flex');
    } else {
      elements.image.removeAttribute('src');
      elements.image.hidden = true;
      elements.imageFallback.classList.remove('hidden');
      elements.imageFallback.classList.add('flex');
    }
  }

  function renderRating(court) {
    const rating = court.rating === null || court.rating === undefined
      ? Number.NaN
      : Number(court.rating);
    const hasRating = Number.isFinite(rating) && rating >= 1 && rating <= 5;
    elements.ratingBadge.hidden = !hasRating;
    elements.ratingSummary.textContent = hasRating ? `${rating.toFixed(1)}/5` : '';
    elements.reviewBadge.hidden = !hasRating;
    elements.reviewScoreCard.hidden = !hasRating;
    elements.reviewScore.textContent = hasRating ? `${rating.toFixed(1)}/5` : '';
    elements.reviewEmpty.hidden = hasRating;
    elements.reviewEmpty.textContent = 'Chưa có đánh giá';
  }

  function renderCourt(court) {
    state.court = court;
    const sportName = court.sport_name || court.sport_type || '';
    elements.sportText.textContent = sportName;
    elements.sportNameHeader.textContent = sportName;
    elements.sportNameBooking.textContent = sportName;
    window.SportBookingIcons.setIcon(
      elements.sportIcon,
      String(court.sport_type).toUpperCase() === 'FOOTBALL_MINI' ? 'sports_soccer' : 'sports'
    );
    const hasMode = ['BADMINTON', 'PICKLEBALL'].includes(String(court.sport_type).toUpperCase());
    elements.modeContainer.hidden = !hasMode;
    renderRating(court);

    const regular = formatCurrency(court.price_normal);
    const peak = formatCurrency(court.price_peak);
    elements.priceNormal.textContent = regular;
    elements.pricePeak.textContent = peak;
    elements.priceRange.textContent = `${regular} – ${peak}`;
    elements.mobilePrice.textContent = regular;

    if (typeof court.description === 'string' && court.description.trim()) {
      elements.description.textContent = court.description;
      elements.description.hidden = false;
    } else {
      elements.description.textContent = '';
      elements.description.hidden = true;
    }
  }

  function renderFacility(data) {
    if (!data || !data.facility || !Array.isArray(data.courts)) {
      throw new Error('Dữ liệu chi tiết sân từ API không đúng định dạng.');
    }
    state.facility = data.facility;
    state.courts = data.courts;
    const facility = state.facility;
    document.title = facility.name ? `${facility.name} - SportBooking` : 'Chi tiết sân - SportBooking';
    elements.title.textContent = facility.name || '';
    elements.pageTitle.textContent = document.title;
    elements.address.textContent = [facility.address, facility.district].filter(Boolean).join(', ');
    const opening = facility.opening_time ? formatTime(facility.opening_time) : '';
    const closing = facility.closing_time ? formatTime(facility.closing_time) : '';
    elements.hours.textContent = opening || closing ? `${opening} - ${closing}` : 'Chưa có thông tin giờ mở cửa';
    const hotline = typeof facility.hotline === 'string' ? facility.hotline.trim() : '';
    elements.hotline.textContent = hotline || 'Chưa có thông tin hotline';
    elements.callHotline.hidden = !hotline;
    if (hotline) elements.callHotline.href = `tel:${hotline.replace(/[^\d+]/g, '')}`;
    renderAmenities(facility.amenities);
    renderPolicies(facility);
    renderMap(facility);

    elements.courtPicker.replaceChildren();
    state.courts.forEach((court) => {
      const option = document.createElement('option');
      option.value = String(court.id);
      option.textContent = court.name || court.sport_name || String(court.id);
      elements.courtPicker.append(option);
    });
    elements.courtContainer.hidden = state.courts.length <= 1;
    if (state.courts.length === 0) {
      throw new Error('Sân này hiện chưa có sân con hoạt động để xem lịch.');
    }
    const requestedCourt = query.get('court');
    state.court = state.courts.find((court) => String(court.id) === requestedCourt)
      || state.courts[0];
    elements.courtPicker.value = String(state.court.id);
    renderFacilityImage(facility, state.court);
    renderCourt(state.court);
  }

  function validateSlots(data, court, date) {
    if (!data || String(data.court_id) !== String(court.id)
        || data.service_date !== date || !Array.isArray(data.time_slots)) {
      throw new Error('Dữ liệu lịch khung giờ từ API không đúng định dạng.');
    }
    data.time_slots.forEach((slot) => {
      if (!slot || slot.service_date !== date || String(slot.court_id) !== String(court.id)
          || slot.id === undefined || typeof slot.is_selectable !== 'boolean'
          || typeof slot.status !== 'string' || typeof slot.unavailable_reason !== 'string'
              && slot.unavailable_reason !== null) {
        throw new Error('Dữ liệu trạng thái khung giờ từ API không đúng định dạng.');
      }
      formatTime(slot.starts_at);
      formatTime(slot.ends_at);
      formatCurrency(slot.price);
    });
    return data.time_slots;
  }

  async function fetchDateSlots(court, date) {
    const params = new URLSearchParams({ date });
    const data = await getJson(`/api/v1/courts/${encodeURIComponent(court.id)}/time-slots?${params}`);
    if (!data) return null;
    return validateSlots(data, court, date);
  }

  function renderDateOptions() {
    elements.dateOptions.replaceChildren();
    dateKeys.forEach((date, index) => {
      const slots = state.dates.get(date);
      const checked = state.dates.has(date);
      const hasSlots = checked && Array.isArray(slots) && slots.length > 0;
      const button = document.createElement('button');
      button.type = 'button';
      button.disabled = state.calendarLoading || !hasSlots;
      button.setAttribute('aria-pressed', String(date === state.date));
      button.className = date === state.date
        ? 'rounded-xl border border-primary bg-primary px-2 py-2 text-xs font-bold text-white'
        : 'rounded-xl border border-gray-200 bg-white px-2 py-2 text-xs font-semibold text-on-surface disabled:cursor-not-allowed disabled:opacity-50';
      const caption = index === 0 ? 'Hôm nay' : formatDate(date);
      button.textContent = !checked
        ? `${caption} · Đang tải`
        : hasSlots
          ? `${caption} · ${slots.length} khung`
          : `${caption} · Không có khung`;
      if (hasSlots && !state.calendarLoading) {
        button.addEventListener('click', () => {
          if (state.date === date) return;
          state.date = date;
          state.selectedSlotIds.clear();
          elements.selectionNotice.hidden = true;
          updateUrl();
          renderDateOptions();
          refreshSelectedDate(true);
        });
      }
      elements.dateOptions.append(button);
    });
  }

  function getSlotLabel(slot) {
    if (slot.unavailable_reason === 'PAST_OR_TOO_SOON') return 'Đã qua / bắt đầu quá gần';
    if (slot.status === 'LOCKED') return 'Đang giữ chỗ';
    if (slot.status === 'BOOKED') return 'Đã đặt';
    if (slot.status === 'AVAILABLE' && slot.is_selectable) return 'Còn trống';
    return 'Không khả dụng';
  }

  function isPeakHour(slot) {
    const hour = Number(slot.starts_at.slice(0, 2));
    return hour >= 17 && hour < 21;
  }

  function compareSlots(left, right) {
    return left.starts_at.localeCompare(right.starts_at);
  }

  function contiguous(left, right) {
    return left.ends_at === right.starts_at;
  }

  function renderSelectionSummary() {
    const selected = state.slots
      .filter((slot) => state.selectedSlotIds.has(String(slot.id)))
      .sort(compareSlots);
    const total = selected.reduce((sum, slot) => sum + Number(slot.price), 0);
    elements.hoursSummary.textContent = `Đã chọn: ${selected.length} giờ`;
    elements.priceSummary.textContent = `Tạm tính: ${formatCurrency(total)}`;
    const canProceed = selected.length > 0;
    for (const button of [elements.proceedBooking, elements.mobileProceedBooking]) {
      button.disabled = !canProceed;
      button.classList.toggle('bg-primary', canProceed);
      button.classList.toggle('text-white', canProceed);
      button.classList.toggle('hover:bg-primary-container', canProceed);
      button.classList.toggle('bg-gray-300', !canProceed);
      button.classList.toggle('text-gray-600', !canProceed);
      button.classList.toggle('cursor-not-allowed', !canProceed);
      button.classList.toggle('cursor-pointer', canProceed);
    }
  }

  function continueToBooking() {
    const selectedIds = state.slots
      .filter((slot) => state.selectedSlotIds.has(String(slot.id)))
      .sort(compareSlots)
      .map((slot) => String(slot.id));
    if (selectedIds.length === 0 || !state.court || !state.facility) return;

    const params = new URLSearchParams({
      facility_id: String(state.facility.id),
      court_id: String(state.court.id),
      date: state.date,
      slots: selectedIds.join(',')
    });
    window.location.assign(`/dat-san.html?${params}`);
  }

  function renderSlots() {
    elements.slotGrid.replaceChildren();
    elements.slotEmpty.hidden = state.slots.length > 0;
    if (state.slots.length === 0) {
      elements.slotEmpty.textContent = `Ngày ${formatDate(state.date)} chưa có khung giờ. Vui lòng chọn ngày khác trong 14 ngày.`;
      renderSelectionSummary();
      return;
    }

    const availableCount = state.slots.filter(
      (slot) => slot.status === 'AVAILABLE' && slot.is_selectable
    ).length;
    if (availableCount === 0) {
      elements.slotEmpty.hidden = false;
      elements.slotEmpty.textContent = `Ngày ${formatDate(state.date)} không còn khung giờ có thể chọn. Vui lòng chọn ngày khác.`;
    } else {
      elements.slotEmpty.hidden = true;
      elements.slotEmpty.textContent = '';
    }

    state.slots.forEach((slot) => {
      const selected = state.selectedSlotIds.has(String(slot.id));
      const selectable = slot.status === 'AVAILABLE' && slot.is_selectable;
      const peak = isPeakHour(slot);
      const button = document.createElement('button');
      button.type = 'button';
      button.disabled = !selectable;
      button.setAttribute('aria-pressed', String(selected));
      button.setAttribute(
        'aria-label',
        `${formatTime(slot.starts_at)}–${formatTime(slot.ends_at)}, ${formatCurrency(slot.price)}, ${getSlotLabel(slot)}${selected ? ', Đang chọn' : ''}${peak ? ', Giờ vàng' : ''}`
      );
      button.className = selected
        ? 'rounded-xl border-2 border-primary bg-green-50 p-3 text-left text-sm shadow-sm'
        : `rounded-xl border p-3 text-left text-sm ${selectable ? 'border-gray-200 bg-white hover:border-primary' : 'border-gray-200 bg-gray-100 text-gray-500 cursor-not-allowed'}`;
      const time = makeTextElement('span', 'block font-bold', `${formatTime(slot.starts_at)} - ${formatTime(slot.ends_at)}`);
      const price = makeTextElement('span', 'mt-1 block font-semibold', formatCurrency(slot.price));
      const status = makeTextElement(
        'span',
        `mt-1 block text-xs ${slot.status === 'LOCKED' ? 'text-amber-800' : slot.status === 'BOOKED' ? 'text-error' : 'text-on-surface-variant'}`,
        selected ? `Đang chọn · ${getSlotLabel(slot)}` : getSlotLabel(slot)
      );
      button.append(time, price, status);
      if (peak) {
        button.append(makeTextElement(
          'span',
          'mt-1 inline-block rounded bg-secondary-fixed px-2 py-0.5 text-xs font-bold text-secondary',
          'Giờ vàng'
        ));
      }
      if (selectable) button.addEventListener('click', () => toggleSlot(slot));
      elements.slotGrid.append(button);
    });
    renderSelectionSummary();
  }

  function toggleSlot(slot) {
    elements.selectionNotice.hidden = true;
    const result = window.SportBookingSlotSelection.updateSlotSelection(
      state.slots,
      state.selectedSlotIds,
      slot
    );
    if (result.rejected) {
      elements.selectionNotice.textContent = 'Chỉ có thể chọn các khung giờ liền kề trên cùng sân và cùng ngày.';
      elements.selectionNotice.hidden = false;
      return;
    }
    state.selectedSlotIds = result.selectedSlotIds;
    renderSlots();
  }

  function keepAvailableSelection() {
    const previouslySelected = state.slots
      .filter((slot) => state.selectedSlotIds.has(String(slot.id)))
      .sort(compareSlots);
    const refreshedSelected = previouslySelected.map((oldSlot) => (
      state.slots.find((slot) => String(slot.id) === String(oldSlot.id))
    )).filter((slot) => slot && slot.status === 'AVAILABLE' && slot.is_selectable);
    const contiguousSelection = [];
    for (const slot of refreshedSelected) {
      const previous = contiguousSelection[contiguousSelection.length - 1];
      if (previous && !contiguous(previous, slot)) break;
      contiguousSelection.push(slot);
    }
    state.selectedSlotIds = new Set(contiguousSelection.map((slot) => String(slot.id)));
  }

  async function refreshSelectedDate(showLoading) {
    const requestSequence = ++state.requestSequence;
    if (showLoading) {
      elements.slotError.hidden = true;
      elements.slotEmpty.hidden = true;
      elements.slotGrid.replaceChildren();
      elements.slotLoading.hidden = false;
    }
    try {
      const slots = await fetchDateSlots(state.court, state.date);
      if (requestSequence !== state.requestSequence || slots === null) return;
      state.slots = slots;
      state.dates.set(state.date, slots);
      keepAvailableSelection();
      renderDateOptions();
      elements.slotLoading.hidden = true;
      renderSlots();
    } catch (error) {
      if (requestSequence !== state.requestSequence) return;
      state.slots = [];
      state.selectedSlotIds.clear();
      elements.slotLoading.hidden = true;
      elements.slotError.hidden = false;
      elements.slotErrorMessage.textContent = error.status === 404
        ? 'Không tìm thấy sân con để tải lịch. Vui lòng chọn sân khác hoặc quay lại tìm sân.'
        : error.message || 'Không thể tải lịch khung giờ. Vui lòng thử lại.';
      elements.retrySlots.hidden = error.status === 404;
      elements.slotGrid.replaceChildren();
      renderSelectionSummary();
    }
  }

  async function loadCalendar() {
    const requestSequence = ++state.requestSequence;
    state.calendarLoading = true;
    state.selectedSlotIds.clear();
    state.slots = [];
    state.dates.clear();
    elements.slotError.hidden = true;
    elements.slotEmpty.hidden = true;
    elements.slotGrid.replaceChildren();
    elements.slotLoading.hidden = false;
    renderSelectionSummary();
    try {
      for (const date of dateKeys) {
        const slots = await fetchDateSlots(state.court, date);
        if (requestSequence !== state.requestSequence || slots === null) return;
        state.dates.set(date, slots);
        renderDateOptions();
        if (date === state.date) {
          state.slots = slots;
          elements.slotLoading.hidden = true;
          renderSlots();
        }
      }
      state.slots = state.dates.get(state.date) || [];
      keepAvailableSelection();
      state.calendarLoading = false;
      renderDateOptions();
      elements.slotLoading.hidden = true;
      renderSlots();
    } catch (error) {
      if (requestSequence !== state.requestSequence) return;
      state.calendarLoading = false;
      state.slots = [];
      elements.slotLoading.hidden = true;
      elements.slotError.hidden = false;
      elements.slotErrorMessage.textContent = error.status === 404
        ? 'Không tìm thấy sân con để tải lịch. Vui lòng chọn sân khác hoặc quay lại tìm sân.'
        : error.message || 'Không thể tải lịch khung giờ. Vui lòng thử lại.';
      elements.retrySlots.hidden = error.status === 404;
      elements.slotGrid.replaceChildren();
      state.calendarLoading = false;
    }
  }

  async function loadFacility() {
    elements.loading.hidden = false;
    elements.error.hidden = true;
    elements.content.hidden = true;
    if (!facilityId) {
      showFacilityError('Thiếu ID sân. Vui lòng quay lại tìm sân và chọn một sân.', false);
      return;
    }
    try {
      const data = await getJson(`/api/v1/facilities/${encodeURIComponent(facilityId)}`);
      if (!data) return;
      renderFacility(data);
      elements.back.href = returnSearchUrl();
      elements.errorBack.href = returnSearchUrl();
      elements.loading.hidden = true;
      elements.error.hidden = true;
      elements.content.hidden = false;
      elements.mobileBookingBar.hidden = false;
      updateUrl();
      await loadCalendar();
    } catch (error) {
      const notFound = error.status === 404;
      showFacilityError(
        notFound
          ? 'Không tìm thấy sân hoặc sân không còn được công khai. Vui lòng quay lại tìm sân để chọn sân khác.'
          : error.message || 'Không thể tải thông tin sân. Vui lòng thử lại.',
        !notFound
      );
    }
  }

  elements.retryFacility.addEventListener('click', loadFacility);
  elements.proceedBooking.addEventListener('click', continueToBooking);
  elements.mobileProceedBooking.addEventListener('click', continueToBooking);
  elements.retrySlots.addEventListener('click', () => {
    elements.retrySlots.hidden = false;
    refreshSelectedDate(true);
  });
  elements.courtPicker.addEventListener('change', () => {
    const selectedCourt = state.courts.find(
      (court) => String(court.id) === elements.courtPicker.value
    );
    if (!selectedCourt) return;
    state.court = selectedCourt;
    state.dates.clear();
    state.selectedSlotIds.clear();
    renderCourt(selectedCourt);
    renderFacilityImage(state.facility, selectedCourt);
    updateUrl();
    loadCalendar();
  });

  loadFacility();
  window.setInterval(() => {
    if (!document.hidden && state.court && !state.calendarLoading && !elements.content.hidden) {
      refreshSelectedDate(false);
    }
  }, 5000);
})();
