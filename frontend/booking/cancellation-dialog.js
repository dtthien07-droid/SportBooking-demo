'use strict';

(() => {
  const state = window.SportBookingHistoryState;
  const elements = {
    modal: document.getElementById('cancel-modal'),
    close: document.getElementById('btn-close-modal'),
    keep: document.getElementById('btn-keep-court'),
    confirm: document.getElementById('btn-confirm-cancel'),
    confirmLabel: document.getElementById('btn-confirm-cancel-label'),
    reason: document.getElementById('selectCancelReason'),
    message: document.getElementById('cancel-dialog-message'),
    code: document.getElementById('displayModalOrderId'),
    facility: document.getElementById('displayModalVenueName'),
    court: document.getElementById('displayModalCourtNumber'),
    time: document.getElementById('displayModalMatchTime'),
    date: document.getElementById('displayModalMatchDate'),
    paid: document.getElementById('displayModalPaidAmount'),
    percent: document.getElementById('displayModalRefundPercentBadge'),
    policy: document.getElementById('displayModalRefundPolicyDesc'),
    refund: document.getElementById('displayModalRefundAmount'),
    banner: document.getElementById('bannerRefundText'),
    countdown: document.getElementById('cancel-countdown-value'),
    progressMarker: document.getElementById('cancel-refund-progress-marker'),
    refundLevel: document.getElementById('cancel-refund-level-label'),
    support: document.getElementById('cancel-support'),
    supportPhone: document.getElementById('cancel-support-phone')
  };
  let activeBookingId = null;
  let activeBooking = null;
  let activeFacility = null;
  let activePreview = null;
  let countdownTimer = null;
  let deadlineMs = null;
  let serverOffsetMs = 0;
  let lastSecondsUntilStart = null;
  let refreshingPreview = false;
  let previewRefreshFailed = false;
  let busy = false;
  let successHandler = null;

  function money(value) {
    const amount = String(value);
    if (!/^(0|[1-9]\d*)$/.test(amount)) {
      throw new TypeError('Số tiền trong thông tin hoàn tiền không hợp lệ.');
    }
    return `${new Intl.NumberFormat('vi-VN').format(BigInt(amount))} đ`;
  }

  function date(value) {
    const raw = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
      throw new TypeError('Ngày trong đơn đặt sân không hợp lệ.');
    }
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(new Date(`${raw}T12:00:00+07:00`));
  }

  function time(value) {
    const match = /^(\d{2}:\d{2})(?::\d{2})?$/.exec(String(value || ''));
    if (!match) throw new TypeError('Khung giờ trong đơn đặt sân không hợp lệ.');
    return match[1];
  }

  function formatPolicyDuration(seconds) {
    const wholeMinutes = Math.floor(Math.max(0, seconds) / 60);
    const hours = Math.floor(wholeMinutes / 60);
    const minutes = wholeMinutes % 60;
    if (hours === 0) return `${minutes} phút`;
    return minutes === 0 ? `${hours} giờ` : `${hours} giờ ${minutes} phút`;
  }

  function validatePreview(preview) {
    const seconds = Number(preview?.seconds_until_start);
    const serverTime = Date.parse(preview?.server_time);
    if (![0, 50, 100].includes(preview?.refund_percent)
        || !/^(0|[1-9]\d*)$/.test(String(preview?.refund_amount))
        || !/^(0|[1-9]\d*)$/.test(String(preview?.paid_amount))
        || !Number.isSafeInteger(seconds)
        || seconds < 0
        || !Number.isFinite(serverTime)
        || !String(preview.server_time).endsWith('Z')
        || typeof preview.message !== 'string') {
      throw new TypeError('Máy chủ trả về thông tin hoàn tiền không hợp lệ.');
    }
    return { seconds, serverTime };
  }

  function showMessage(message, isError = true) {
    elements.message.textContent = message;
    elements.message.hidden = !message;
    elements.message.dataset.kind = isError ? 'error' : 'success';
    elements.message.classList.toggle('text-error', isError);
    elements.message.classList.toggle('text-primary', !isError);
  }

  function setModalVisible(visible) {
    elements.modal.hidden = !visible;
    elements.modal.classList.toggle('hidden', !visible);
  }

  function stopCountdown() {
    if (countdownTimer !== null) {
      window.clearInterval(countdownTimer);
      countdownTimer = null;
    }
    deadlineMs = null;
    lastSecondsUntilStart = null;
  }

  function close() {
    if (busy) return;
    stopCountdown();
    activeBookingId = null;
    activeBooking = null;
    activeFacility = null;
    activePreview = null;
    refreshingPreview = false;
    previewRefreshFailed = false;
    setModalVisible(false);
  }

  function setConfirmEnabled(enabled) {
    elements.confirm.disabled = !enabled;
    elements.confirm.classList.toggle('cursor-not-allowed', !enabled);
    elements.confirm.classList.toggle('opacity-60', !enabled);
    elements.confirm.classList.toggle('cursor-pointer', enabled);
  }

  function setRefundLevel(percent) {
    const labels = {
      100: 'Mức hoàn hiện tại: Hoàn 100%',
      50: 'Mức hoàn hiện tại: Hoàn 50%',
      0: activeBooking?.status === 'PENDING'
        ? 'Mức hoàn hiện tại: Đơn chờ thanh toán · không hoàn tiền'
        : 'Mức hoàn hiện tại: Không hoàn tiền'
    };
    elements.refundLevel.textContent = labels[percent];
  }

  function updateProgress(seconds) {
    const sixHours = 6 * 60 * 60;
    const twentyFourHours = 24 * 60 * 60;
    const fortyEightHours = 48 * 60 * 60;
    let position;
    if (seconds < sixHours) {
      position = (seconds / sixHours) * 33.333;
    } else if (seconds < twentyFourHours) {
      position = 33.333 + ((seconds - sixHours) / (18 * 60 * 60)) * 33.334;
    } else {
      position = 66.667 + (Math.min(seconds, fortyEightHours) - twentyFourHours)
        / twentyFourHours * 33.333;
    }
    elements.progressMarker.style.left = `${Math.max(0, Math.min(100, position))}%`;
  }

  function remainingSeconds() {
    if (deadlineMs === null) return 0;
    return Math.max(0, Math.ceil((deadlineMs - (Date.now() + serverOffsetMs)) / 1000));
  }

  function updateCountdown() {
    if (!activePreview || deadlineMs === null) return;
    const seconds = remainingSeconds();
    const previous = lastSecondsUntilStart;
    elements.countdown.textContent = state.formatStartCountdown(seconds);
    updateProgress(seconds);
    lastSecondsUntilStart = seconds;
    if (seconds === 0) {
      setConfirmEnabled(false);
      showMessage('Đơn đã bắt đầu, không thể hủy');
      return;
    }
    if (!busy && !refreshingPreview && !previewRefreshFailed) setConfirmEnabled(true);
    if (previous !== null
        && ((previous >= 24 * 60 * 60 && seconds < 24 * 60 * 60)
          || (previous >= 6 * 60 * 60 && seconds < 6 * 60 * 60))) {
      void refreshPreview();
    }
  }

  function renderPreview(preview, requestStartedAt = Date.now(), responseReceivedAt = Date.now()) {
    const { seconds, serverTime } = validatePreview(preview);
    activePreview = preview;
    previewRefreshFailed = false;
    serverOffsetMs = serverTime - (requestStartedAt + responseReceivedAt) / 2;
    deadlineMs = serverTime + seconds * 1000;
    lastSecondsUntilStart = seconds;
    elements.paid.textContent = money(preview.paid_amount);
    elements.percent.textContent = `${preview.refund_percent}% Hoàn tiền`;
    elements.policy.textContent = `Còn ${formatPolicyDuration(seconds)}. ${preview.message}`;
    elements.refund.textContent = money(preview.refund_amount);
    elements.banner.textContent = money(preview.refund_amount);
    elements.confirmLabel.textContent = state.getCancelConfirmationLabel(
      preview.refund_amount,
      activeBooking.status === 'PENDING'
    );
    setRefundLevel(preview.refund_percent);
    updateProgress(seconds);
    showMessage('', false);
    updateCountdown();
  }

  function renderSupport(facility) {
    const hotline = String(facility?.hotline || '').trim();
    const phoneNumber = hotline.replace(/[^\d+]/g, '');
    if (!phoneNumber) {
      elements.support.hidden = true;
      elements.supportPhone.removeAttribute('href');
      elements.supportPhone.textContent = '';
      return;
    }
    elements.supportPhone.href = `tel:${phoneNumber}`;
    elements.supportPhone.textContent = hotline;
    elements.support.hidden = false;
  }

  function render(booking, preview, facilityData, requestStartedAt, responseReceivedAt) {
    if (!state.canCancelBooking(booking)) {
      throw new Error('Đơn không còn đủ điều kiện để hủy.');
    }
    if (!Array.isArray(booking.slots) || booking.slots.length === 0) {
      throw new TypeError('Đơn đặt sân không có khung giờ.');
    }
    activeBooking = booking;
    activeFacility = facilityData?.facility || null;
    const first = booking.slots[0];
    elements.code.textContent = `#${booking.booking_code || booking.booking_id}`;
    elements.facility.textContent = first.facility_name || '--';
    elements.court.textContent = first.court_name || '--';
    elements.time.textContent = booking.slots.map((slot) =>
      `${time(slot.starts_at)} – ${time(slot.ends_at)}`
    ).join(', ');
    elements.date.textContent = booking.slots
      .map((slot) => date(slot.service_date))
      .filter((value, index, values) => values.indexOf(value) === index)
      .join(' – ');
    renderSupport(activeFacility);
    renderPreview(preview, requestStartedAt, responseReceivedAt);
    elements.keep.disabled = false;
    elements.keep.classList.remove('cursor-not-allowed', 'opacity-60');
    elements.keep.classList.add('cursor-pointer');
  }

  async function refreshPreview() {
    if (refreshingPreview || !activeBookingId || !activeBooking) return;
    refreshingPreview = true;
    setConfirmEnabled(false);
    try {
      const bookingId = activeBookingId;
      const requestStartedAt = Date.now();
      const preview = await window.SportBookingApi.getRefundPreview(bookingId);
      const responseReceivedAt = Date.now();
      if (bookingId !== activeBookingId || !preview) return;
      renderPreview(preview, requestStartedAt, responseReceivedAt);
    } catch (error) {
      previewRefreshFailed = true;
      showMessage(error.message || 'Không thể cập nhật thông tin hoàn tiền.');
      setConfirmEnabled(false);
    } finally {
      refreshingPreview = false;
      if (activeBookingId && remainingSeconds() > 0 && activePreview && !busy
          && !previewRefreshFailed) {
        setConfirmEnabled(true);
      }
    }
  }

  async function open(bookingId) {
    stopCountdown();
    activeBookingId = String(bookingId);
    activeBooking = null;
    activeFacility = null;
    activePreview = null;
    previewRefreshFailed = false;
    setConfirmEnabled(false);
    elements.keep.disabled = true;
    elements.reason.value = '';
    elements.support.hidden = true;
    showMessage('Đang tải thông tin hoàn tiền...', false);
    setModalVisible(true);
    try {
      const requestStartedAt = Date.now();
      const [booking, preview] = await Promise.all([
        window.SportBookingApi.getBooking(activeBookingId),
        window.SportBookingApi.getRefundPreview(activeBookingId)
      ]);
      const responseReceivedAt = Date.now();
      if (!booking || !preview || activeBookingId !== String(bookingId)) return;
      const facilityId = booking.slots?.[0]?.facility_id;
      const facilityData = facilityId
        ? await window.SportBookingApi.getFacility(facilityId)
        : null;
      if (activeBookingId !== String(bookingId)) return;
      render(booking, preview, facilityData, requestStartedAt, responseReceivedAt);
      countdownTimer = window.setInterval(updateCountdown, 1000);
    } catch (error) {
      stopCountdown();
      showMessage(error.message || 'Không thể tải thông tin hoàn tiền.');
      setConfirmEnabled(false);
    }
  }

  async function confirm() {
    if (busy || !activeBookingId || !activePreview || previewRefreshFailed) return;
    updateCountdown();
    if (remainingSeconds() <= 0 || refreshingPreview) return;
    busy = true;
    setConfirmEnabled(false);
    showMessage('Đang xử lý yêu cầu hủy...', false);
    try {
      const reason = elements.reason.value.trim();
      const result = await window.SportBookingApi.cancelBooking(
        activeBookingId,
        reason || undefined,
        activePreview
      );
      if (!result || result.status !== 'CANCELLED') {
        throw new TypeError('Máy chủ trả về kết quả hủy không hợp lệ.');
      }
      const successMessage = `Đơn đã hủy. Số tiền đã hoàn: ${money(result.refunded_amount)}.`;
      const context = {
        bookingId: activeBookingId,
        bookingCode: activeBooking.booking_code,
        bookingStatus: activeBooking.status
      };
      stopCountdown();
      setModalVisible(false);
      activeBookingId = null;
      activeBooking = null;
      activeFacility = null;
      activePreview = null;
      if (typeof successHandler === 'function') {
        await successHandler(result, successMessage, context);
      }
    } catch (error) {
      showMessage(error.message || 'Không thể hủy đơn.');
      if (error.status === 409) {
        try {
          const booking = await window.SportBookingApi.getBooking(activeBookingId);
          if (!booking || !state.canCancelBooking(booking)) {
            stopCountdown();
            setModalVisible(false);
            activeBookingId = null;
            activeBooking = null;
            activeFacility = null;
            activePreview = null;
            if (typeof successHandler === 'function') await successHandler(null, error.message);
          } else {
            const requestStartedAt = Date.now();
            const preview = await window.SportBookingApi.getRefundPreview(activeBookingId);
            const responseReceivedAt = Date.now();
            render(
              booking,
              preview,
              { facility: activeFacility },
              requestStartedAt,
              responseReceivedAt
            );
            showMessage(error.message);
          }
        } catch (refreshError) {
          showMessage(refreshError.message || error.message);
        }
      }
    } finally {
      busy = false;
      if (activePreview) updateCountdown();
      else setConfirmEnabled(false);
    }
  }

  elements.close.addEventListener('click', close);
  elements.keep.addEventListener('click', close);
  elements.confirm.addEventListener('click', confirm);
  elements.modal.addEventListener('click', (event) => {
    if (event.target === elements.modal) close();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !elements.modal.hidden) close();
  });

  window.SportBookingCancellationDialog = {
    initialize({ onCancelled } = {}) {
      successHandler = onCancelled;
      return { open };
    }
  };
})();
