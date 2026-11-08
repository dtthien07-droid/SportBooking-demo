'use strict';

(() => {
  const query = new URLSearchParams(window.location.search);
  const elements = {
    loading: document.getElementById('bookingLoading'),
    error: document.getElementById('bookingError'),
    errorMessage: document.getElementById('bookingErrorMessage'),
    summary: document.getElementById('bookingSummary'),
    facilityName: document.getElementById('facilityName'),
    courtName: document.getElementById('courtName'),
    serviceDate: document.getElementById('serviceDate'),
    slotSummary: document.getElementById('selectedSlotSummary'),
    slotDuration: document.getElementById('selectedDuration'),
    address: document.getElementById('facilityAddressText'),
    directions: document.getElementById('mapDirections'),
    sportName: document.getElementById('sportName'),
    sportIcon: document.getElementById('sportIcon'),
    basePrice: document.getElementById('basePrice'),
    total: document.getElementById('bookingTotal'),
    actions: document.getElementById('bookingActions'),
    confirm: document.getElementById('confirmBooking'),
    cancel: document.getElementById('cancelBooking'),
    timerPanel: document.getElementById('bookingTimerPanel'),
    timer: document.getElementById('bookingTimer'),
    bookingCode: document.getElementById('bookingCode'),
    message: document.getElementById('bookingMessage'),
    retry: document.getElementById('retryBookingLoad'),
    depositAmount: document.getElementById('depositPriceBadge'),
    depositVenue: document.getElementById('depositRemainingText'),
    fullAmount: document.getElementById('fullPriceBadge'),
    fullVenue: document.getElementById('fullRemainingText'),
    paymentOptions: document.getElementById('paymentOptions'),
    amountPayable: document.getElementById('amount-payable'),
    directionsNote: document.getElementById('mapDirectionsNote'),
    paymentComingSoon: document.getElementById('paymentComingSoon'),
    bookingBack: document.getElementById('bookingBack'),
    bottomBack: document.getElementById('bottomBookingBack'),
    bookerName: document.getElementById('bookerName'),
    bookerPhone: document.getElementById('bookerPhone'),
    bookerEmail: document.getElementById('bookerEmail'),
    refundText: document.getElementById('refundPolicyText'),
    matchToggle: document.getElementById('matchingToggle'),
    matchReason: document.getElementById('matchToggleReason'),
    matchOptions: document.getElementById('matchingOptions'),
    modeRandom: document.getElementById('modeRandom'),
    modeCriteria: document.getElementById('modeCriteria'),
    randomInfo: document.getElementById('randomSearchInfo'),
    criteria: document.getElementById('criteriaOptions'),
    matchMessage: document.getElementById('matchMessage'),
    matchMessageCount: document.getElementById('matchMessageCount'),
    continueOld: document.getElementById('continueOldBooking'),
    matchValidationError: document.getElementById('matchValidationError')
  };
  const state = {
    facilityId: query.get('facility_id'),
    courtId: query.get('court_id'),
    serviceDate: query.get('date'),
    slotIds: parseSlotIds(query.get('slots')),
    slots: [],
    facility: null,
    court: null,
    bookingId: query.get('booking_id'),
    timerRemaining: 0,
    timerStartedAt: 0,
    timerId: null,
    busy: false,
    retryAction: null,
    bookingLoadSequence: 0,
    loadingBooking: false
  };

  function parseSlotIds(value) {
    if (!value) return [];
    const ids = value.split(',');
    if (ids.length === 0 || ids.some((id) => !/^[1-9]\d*$/.test(id))
        || new Set(ids).size !== ids.length) {
      return [];
    }
    return ids;
  }

  function formatCurrency(value) {
    const amount = Number(value);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error('Dữ liệu giá từ máy chủ không hợp lệ.');
    }
    return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(amount)} đ`;
  }

  function formatDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new Error('Ngày chơi không hợp lệ.');
    }
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(new Date(`${value}T00:00:00+07:00`));
  }

  function formatTime(value) {
    if (typeof value !== 'string' || !/^\d{2}:\d{2}(?::\d{2})?$/.test(value)) {
      throw new Error('Khung giờ không hợp lệ.');
    }
    return value.slice(0, 5);
  }

  function setMessage(message, kind = 'info') {
    elements.message.textContent = message;
    elements.message.dataset.kind = kind;
    elements.message.hidden = !message;
  }

  function showError(message, retryable = true) {
    elements.loading.hidden = true;
    elements.summary.hidden = true;
    elements.error.hidden = false;
    elements.errorMessage.textContent = message;
    elements.retry.hidden = !retryable;
  }

  async function loadCurrentUser() {
    try {
      const user = await window.SportBookingHeaderReady;
      if (!user) return;
      elements.bookerName.value = user.fullName || '';
      elements.bookerPhone.value = user.phone || '';
      elements.bookerEmail.value = user.email || '';
    } catch (error) {
      setMessage(error.message || 'Không thể tải thông tin tài khoản.', 'error');
    }
  }

  function setBusy(busy) {
    state.busy = busy;
    elements.confirm.disabled = busy || Boolean(state.bookingId);
    elements.cancel.disabled = busy || !state.bookingId || state.timerRemaining <= 0;
    elements.paymentOptions.querySelectorAll('input').forEach((control) => {
      control.disabled = busy || Boolean(state.bookingId);
    });
    elements.matchToggle.disabled = busy || Boolean(state.bookingId) || state.matchTooLate;
    elements.matchOptions.querySelectorAll('button, input, textarea').forEach((control) => {
      control.disabled = busy || Boolean(state.bookingId);
    });
  }

  function resolveMapUrl(facility) {
    const supplied = typeof facility?.map_url === 'string' ? facility.map_url.trim() : '';
    if (supplied.startsWith('https://')) {
      try {
        const url = new URL(supplied);
        if (url.protocol === 'https:') return { url: url.href, note: '' };
      } catch {}
    }
    const latitude = Number(facility?.latitude);
    const longitude = Number(facility?.longitude);
    if (facility?.latitude !== null && facility?.latitude !== undefined
        && facility?.longitude !== null && facility?.longitude !== undefined
        && Number.isFinite(latitude) && Number.isFinite(longitude)) {
      return { url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${latitude},${longitude}`)}`, note: 'Theo tọa độ' };
    }
    const address = typeof facility?.address === 'string' ? facility.address.trim() : '';
    return address
      ? { url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`, note: 'Theo địa chỉ' }
      : { url: '', note: '' };
  }

  function renderSummary(facilityName, courtName, serviceDate, slots, facility = {}) {
    const normalizeName = (value) => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('vi');
    const sameName = facilityName && courtName && normalizeName(facilityName) === normalizeName(courtName);
    elements.facilityName.textContent = facilityName || 'Cơ sở';
    elements.courtName.textContent = sameName ? 'Sân mặc định' : (courtName || 'Sân');
    elements.courtName.hidden = false;
    elements.serviceDate.textContent = formatDate(serviceDate);
    const orderedSlots = [...slots].sort((left, right) => (
      left.starts_at.localeCompare(right.starts_at)
    ));
    elements.slotSummary.textContent = orderedSlots.map((slot) => (
      `${formatTime(slot.starts_at)} - ${formatTime(slot.ends_at)}`
    )).join(', ');
    const durationMinutes = orderedSlots.reduce((total, slot) => {
      const [startHour, startMinute] = formatTime(slot.starts_at).split(':').map(Number);
      const [endHour, endMinute] = formatTime(slot.ends_at).split(':').map(Number);
      return total + (endHour * 60 + endMinute) - (startHour * 60 + startMinute);
    }, 0);
    const hours = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;
    elements.slotDuration.textContent = [hours ? `${hours} giờ` : '', minutes ? `${minutes} phút` : '']
      .filter(Boolean).join(' ') + ' thi đấu';

    const total = orderedSlots.reduce(
      (sum, slot) => sum + Number(slot.price ?? slot.price_at_booking),
      0
    );
    elements.total.textContent = formatCurrency(total);
    elements.basePrice.textContent = formatCurrency(total);
    elements.address.textContent = facility.address || '';
    const map = resolveMapUrl(facility);
    elements.directions.href = map.url || '#';
    elements.directions.hidden = !map.url;
    elements.directions.target = '_blank';
    elements.directions.rel = 'noopener noreferrer';
    elements.directionsNote.textContent = map.note;
    document.getElementById('breadcrumbVenueName').textContent = facilityName || '';
    elements.sportName.textContent = state.court?.sport_name || state.court?.sport_type || 'Sân thể thao';
    elements.sportIcon.textContent = String(state.court?.sport_type).toUpperCase() === 'FOOTBALL_MINI'
      ? 'sports_soccer'
      : 'sports_tennis';
    elements.basePrice.textContent = formatCurrency(total);
    elements.total.parentElement.querySelector('span').textContent = 'Tổng tiền:';
    elements.refundText?.replaceChildren(document.createTextNode('Hoàn tiền theo chính sách rõ ràng'));
    elements.loading.hidden = true;
    elements.error.hidden = true;
    elements.summary.hidden = false;
  }

  function renderPaymentAmounts(booking = null) {
    const total = Number(booking?.total_amount ?? state.slots.reduce(
      (sum, slot) => sum + Number(slot.price ?? slot.price_at_booking), 0
    ));
    const deposit = booking?.deposit_amount === undefined
      ? Math.ceil(total / 2)
      : Number(booking.deposit_amount);
    const amountDue = Number(booking?.payment?.amount_due ?? (
      document.querySelector('input[name="paymentOption"]:checked')?.value === 'FULL' ? total : deposit
    ));
    if (booking) {
      elements.basePrice.textContent = formatCurrency(booking.total_amount);
      elements.total.textContent = formatCurrency(booking.total_amount);
    }
    elements.depositAmount.textContent = booking ? formatCurrency(deposit) : `${formatCurrency(deposit)} (tạm tính)`;
    elements.depositVenue.textContent = booking?.payment?.payment_option === 'DEPOSIT_50'
      ? `Còn thu tại sân: ${formatCurrency(booking.amount_due_at_venue)}`
      : booking ? 'Không áp dụng khi thanh toán toàn bộ' : 'Tạm tính';
    elements.fullAmount.textContent = booking ? formatCurrency(total) : `${formatCurrency(total)} (tạm tính)`;
    elements.fullVenue.textContent = booking ? 'Còn thu tại sân: 0 đ' : 'Tạm tính';
    elements.amountPayable.textContent = formatCurrency(amountDue);
    elements.depositAmount.closest('label').querySelector('.text-xs.font-bold.text-on-surface').textContent = 'Đặt cọc 50%';
    elements.fullAmount.closest('label').querySelector('.text-xs.font-bold.text-on-surface').textContent = 'Thanh toán toàn bộ';
    elements.amountPayable.parentElement.querySelector('span').textContent = 'Số tiền cần thanh toán ngay:';
    elements.confirm.querySelector('#ctaText').textContent = booking
      ? 'TIẾP TỤC ĐẾN THANH TOÁN'
      : `XÁC NHẬN ĐẶT SÂN (${formatCurrency(amountDue)})`;
    if (!booking) return;
    const paymentOption = booking.payment?.payment_option;
    if (paymentOption) {
      const radio = document.querySelector(`input[name="paymentOption"][value="${paymentOption}"]`);
      if (radio) radio.checked = true;
    }
  }

  function updateMatchMode() {
    const criteria = elements.modeCriteria.getAttribute('aria-pressed') === 'true';
    elements.modeRandom.setAttribute('aria-pressed', String(!criteria));
    elements.modeCriteria.setAttribute('aria-pressed', String(criteria));
    elements.modeRandom.classList.toggle('bg-white', !criteria);
    elements.modeRandom.classList.toggle('text-primary', !criteria);
    elements.modeRandom.classList.toggle('font-bold', !criteria);
    elements.modeRandom.classList.toggle('shadow-sm', !criteria);
    elements.modeCriteria.classList.toggle('bg-white', criteria);
    elements.modeCriteria.classList.toggle('text-primary', criteria);
    elements.modeCriteria.classList.toggle('font-bold', criteria);
    elements.modeCriteria.classList.toggle('shadow-sm', criteria);
    elements.randomInfo.classList.toggle('hidden', criteria);
    elements.criteria.classList.toggle('hidden', !criteria);
  }

  function setMatchAvailability(firstSlot) {
    const start = new Date(`${state.serviceDate}T${formatTime(firstSlot.starts_at)}:00+07:00`).getTime();
    state.matchTooLate = start - Date.now() < 30 * 60 * 1000;
    elements.matchToggle.disabled = state.matchTooLate;
    elements.matchReason.hidden = !state.matchTooLate;
    elements.matchReason.textContent = state.matchTooLate
      ? 'Không thể tìm đối vì khung giờ đầu bắt đầu trong vòng 30 phút.'
      : '';
  }

  function buildMatchPreference() {
    if (!elements.matchToggle.checked) return null;
    const criteria = elements.modeCriteria.getAttribute('aria-pressed') === 'true';
    const preference = { mode: criteria ? 'CRITERIA' : 'RANDOM', message: elements.matchMessage.value.trim() || null };
    if (criteria) {
      preference.gender = document.querySelector('.gender-btn.active')?.dataset.gender || 'ANY';
      preference.skill = document.querySelector('.skill-card.active')?.dataset.skill || 'INTERMEDIATE';
    }
    if (['BADMINTON', 'PICKLEBALL'].includes(String(state.court?.sport_type).toUpperCase())) {
      preference.format = document.querySelector('.format-card.active')?.dataset.format || 'DOUBLES';
    }
    return preference;
  }

  function restoreMatchPreference(preference) {
    elements.matchToggle.checked = Boolean(preference);
    elements.matchOptions.classList.toggle('hidden', !preference);
    if (!preference) return;
    elements.modeCriteria.setAttribute('aria-pressed', String(preference.mode === 'CRITERIA'));
    updateMatchMode();
    const gender = document.querySelector(`.gender-btn[data-gender="${preference.gender || 'ANY'}"]`);
    if (gender) markSelectedCard('.gender-btn', gender, 'span', '');
    const skill = document.querySelector(`.skill-card[data-skill="${preference.skill || 'INTERMEDIATE'}"]`);
    if (skill) markSelectedCard('.skill-card', skill, '.skill-radio', '✓');
    const format = document.querySelector(`.format-card[data-format="${preference.format || 'DOUBLES'}"]`);
    if (format) markSelectedCard('.format-card', format, '.format-radio', '●');
    elements.matchMessage.value = preference.message || '';
    elements.matchMessageCount.textContent = `${elements.matchMessage.value.length}/1000 ký tự`;
  }

  function updateBookingUrl(bookingId) {
    const url = new URL(window.location.href);
    url.searchParams.set('booking_id', bookingId);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    state.bookingId = bookingId;
  }

  function updateReturnLinks() {
    const url = new URL('/chi-tiet-san.html', window.location.origin);
    if (state.facilityId) url.searchParams.set('id', state.facilityId);
    if (state.courtId) url.searchParams.set('court', state.courtId);
    if (state.serviceDate) url.searchParams.set('date', state.serviceDate);
    if (state.slotIds.length) url.searchParams.set('slots', state.slotIds.join(','));
    const returnTo = `${url.pathname}${url.search}`;
    elements.bookingBack.dataset.href = returnTo;
    elements.bottomBack.dataset.href = returnTo;
  }

  function renderTimer(seconds) {
    const safeSeconds = Math.max(0, Math.floor(seconds));
    const minutes = Math.floor(safeSeconds / 60);
    const remainder = safeSeconds % 60;
    elements.timer.textContent = `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`;
    elements.timerPanel.dataset.urgent = String(safeSeconds > 0 && safeSeconds < 120);
    if (safeSeconds === 0) {
      clearInterval(state.timerId);
      state.timerId = null;
      elements.confirm.disabled = true;
      elements.cancel.disabled = true;
      setMessage('Hết thời gian giữ chỗ', 'error');
    }
  }

  function showExpiredBooking() {
    clearInterval(state.timerId);
    state.timerId = null;
    state.timerRemaining = 0;
    if (elements.summary.hidden) {
      showError('Hết thời gian giữ chỗ', false);
      return;
    }
    elements.timerPanel.hidden = false;
    renderTimer(0);
    elements.confirm.disabled = true;
    elements.cancel.disabled = true;
    setMessage('Hết thời gian giữ chỗ', 'error');
  }

  function startTimer(seconds) {
    clearInterval(state.timerId);
    state.timerRemaining = Math.max(0, Number(seconds) || 0);
    state.timerStartedAt = Date.now();
    elements.timerPanel.hidden = false;
    renderTimer(state.timerRemaining);
    if (state.timerRemaining === 0) return;

    state.timerId = window.setInterval(() => {
      const elapsed = Math.floor((Date.now() - state.timerStartedAt) / 1000);
      state.timerRemaining = Math.max(0, state.timerRemaining - elapsed);
      state.timerStartedAt = Date.now();
      renderTimer(state.timerRemaining);
      if (state.timerRemaining === 0) setBusy(false);
    }, 1000);
  }

  function showActiveBooking(booking) {
    if (!Array.isArray(booking.slots) || booking.slots.length === 0) {
      throw new Error('Dữ liệu đơn đặt sân không đúng định dạng.');
    }
    state.bookingId = String(booking.booking_id);
    state.courtId = String(booking.slots[0].court_id);
    state.facilityId = String(booking.slots[0].facility_id);
    updateBookingUrl(state.bookingId);
    state.slots = booking.slots;
    state.serviceDate = booking.slots[0]?.service_date || state.serviceDate;
    const firstSlot = booking.slots[0];
    const backUrl = new URL('/chi-tiet-san.html', window.location.origin);
    backUrl.searchParams.set('id', state.facilityId);
    backUrl.searchParams.set('court', state.courtId);
    backUrl.searchParams.set('date', state.serviceDate);
    backUrl.searchParams.set('slots', booking.slots.map((slot) => String(slot.time_slot_id)).join(','));
    elements.bottomBack.dataset.href = `${backUrl.pathname}${backUrl.search}`;
    elements.bookingBack.dataset.href = `${backUrl.pathname}${backUrl.search}`;
    renderSummary(
      firstSlot?.facility_name,
      firstSlot?.court_name,
      state.serviceDate,
      booking.slots.map((slot) => ({
        ...slot,
        price: slot.price ?? slot.price_at_booking
      })),
      state.facility || {}
    );
    renderPaymentAmounts(booking);
    const formatGrid = document.querySelector('.format-card')?.closest('.grid');
    if (formatGrid && state.court) {
      formatGrid.parentElement.hidden = !['BADMINTON', 'PICKLEBALL'].includes(String(state.court.sport_type).toUpperCase());
    }
    restoreMatchPreference(booking.match_preference);
    elements.bookingCode.textContent = booking.booking_code || '';
    elements.bookingCode.hidden = !booking.booking_code;
    elements.actions.hidden = false;
    elements.confirm.hidden = false;
    elements.paymentComingSoon.hidden = booking.status !== 'PENDING';
    elements.cancel.hidden = booking.status !== 'PENDING';
    if (booking.status === 'PENDING') {
      startTimer(booking.remaining_seconds);
      setMessage('Sân đang được giữ cho bạn. Hoàn tất bước tiếp theo trước khi đồng hồ về 00:00.', 'success');
    } else {
      elements.timerPanel.hidden = true;
      setMessage(
        booking.status === 'CANCELLED' ? 'Bạn đã hủy giữ chỗ.' : `Trạng thái đơn: ${booking.status}.`,
        booking.status === 'CANCELLED' ? 'success' : 'info'
      );
    }
    setBusy(false);
  }

  async function loadSelection() {
    elements.loading.hidden = false;
    elements.error.hidden = true;
    if (!state.facilityId || !state.courtId || !state.serviceDate || state.slotIds.length === 0) {
      showError('Thiếu hoặc sai thông tin sân/khung giờ. Vui lòng quay lại trang chi tiết sân.', false);
      return;
    }
    try {
      const [facilityData, slotData] = await Promise.all([
        window.SportBookingApi.getFacility(state.facilityId),
        window.SportBookingApi.getCourtSlots(state.courtId, state.serviceDate)
      ]);
      if (!facilityData || !slotData) return;
      const court = facilityData.courts.find((item) => String(item.id) === state.courtId);
      if (!court || String(slotData.court_id) !== state.courtId
          || slotData.service_date !== state.serviceDate
          || !Array.isArray(slotData.time_slots)) {
        throw new Error('Không tìm thấy sân hoặc lịch khung giờ không hợp lệ.');
      }

      const slotsById = new Map(slotData.time_slots.map((slot) => [String(slot.id), slot]));
      const selectedSlots = state.slotIds.map((id) => slotsById.get(id));
      if (selectedSlots.some((slot) => !slot || slot.status !== 'AVAILABLE' || !slot.is_selectable)) {
        throw new Error('Một hoặc nhiều khung giờ không còn khả dụng. Vui lòng chọn lại.');
      }
      const orderedSlots = [...selectedSlots].sort((left, right) => (
        left.starts_at.localeCompare(right.starts_at)
      ));
      for (let index = 1; index < orderedSlots.length; index += 1) {
        if (orderedSlots[index - 1].ends_at !== orderedSlots[index].starts_at) {
          throw new Error('Các khung giờ phải liền kề nhau. Vui lòng chọn lại.');
        }
      }

      state.facility = facilityData.facility;
      state.court = court;
      state.slots = orderedSlots;
      renderSummary(state.facility.name, court.name, state.serviceDate, orderedSlots, state.facility);
      elements.matchMessageCount.textContent = '0/1000 ký tự';
      setMatchAvailability(orderedSlots[0]);
      const formatGrid = document.querySelector('.format-card')?.closest('.grid');
      if (formatGrid) formatGrid.parentElement.hidden = !['BADMINTON', 'PICKLEBALL'].includes(String(court.sport_type).toUpperCase());
      updateMatchMode();
      elements.matchToggle.checked = false;
      updateReturnLinks();
      elements.confirm.hidden = false;
      elements.cancel.hidden = true;
      elements.paymentComingSoon.hidden = true;
      elements.actions.hidden = false;
      renderPaymentAmounts();
      setBusy(false);
    } catch (error) {
      if (error.status === 401) return;
      showError(error.message || 'Không thể tải thông tin đặt sân.');
    }
  }

  async function loadExistingBooking() {
    if (!state.bookingId || state.loadingBooking) return;
    state.loadingBooking = true;
    const bookingId = state.bookingId;
    const sequence = ++state.bookingLoadSequence;
    elements.loading.hidden = false;
    try {
      const booking = await window.SportBookingApi.getBooking(bookingId);
      if (sequence !== state.bookingLoadSequence || bookingId !== state.bookingId) return;
      if (!booking) return;
      state.slotIds = booking.slots.map((slot) => String(slot.time_slot_id));
      if (!state.facility) {
        const facilityData = await window.SportBookingApi.getFacility(booking.slots[0].facility_id);
        if (facilityData) {
          state.facility = facilityData.facility;
          state.court = facilityData.courts.find((court) => String(court.id) === String(booking.slots[0].court_id));
        }
      }
      showActiveBooking(booking);
    } catch (error) {
      if (sequence !== state.bookingLoadSequence || bookingId !== state.bookingId) return;
      if (error.status === 401) return;
      if (error.status === 410) {
        showExpiredBooking();
        return;
      }
      showError(error.message || 'Không thể tải trạng thái đơn đặt sân.');
    } finally {
      if (sequence === state.bookingLoadSequence) state.loadingBooking = false;
    }
  }

  async function confirmBooking() {
    if (state.busy || state.bookingId || state.slots.length === 0) return;
    document.getElementById('retryBookingAction').hidden = true;
    elements.matchValidationError.hidden = true;
    setBusy(true);
    setMessage('Đang xác nhận và giữ khung giờ…', 'info');
    try {
      const paymentOption = document.querySelector('input[name="paymentOption"]:checked')?.value || 'DEPOSIT_50';
      const booking = await window.SportBookingApi.createBooking(
        state.slotIds,
        paymentOption,
        buildMatchPreference()
      );
      if (!booking) return;
      showActiveBooking(booking);
    } catch (error) {
      if (error.status === 401) return;
      if (error.status === 409) {
        if (error.code === 'PENDING_BOOKING_EXISTS') {
          setMessage('Bạn đang có đơn chờ thanh toán. Hãy tiếp tục đơn cũ hoặc hủy đơn đó trước.', 'error');
          const existingId = error.details?.booking_id || error.details?.bookingId;
          if (existingId) {
            elements.continueOld.href = `/dat-san.html?booking_id=${encodeURIComponent(existingId)}`;
            elements.continueOld.hidden = false;
          }
        } else {
          setMessage('Khung giờ vừa được người khác chọn hoặc không còn khả dụng. Vui lòng quay lại chọn giờ khác.', 'error');
        }
        return;
      }
      if (error.status === 400) {
        if (String(error.code || '').includes('MATCH')) {
          elements.matchValidationError.textContent = error.message;
          elements.matchValidationError.hidden = false;
        } else setMessage(error.message || 'Thông tin đặt sân chưa hợp lệ.', 'error');
        return;
      }
      if (error.status === 410) {
        showExpiredBooking();
        return;
      }
      setMessage(error.message || 'Không thể kết nối tới máy chủ. Vui lòng thử lại.', 'error');
      state.retryAction = confirmBooking;
      document.getElementById('retryBookingAction').hidden = false;
    } finally {
      setBusy(false);
    }
  }

  async function cancelBooking() {
    if (state.busy || !state.bookingId || state.timerRemaining <= 0) return;
    setBusy(true);
    setMessage('Đang hủy giữ chỗ…', 'info');
    try {
      const result = await window.SportBookingApi.cancelBooking(state.bookingId);
      if (!result) return;
      state.bookingLoadSequence += 1;
      state.loadingBooking = false;
      clearInterval(state.timerId);
      state.timerId = null;
      state.bookingId = null;
      elements.timerPanel.hidden = true;
      elements.cancel.hidden = true;
      elements.paymentComingSoon.hidden = true;
      renderPaymentAmounts();
      setMessage('Đã hủy giữ chỗ và giải phóng khung giờ.', 'success');
      const back = document.createElement('a');
      back.href = `/chi-tiet-san.html?id=${encodeURIComponent(state.facilityId)}&court=${encodeURIComponent(state.courtId)}&date=${encodeURIComponent(state.serviceDate)}`;
      back.className = 'sb-booking-return';
      back.textContent = 'Quay lại lịch khung giờ';
      elements.message.append(back);
    } catch (error) {
      if (error.status === 401) return;
      if (error.status === 410) {
        showExpiredBooking();
      } else if (error.status === 409) {
        setMessage('Đơn đã thay đổi trạng thái. Tải lại để xem trạng thái mới.', 'error');
      } else {
        setMessage(error.message || 'Không thể hủy giữ chỗ. Vui lòng thử lại.', 'error');
        state.retryAction = cancelBooking;
        document.getElementById('retryBookingAction').hidden = false;
      }
    } finally {
      setBusy(false);
    }
  }

  async function syncActiveBooking() {
    if (!state.bookingId || document.hidden) return;
    await loadExistingBooking();
  }

  function markSelectedCard(selector, selected, markerSelector, markerText) {
    document.querySelectorAll(selector).forEach((card) => {
      const active = card === selected;
      card.classList.toggle('active', active);
      card.classList.toggle('border-2', active);
      card.classList.toggle('border-primary', active);
      card.classList.toggle('bg-emerald-50/40', active);
      card.classList.toggle('border', !active);
      card.classList.toggle('border-gray-200', !active);
      const marker = card.querySelector(markerSelector);
      if (marker) marker.textContent = active ? markerText : '';
      if (card.matches('.gender-btn')) {
        card.classList.toggle('bg-primary', active);
        card.classList.toggle('text-white', active);
        card.classList.toggle('font-bold', active);
        card.classList.toggle('shadow-sm', active);
        card.classList.toggle('bg-surface-container-low', !active);
        card.classList.toggle('text-on-surface', !active);
        card.classList.toggle('font-semibold', !active);
      }
    });
  }

  function goBackToSlots() {
    if (elements.bookingBack.dataset.href) window.location.assign(elements.bookingBack.dataset.href);
  }

  elements.confirm.addEventListener('click', confirmBooking);
  elements.cancel.addEventListener('click', cancelBooking);
  elements.retry.addEventListener('click', () => {
    if (state.bookingId) loadExistingBooking();
    else loadSelection();
  });
  elements.matchToggle.addEventListener('change', () => {
    elements.matchValidationError.hidden = true;
    elements.matchOptions.classList.toggle('hidden', !elements.matchToggle.checked);
    if (elements.matchToggle.checked) updateMatchMode();
  });
  elements.modeRandom.addEventListener('click', () => {
    elements.modeCriteria.setAttribute('aria-pressed', 'false');
    updateMatchMode();
  });
  elements.modeCriteria.addEventListener('click', () => {
    elements.modeCriteria.setAttribute('aria-pressed', 'true');
    updateMatchMode();
  });
  elements.matchMessage.addEventListener('input', () => {
    elements.matchMessageCount.textContent = `${elements.matchMessage.value.length}/1000 ký tự`;
  });
  document.querySelectorAll('input[name="paymentOption"]').forEach((radio) => {
    radio.addEventListener('change', () => renderPaymentAmounts());
  });
  document.querySelectorAll('.gender-btn').forEach((button, index) => {
    button.dataset.gender = ['MALE', 'FEMALE', 'ANY'][index];
    button.addEventListener('click', () => markSelectedCard('.gender-btn', button, 'span', ''));
  });
  document.querySelectorAll('.skill-card').forEach((card) => {
    card.addEventListener('click', () => markSelectedCard('.skill-card', card, '.skill-radio', '✓'));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        markSelectedCard('.skill-card', card, '.skill-radio', '✓');
      }
    });
  });
  document.querySelectorAll('.format-card').forEach((card) => {
    card.addEventListener('click', () => markSelectedCard('.format-card', card, '.format-radio', '●'));
    card.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        markSelectedCard('.format-card', card, '.format-radio', '●');
      }
    });
  });
  elements.bookingBack.addEventListener('click', goBackToSlots);
  elements.bottomBack.addEventListener('click', goBackToSlots);
  document.getElementById('retryBookingAction').addEventListener('click', () => {
    document.getElementById('retryBookingAction').hidden = true;
    if (state.retryAction) state.retryAction();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncActiveBooking();
  });
  window.setInterval(() => {
    if (state.bookingId && !document.hidden) syncActiveBooking();
  }, 5000);

  loadCurrentUser();
  if (state.bookingId) loadExistingBooking();
  else loadSelection();
})();
