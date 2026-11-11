'use strict';

(() => {
  const state = window.SportBookingHistoryState;
  const elements = {
    modal: document.getElementById('cancel-modal'),
    close: document.getElementById('btn-close-modal'),
    keep: document.getElementById('btn-keep-court'),
    confirm: document.getElementById('btn-confirm-cancel'),
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
    banner: document.getElementById('bannerRefundText')
  };
  let activeBookingId = null;
  let activePreview = null;
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

  function close() {
    if (busy) return;
    activeBookingId = null;
    activePreview = null;
    setModalVisible(false);
  }

  function render(booking, preview) {
    if (!state.canCancelBooking(booking)) {
      throw new Error('Đơn không còn đủ điều kiện để hủy.');
    }
    if (![0, 50, 100].includes(preview?.refund_percent)
        || !Number.isFinite(preview.hours_until_start)
        || typeof preview.message !== 'string') {
      throw new TypeError('Máy chủ trả về thông tin hoàn tiền không hợp lệ.');
    }
    if (!Array.isArray(booking.slots) || booking.slots.length === 0) {
      throw new TypeError('Đơn đặt sân không có khung giờ.');
    }
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
    elements.paid.textContent = money(preview.paid_amount);
    elements.percent.textContent = `${preview.refund_percent}% Hoàn tiền`;
    elements.policy.textContent = `Còn ${preview.hours_until_start} giờ. ${preview.message}`;
    elements.refund.textContent = money(preview.refund_amount);
    elements.banner.textContent = money(preview.refund_amount);
    activePreview = preview;
    elements.confirm.disabled = false;
    elements.confirm.classList.remove('cursor-not-allowed', 'opacity-60');
    elements.confirm.classList.add('cursor-pointer');
    elements.keep.disabled = false;
    elements.keep.classList.remove('cursor-not-allowed', 'opacity-60');
    elements.keep.classList.add('cursor-pointer');
    showMessage('', false);
  }

  async function open(bookingId) {
    activeBookingId = String(bookingId);
    activePreview = null;
    elements.confirm.disabled = true;
    elements.confirm.classList.add('cursor-not-allowed', 'opacity-60');
    elements.keep.disabled = true;
    elements.reason.value = '';
    showMessage('Đang tải thông tin hoàn tiền...', false);
    setModalVisible(true);
    try {
      const [booking, preview] = await Promise.all([
        window.SportBookingApi.getBooking(activeBookingId),
        window.SportBookingApi.getRefundPreview(activeBookingId)
      ]);
      if (!booking || !preview || activeBookingId !== String(bookingId)) return;
      render(booking, preview);
    } catch (error) {
      showMessage(error.message || 'Không thể tải thông tin hoàn tiền.');
      elements.confirm.disabled = true;
    }
  }

  async function confirm() {
    if (busy || !activeBookingId || !activePreview) return;
    busy = true;
    elements.confirm.disabled = true;
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
      setModalVisible(false);
      activeBookingId = null;
      activePreview = null;
      if (typeof successHandler === 'function') await successHandler(result, successMessage);
    } catch (error) {
      showMessage(error.message || 'Không thể hủy đơn.');
      if (error.status === 409) {
        try {
          const booking = await window.SportBookingApi.getBooking(activeBookingId);
          if (!booking || !state.canCancelBooking(booking)) {
            setModalVisible(false);
            activeBookingId = null;
            activePreview = null;
            if (typeof successHandler === 'function') await successHandler(null, error.message);
          } else {
            const preview = await window.SportBookingApi.getRefundPreview(activeBookingId);
            render(booking, preview);
            showMessage(error.message);
          }
        } catch (refreshError) {
          showMessage(refreshError.message || error.message);
        }
      }
    } finally {
      busy = false;
      if (!activePreview) elements.confirm.disabled = true;
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
