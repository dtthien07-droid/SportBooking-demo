'use strict';

(function exposeIncidentCancelDialog(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SportBookingIncidentCancelDialog = api;
}(typeof window === 'undefined' ? null : window, () => {
  function canSubmit(reason, submitting) {
    const length = typeof reason === 'string' ? reason.trim().length : 0;
    return !submitting && length >= 3 && length <= 500;
  }

  function mount({ document: pageDocument = globalThis.document, onSubmit, onSuccess, onError } = {}) {
    if (!pageDocument || typeof onSubmit !== 'function') {
      throw new TypeError('Cần tài liệu trang và hàm gửi hủy sự cố.');
    }
    const create = (tag, className = '', text) => {
      const node = pageDocument.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined) node.textContent = text;
      return node;
    };
    const root = create('div', 'admin-modal');
    root.id = 'incidentCancelModal';
    root.hidden = true;
    const dialog = create('section', 'admin-dialog');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.setAttribute('aria-labelledby', 'incidentCancelTitle');
    dialog.setAttribute('aria-describedby', 'incidentCancelDescription');
    dialog.tabIndex = -1;

    const header = create('header', 'admin-dialog__header');
    const titleGroup = create('div');
    titleGroup.append(
      create('p', 'admin-eyebrow', 'Xử lý ngoại lệ'),
      create('h2', '', 'Hủy do sự cố')
    );
    titleGroup.lastChild.id = 'incidentCancelTitle';
    const closeButton = create('button', 'admin-dialog__close');
    closeButton.type = 'button';
    closeButton.setAttribute('aria-label', 'Đóng hộp thoại');
    const closeIcon = pageDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
    closeIcon.setAttribute('data-sb-icon', 'close');
    closeIcon.setAttribute('aria-hidden', 'true');
    closeButton.append(closeIcon);
    header.append(titleGroup, closeButton);

    const body = create('div', 'admin-dialog__body');
    const description = create('p', 'admin-dialog__description', 'Kiểm tra thông tin đơn trước khi xác nhận hủy.');
    description.id = 'incidentCancelDescription';
    const details = create('dl', 'admin-dialog__details');
    const fields = {};
    for (const [key, label] of [
      ['code', 'Mã đơn'],
      ['owner', 'Khách'],
      ['venue', 'Cơ sở / sân'],
      ['schedule', 'Khung giờ'],
      ['paid', 'Đã trả']
    ]) {
      const row = create('div');
      row.append(create('dt', '', label));
      const value = create('dd', '', 'Chưa có dữ liệu');
      fields[key] = value;
      row.append(value);
      details.append(row);
    }
    const refund = create('p', 'admin-refund-note');
    const form = create('form');
    form.id = 'incidentCancelForm';
    form.noValidate = true;
    const label = create('label', 'admin-reason-label', 'Lý do (bắt buộc)');
    label.htmlFor = 'incidentCancelReason';
    const reason = create('textarea', 'admin-reason');
    reason.id = 'incidentCancelReason';
    reason.name = 'cancellation_reason';
    reason.rows = 4;
    reason.minLength = 3;
    reason.maxLength = 500;
    reason.required = true;
    reason.setAttribute('aria-describedby', 'incidentCancelReasonHint incidentCancelCount incidentCancelError');
    const hint = create('p', 'admin-reason-hint', 'Nhập từ 3 đến 500 ký tự.');
    hint.id = 'incidentCancelReasonHint';
    const meta = create('div', 'admin-reason__meta');
    const errorMessage = create('p', 'admin-dialog__error');
    errorMessage.id = 'incidentCancelError';
    errorMessage.setAttribute('role', 'alert');
    errorMessage.hidden = true;
    const count = create('p', 'admin-reason-count', '0/500 ký tự');
    count.id = 'incidentCancelCount';
    meta.append(errorMessage, count);
    form.append(label, reason, hint, meta);
    body.append(description, details, refund, form);

    const footer = create('footer', 'admin-dialog__footer');
    const keepButton = create('button', 'admin-button admin-button--quiet', 'Giữ nguyên');
    keepButton.type = 'button';
    const submitButton = create('button', 'admin-button admin-button--danger', 'Xác nhận hủy do sự cố');
    submitButton.type = 'submit';
    submitButton.setAttribute('form', form.id);
    submitButton.disabled = true;
    footer.append(keepButton, submitButton);
    dialog.append(header, body, footer);
    root.append(dialog);
    pageDocument.body.append(root);
    pageDocument.defaultView?.SportBookingIcons?.renderAll?.(root);

    let activeBooking = null;
    let trigger = null;
    let submitting = false;
    let previousOverflow = '';

    function setError(message) {
      errorMessage.textContent = message;
      errorMessage.hidden = !message;
      if (message) reason.setAttribute('aria-invalid', 'true');
      else reason.removeAttribute('aria-invalid');
    }

    function refreshValidity() {
      count.textContent = `${reason.value.length}/500 ký tự`;
      submitButton.disabled = !canSubmit(reason.value, submitting);
      if (reason.value.trim().length >= 3) setError('');
    }

    function focusable() {
      return [...dialog.querySelectorAll(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled]), a[href]'
      )].filter((node) => !node.hidden);
    }

    function close() {
      if (submitting || root.hidden) return;
      root.hidden = true;
      pageDocument.body.style.overflow = previousOverflow;
      pageDocument.removeEventListener('keydown', onKeydown);
      activeBooking = null;
      if (trigger?.isConnected) trigger.focus();
    }

    function onKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) {
        event.preventDefault();
        dialog.focus();
      } else if (event.shiftKey && pageDocument.activeElement === items[0]) {
        event.preventDefault();
        items[items.length - 1].focus();
      } else if (!event.shiftKey && pageDocument.activeElement === items[items.length - 1]) {
        event.preventDefault();
        items[0].focus();
      }
    }

    function open(booking, openTrigger) {
      if (!booking?.can_cancel_incident) return false;
      activeBooking = booking;
      trigger = openTrigger || pageDocument.activeElement;
      fields.code.textContent = booking.booking_code || 'Chưa có dữ liệu';
      fields.owner.textContent = booking.owner?.full_name || booking.owner_name || 'Chưa cập nhật tên';
      fields.venue.textContent = booking.slots?.length
        ? [...new Set(booking.slots.map((slot) => [slot.facility_name, slot.court_name]
          .filter(Boolean).join(' / ')))].join(', ')
        : [booking.facility_name, booking.court_name].filter(Boolean).join(' / ') || 'Chưa có dữ liệu';
      fields.schedule.textContent = booking.schedule_label
        || (booking.slots || []).map((slot) => `${slot.service_date || ''} ${String(slot.starts_at || '').slice(0, 5)}–${String(slot.ends_at || '').slice(0, 5)}`).join(', ')
        || 'Chưa có dữ liệu';
      const adminState = pageDocument.defaultView?.SportBookingAdminState;
      fields.paid.textContent = adminState
        ? adminState.formatMoney(booking.paid_amount)
        : `${booking.paid_amount || '0'} đ`;
      refund.textContent = booking.status === 'PENDING'
        ? 'Đơn chưa thanh toán; không phát sinh hoàn tiền.'
        : `Sẽ hoàn 100% số tiền đã thanh toán (${fields.paid.textContent}).`;
      reason.value = '';
      submitButton.textContent = 'Xác nhận hủy do sự cố';
      setError('');
      submitting = false;
      refreshValidity();
      root.hidden = false;
      previousOverflow = pageDocument.body.style.overflow;
      pageDocument.body.style.overflow = 'hidden';
      pageDocument.addEventListener('keydown', onKeydown);
      reason.focus();
      return true;
    }

    async function submit(event) {
      event.preventDefault();
      if (!activeBooking || !canSubmit(reason.value, submitting)) {
        setError('Vui lòng nhập lý do từ 3 đến 500 ký tự.');
        return;
      }
      submitting = true;
      submitButton.textContent = 'Đang xử lý...';
      refreshValidity();
      try {
        const result = await onSubmit(activeBooking, reason.value.trim());
        const booking = activeBooking;
        submitting = false;
        close();
        if (typeof onSuccess === 'function') await onSuccess(result, booking);
      } catch (error) {
        if (typeof onError === 'function' && await onError(error)) return;
        submitting = false;
        submitButton.textContent = 'Xác nhận hủy do sự cố';
        refreshValidity();
        setError(error?.status === 409
          ? error.message || 'Đơn đã thay đổi hoặc không còn hợp lệ. Vui lòng tải lại.'
          : error?.status === 400
            ? error.message || 'Lý do cần từ 3 đến 500 ký tự.'
            : 'Không thể hủy đơn lúc này. Vui lòng thử lại.');
      }
    }

    reason.addEventListener('input', refreshValidity);
    form.addEventListener('submit', submit);
    closeButton.addEventListener('click', close);
    keepButton.addEventListener('click', close);
    return { close, open, element: root };
  }

  return { canSubmit, mount };
}));
