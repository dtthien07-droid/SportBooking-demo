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
    slots: document.getElementById('bookingSlots'),
    total: document.getElementById('bookingTotal'),
    actions: document.getElementById('bookingActions'),
    confirm: document.getElementById('confirmBooking'),
    cancel: document.getElementById('cancelBooking'),
    timerPanel: document.getElementById('bookingTimerPanel'),
    timer: document.getElementById('bookingTimer'),
    bookingCode: document.getElementById('bookingCode'),
    message: document.getElementById('bookingMessage'),
    retry: document.getElementById('retryBookingLoad')
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

  function setBusy(busy) {
    state.busy = busy;
    elements.confirm.disabled = busy || Boolean(state.bookingId);
    elements.cancel.disabled = busy || !state.bookingId || state.timerRemaining <= 0;
  }

  function renderSummary(facilityName, courtName, serviceDate, slots) {
    elements.facilityName.textContent = facilityName || 'Cơ sở';
    elements.courtName.textContent = courtName || 'Sân';
    elements.serviceDate.textContent = formatDate(serviceDate);
    elements.slots.replaceChildren();

    const orderedSlots = [...slots].sort((left, right) => (
      left.starts_at.localeCompare(right.starts_at)
    ));
    for (const slot of orderedSlots) {
      const row = document.createElement('li');
      const time = document.createElement('span');
      const price = document.createElement('span');
      time.textContent = `${formatTime(slot.starts_at)} – ${formatTime(slot.ends_at)}`;
      price.textContent = formatCurrency(slot.price ?? slot.price_at_booking);
      row.append(time, price);
      elements.slots.append(row);
    }

    const total = orderedSlots.reduce(
      (sum, slot) => sum + Number(slot.price ?? slot.price_at_booking),
      0
    );
    elements.total.textContent = formatCurrency(total);
    elements.loading.hidden = true;
    elements.error.hidden = true;
    elements.summary.hidden = false;
  }

  function updateBookingUrl(bookingId) {
    const url = new URL(window.location.href);
    url.searchParams.set('booking_id', bookingId);
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    state.bookingId = bookingId;
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
      setMessage('Thời gian giữ chỗ đã hết. Khung giờ có thể được người khác đặt.', 'error');
    }
  }

  function showExpiredBooking() {
    clearInterval(state.timerId);
    state.timerId = null;
    state.timerRemaining = 0;
    if (elements.summary.hidden) {
      showError('Thời gian giữ chỗ đã hết. Vui lòng quay lại lịch sân để chọn khung giờ khác.', false);
      return;
    }
    elements.timerPanel.hidden = false;
    renderTimer(0);
    elements.confirm.disabled = true;
    elements.cancel.disabled = true;
    setMessage('Thời gian giữ chỗ đã hết. Khung giờ có thể được người khác đặt.', 'error');
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
    updateBookingUrl(state.bookingId);
    state.slots = booking.slots;
    state.serviceDate = booking.slots[0]?.service_date || state.serviceDate;
    const firstSlot = booking.slots[0];
    renderSummary(
      firstSlot?.facility_name,
      firstSlot?.court_name,
      state.serviceDate,
      booking.slots.map((slot) => ({
        ...slot,
        price: slot.price ?? slot.price_at_booking
      }))
    );
    elements.bookingCode.textContent = booking.booking_code || '';
    elements.bookingCode.hidden = !booking.booking_code;
    elements.actions.hidden = false;
    elements.confirm.hidden = true;
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
      renderSummary(state.facility.name, court.name, state.serviceDate, orderedSlots);
      elements.confirm.hidden = false;
      elements.cancel.hidden = true;
      elements.actions.hidden = false;
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
    setBusy(true);
    setMessage('Đang xác nhận và giữ khung giờ…', 'info');
    try {
      const booking = await window.SportBookingApi.createBooking(state.slotIds);
      if (!booking) return;
      showActiveBooking(booking);
    } catch (error) {
      if (error.status === 401) return;
      if (error.status === 409) {
        setMessage(
          error.code === 'PENDING_BOOKING_EXISTS'
            ? 'Bạn đang có đơn giữ sân chưa hoàn tất. Hãy tiếp tục hoặc hủy đơn đó trước.'
            : 'Khung giờ vừa được người khác chọn hoặc không còn khả dụng. Vui lòng quay lại chọn giờ khác.',
          'error'
        );
        return;
      }
      if (error.status === 410) {
        showExpiredBooking();
        return;
      }
      setMessage(error.message || 'Không thể xác nhận đặt sân. Vui lòng thử lại.', 'error');
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
      }
    } finally {
      setBusy(false);
    }
  }

  async function syncActiveBooking() {
    if (!state.bookingId || document.hidden) return;
    await loadExistingBooking();
  }

  elements.confirm.addEventListener('click', confirmBooking);
  elements.cancel.addEventListener('click', cancelBooking);
  elements.retry.addEventListener('click', () => {
    if (state.bookingId) loadExistingBooking();
    else loadSelection();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) syncActiveBooking();
  });
  window.setInterval(() => {
    if (state.bookingId && !document.hidden) syncActiveBooking();
  }, 5000);

  if (state.bookingId) loadExistingBooking();
  else loadSelection();
})();
