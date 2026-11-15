'use strict';

(() => {
  const state = window.SportBookingHistoryState;
  const bookingId = new URLSearchParams(window.location.search).get('booking_id');
  const elements = {
    loading: document.getElementById('detail-loading'),
    error: document.getElementById('detail-error'),
    errorTitle: document.getElementById('detail-error-title'),
    errorMessage: document.getElementById('detail-error-message'),
    retry: document.getElementById('detail-retry'),
    content: document.getElementById('booking-detail-content'),
    heading: document.getElementById('pageTitleOrderId'),
    statusBadge: document.getElementById('orderStatusBadge'),
    statusIcon: document.getElementById('orderStatusIcon'),
    statusText: document.getElementById('orderStatusText'),
    orderTime: document.getElementById('orderTimeDisplay'),
    pendingNotice: document.getElementById('detail-pending-notice'),
    remaining: document.getElementById('remaining-time'),
    facilityImage: document.getElementById('venueImage'),
    facilityImageFallback: document.getElementById('venueImageFallback'),
    facilityImageFallbackIcon: document.getElementById('venueImageFallbackIcon'),
    sportBadge: document.getElementById('sportBadge'),
    sportIcon: document.getElementById('sportBadgeIcon'),
    sportText: document.getElementById('sportBadgeText'),
    facilityName: document.getElementById('venueName'),
    facilityDescription: document.getElementById('venueSubName'),
    facilityAddress: document.getElementById('venueAddress'),
    mapLink: document.getElementById('venueMapLink'),
    courtName: document.getElementById('displayCourtNumber'),
    matchDate: document.getElementById('displayMatchDate'),
    matchTime: document.getElementById('displayMatchTime'),
    hotline: document.getElementById('venueHotline'),
    qrContent: document.getElementById('ticketQrContent'),
    qrImage: document.getElementById('qrCodeImage'),
    qrSubText: document.getElementById('qrSubText'),
    ticketQrRetry: document.getElementById('ticketQrRetry'),
    qrMessage: document.getElementById('ticketMessage'),
    ticketStateMessage: document.getElementById('ticketStateMessage'),
    ticketStatus: document.getElementById('ticketStatusLabel'),
    paymentTotal: document.getElementById('priceCourtTotal'),
    paymentGrandTotal: document.getElementById('priceFinalTotal'),
    paymentDue: document.getElementById('priceAmountDue'),
    paymentPaid: document.getElementById('priceDepositPaid'),
    paymentRemaining: document.getElementById('priceRemaining'),
    paymentRefunded: document.getElementById('priceRefunded'),
    paymentStatus: document.getElementById('paymentStatusSubtext'),
    paymentMethod: document.getElementById('paymentMethodText'),
    transactionId: document.getElementById('displayTransactionId'),
    continuePayment: document.getElementById('continuePayment'),
    openTicket: document.getElementById('openTicket'),
    matchmakingSub: document.getElementById('matchmakingSub'),
    matchSoon: document.getElementById('matchSoon'),
    cancelAction: document.getElementById('btnOpenCancelFlow'),
    cancelResult: document.getElementById('cancel-result-message')
  };
  let countdownTimer = null;
  let pollTimer = null;
  let loadingRequest = false;
  let refreshAfterCurrentRequest = false;
  const cancellationDialog = window.SportBookingCancellationDialog.initialize({
    onCancelled: async (_result, message) => {
      elements.cancelResult.textContent = message;
      elements.cancelResult.hidden = !message;
      await loadBooking({ quiet: true, forceRefresh: true });
    }
  });
  const backTarget = window.SportBookingBackNav.resolveBackTarget(
    window.location.search,
    document.referrer,
    window.location.origin
  );
  const backText = window.SportBookingBackNav.backLabel(backTarget);

  for (const button of document.querySelectorAll('[data-back-button]')) {
    button.querySelector('[data-back-label]').textContent = backText;
    button.addEventListener('click', () => window.location.assign(backTarget));
  }

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

  function setText(node, value) {
    node.textContent = value == null || value === '' ? '--' : String(value);
  }

  function statusClass(code) {
    if (code === 'PENDING') return 'bg-orange-100 text-secondary';
    if (code === 'EXPIRED' || code === 'CANCELLED') return 'bg-gray-100 text-on-surface-variant';
    if (code === 'COMPLETED') return 'bg-blue-100 text-tertiary';
    if (code === 'UPCOMING' || code === 'IN_PROGRESS') return 'bg-emerald-100 text-primary';
    throw new TypeError('Trạng thái hiển thị của đơn đặt sân không hợp lệ.');
  }

  function sportPresentation(value) {
    const sport = String(value || '').toUpperCase();
    if (sport === 'FOOTBALL_MINI') return { label: 'Bóng đá mini', icon: 'sports_soccer' };
    if (sport === 'BADMINTON') return { label: 'Cầu lông', icon: 'sports' };
    if (sport === 'PICKLEBALL') return { label: 'Pickleball', icon: 'sports' };
    return { label: '--', icon: 'sports' };
  }

  function paymentStatusLabel(payment) {
    if (!payment) return '--';
    if (payment.status === 'PAID') return 'Đã thanh toán';
    if (payment.status === 'PENDING') return 'Chờ thanh toán';
    if (payment.status === 'REFUNDED') return 'Đã hoàn tiền';
    return String(payment.status);
  }

  function paymentOptionLabel(payment) {
    if (!payment) return '--';
    if (payment.payment_option === 'FULL') return 'Thanh toán toàn bộ';
    if (payment.payment_option === 'DEPOSIT_50') return 'Đặt cọc 50%';
    return String(payment.payment_option);
  }

  function setExternalLink(link, value) {
    if (!value) {
      link.hidden = true;
      link.removeAttribute('href');
      return;
    }
    const url = new URL(String(value), window.location.origin);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      link.hidden = true;
      link.removeAttribute('href');
      return;
    }
    link.href = url.href;
    link.hidden = false;
  }

  function renderFacility(booking, facility) {
    const firstSlot = booking.slots[0];
    const sport = sportPresentation(firstSlot.sport_type);
    setText(elements.facilityName, facility?.name || firstSlot.facility_name);
    setText(elements.facilityDescription, facility?.description || sport.label);
    setText(elements.facilityAddress, facility?.address);
    setText(elements.courtName, firstSlot.court_name);
    setText(elements.matchDate, booking.slots.map((slot) => formatDate(slot.service_date))
      .filter((date, index, dates) => dates.indexOf(date) === index)
      .join(' – '));
    setText(elements.matchTime, booking.slots.map((slot) =>
      `${formatTime(slot.starts_at)} – ${formatTime(slot.ends_at)}`
    ).join(', '));

    setText(elements.sportText, sport.label);
    window.SportBookingIcons.setIcon(elements.sportIcon, sport.icon);
    const imagePresentation = window.SportBookingDetailState.getVenueImagePresentation(
      facility?.image_url,
      firstSlot.sport_type
    );
    if (imagePresentation.useImage) {
      elements.facilityImage.src = facility.image_url;
      elements.facilityImage.alt = facility.name || firstSlot.facility_name || 'Sân thể thao';
      elements.facilityImage.hidden = false;
      elements.facilityImageFallback.hidden = true;
    } else {
      elements.facilityImage.removeAttribute('src');
      elements.facilityImage.hidden = true;
      window.SportBookingIcons.setIcon(elements.facilityImageFallbackIcon, imagePresentation.icon);
      elements.facilityImageFallback.hidden = false;
    }

    setExternalLink(elements.mapLink, facility?.map_url);
    if (facility?.hotline) {
      elements.hotline.href = `tel:${String(facility.hotline).replace(/[^\d+]/g, '')}`;
      setText(elements.hotline, facility.hotline);
      elements.hotline.hidden = false;
    } else {
      elements.hotline.removeAttribute('href');
      elements.hotline.hidden = false;
      setText(elements.hotline, '--');
    }
  }

  function renderPayment(booking) {
    const payment = booking.payment;
    setText(elements.paymentTotal, formatMoney(booking.total_amount));
    setText(elements.paymentGrandTotal, formatMoney(booking.total_amount));
    setText(elements.paymentDue, formatMoney(payment?.amount_due));
    setText(elements.paymentPaid, formatMoney(payment?.paid_amount));
    setText(elements.paymentRefunded, formatMoney(payment?.refunded_amount));
    setText(elements.paymentRemaining, formatMoney(booking.amount_due_at_venue));
    setText(elements.paymentStatus, paymentStatusLabel(payment));
    setText(elements.paymentMethod, paymentOptionLabel(payment));
    setText(elements.transactionId, '--');
  }

  function renderTicketAndActions(booking, presentation, facilityData) {
    const ticketPresentation = presentation.ticketPresentation;
    elements.qrContent.hidden = ticketPresentation.status !== 'valid';
    elements.qrImage.hidden = true;
    elements.qrImage.removeAttribute('src');
    elements.ticketQrRetry.hidden = true;
    elements.ticketStateMessage.hidden = true;
    elements.pendingNotice.hidden = presentation.action !== 'continue-payment';
    elements.continuePayment.hidden = presentation.action !== 'continue-payment';
    elements.openTicket.hidden = presentation.action !== 'view-ticket';
    elements.matchmakingSub.textContent = 'Tính năng tìm đối · Sắp có';
    elements.matchSoon.textContent = 'Tìm đối · Sắp có';
    for (const statePanel of document.querySelectorAll('[id^="matchState"]')) {
      statePanel.hidden = true;
    }
    for (const button of document.querySelectorAll('#matchmakingSection button')) {
      button.disabled = true;
      button.title = 'Sắp có';
      button.classList.add('cursor-not-allowed', 'opacity-60');
    }

    if (presentation.action === 'continue-payment') {
      elements.continuePayment.href = presentation.href;
      elements.ticketStatus.textContent = 'CHƯA PHÁT HÀNH';
      elements.qrMessage.textContent = 'Đơn đang chờ thanh toán; không hiển thị mã QR.';
      elements.ticketStateMessage.textContent = 'Vé điện tử sẽ được phát hành sau khi thanh toán thành công.';
      elements.ticketStateMessage.hidden = false;
      startCountdown(presentation.remainingSeconds);
      return;
    }

    window.clearInterval(countdownTimer);
    elements.pendingNotice.hidden = true;
    if (ticketPresentation.status === 'valid') {
      elements.ticketStatus.textContent = 'ĐÃ PHÁT HÀNH';
      elements.qrMessage.textContent = 'Xuất trình mã QR này cho nhân viên sân.';
      elements.openTicket.href = presentation.href;
      try {
        const payload = window.SportBookingTicketData.buildTicketQrPayload(booking, facilityData);
        const svg = window.SportBookingQRCode.toSvg(payload);
        elements.qrImage.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
        elements.qrImage.hidden = false;
        elements.qrSubText.textContent = 'Mã QR vé điện tử.';
      } catch (error) {
        console.error('Không thể tạo mã QR cho vé đặt sân.', error);
        elements.qrImage.hidden = true;
        elements.qrImage.removeAttribute('src');
        elements.qrSubText.textContent =
          'Không thể hiển thị mã QR lúc này. Vui lòng tải lại trang.';
        elements.ticketQrRetry.hidden = false;
      }
    } else if (ticketPresentation.status === 'invalid') {
      elements.ticketStatus.textContent = 'VÉ ĐÃ VÔ HIỆU';
      elements.ticketStateMessage.textContent = ticketPresentation.reason;
      elements.ticketStateMessage.hidden = false;
    } else {
      elements.ticketStatus.textContent = 'CHƯA PHÁT HÀNH';
      elements.ticketStateMessage.textContent = 'Đơn đặt sân này chưa có vé điện tử.';
      elements.ticketStateMessage.hidden = false;
    }
  }

  function startCountdown(seconds) {
    window.clearInterval(countdownTimer);
    let remaining = Math.max(0, Math.floor(Number(seconds) || 0));
    let lastTick = Date.now();
    const update = () => {
      elements.remaining.textContent = state.formatCountdown(remaining);
      if (remaining === 0) loadBooking({ quiet: true });
    };
    update();
    countdownTimer = window.setInterval(() => {
      const now = Date.now();
      const elapsed = Math.floor((now - lastTick) / 1000);
      if (elapsed < 1) return;
      lastTick += elapsed * 1000;
      remaining = Math.max(0, remaining - elapsed);
      elements.remaining.textContent = state.formatCountdown(remaining);
      if (remaining === 0) {
        window.clearInterval(countdownTimer);
        loadBooking({ quiet: true });
      }
    }, 250);
  }

  function renderBooking(booking, facilityData) {
    const presentation = state.getBookingPresentation(
      booking,
      `${window.location.pathname}${window.location.search}`
    );
    if (!Array.isArray(booking.slots) || booking.slots.length === 0) {
      throw new TypeError('Đơn đặt sân không có khung giờ.');
    }

    setText(elements.heading, `Đơn đặt sân ${booking.booking_code}`);
    elements.statusBadge.className = `inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-bold shadow-sm ${statusClass(booking.display_status_code)}`;
    setText(elements.statusText, presentation.label);
    window.SportBookingIcons.setIcon(elements.statusIcon, booking.display_status_code === 'PENDING'
      ? 'timer'
      : booking.display_status_code === 'CANCELLED' || booking.display_status_code === 'EXPIRED'
        ? 'event_busy'
        : booking.display_status_code === 'COMPLETED' ? 'check_circle' : 'verified');
    setText(elements.orderTime, window.SportBookingFormat.formatVietnamDateTime(booking.created_at));
    renderFacility(booking, facilityData?.facility);
    renderPayment(booking);
    renderTicketAndActions(booking, presentation, facilityData);
    elements.cancelAction.hidden = !state.canCancelBooking(booking);
    if (!elements.cancelAction.hidden) {
      elements.cancelAction.disabled = false;
      elements.cancelAction.classList.remove('cursor-not-allowed', 'opacity-60');
      elements.cancelAction.classList.add('cursor-pointer');
    } else {
      elements.cancelAction.disabled = true;
    }
    elements.loading.hidden = true;
    elements.error.hidden = true;
    elements.content.hidden = false;
  }

  function showError(error) {
    console.error('Không thể tải chi tiết đơn đặt sân.', error);
    const view = state.getBookingErrorView(error?.status);
    if (view.action === 'login') {
      const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.assign(`/dang-nhap.html?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
    window.clearInterval(countdownTimer);
    window.clearInterval(pollTimer);
    elements.loading.hidden = true;
    elements.content.hidden = true;
    elements.errorTitle.textContent = view.title;
    elements.errorMessage.textContent = view.action === 'not-found'
      ? ''
      : getUserFacingErrorMessage(error);
    elements.retry.hidden = !view.showRetry;
    elements.error.hidden = false;
  }

  function getUserFacingErrorMessage(error) {
    if (error?.status === 403) return 'Bạn không có quyền xem đơn đặt sân này.';
    if (error?.status === 409) return 'Trạng thái đơn đặt sân đã thay đổi. Vui lòng tải lại trang.';
    if (error?.status === 429) return 'Hệ thống đang xử lý nhiều yêu cầu. Vui lòng thử lại sau.';
    if (Number(error?.status) >= 500) {
      return 'Hệ thống đang gặp sự cố khi tải đơn đặt sân. Vui lòng thử lại sau.';
    }
    if (error?.status) return 'Không thể tải thông tin đơn đặt sân. Vui lòng thử lại.';
    if (error?.name === 'TypeError') {
      return 'Không thể hiển thị thông tin đơn đặt sân. Vui lòng tải lại trang.';
    }
    return 'Không thể kết nối để tải đơn đặt sân. Vui lòng kiểm tra kết nối và thử lại.';
  }

  async function loadBooking({ quiet = false, forceRefresh = false } = {}) {
    if (loadingRequest) {
      if (forceRefresh) refreshAfterCurrentRequest = true;
      return;
    }
    loadingRequest = true;
    if (!quiet) {
      elements.loading.hidden = false;
      elements.error.hidden = true;
      elements.content.hidden = true;
    }
    if (!bookingId || !/^[1-9]\d*$/.test(bookingId)) {
      showError({ status: 404 });
      loadingRequest = false;
      return;
    }
    try {
      const booking = await window.SportBookingApi.getBooking(bookingId);
      if (!booking) return;
      const facilityId = booking.slots?.[0]?.facility_id;
      let facilityData = null;
      if (facilityId) {
        try {
          facilityData = await window.SportBookingApi.getFacility(facilityId);
        } catch (error) {
          if (error?.status !== 404) throw error;
        }
      }
      if (!booking) return;
      renderBooking(booking, facilityData);
      if (!pollTimer) pollTimer = window.setInterval(() => loadBooking({ quiet: true }), 5000);
    } catch (error) {
      showError(error);
    } finally {
      loadingRequest = false;
      if (refreshAfterCurrentRequest) {
        refreshAfterCurrentRequest = false;
        await loadBooking({ quiet: true });
      }
    }
  }

  elements.retry.addEventListener('click', () => loadBooking());
  elements.ticketQrRetry.addEventListener('click', () => window.location.reload());
  elements.cancelAction.addEventListener('click', () => cancellationDialog.open(bookingId));
  loadBooking();
})();
