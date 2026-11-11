'use strict';

(() => {
  const bookingId = new URLSearchParams(window.location.search).get('booking_id');
  const loading = document.getElementById('ticketLoading');
  const errorPanel = document.getElementById('ticketError');
  const errorMessage = document.getElementById('ticketErrorMessage');
  const retryButton = document.getElementById('ticketRetry');
  const main = document.querySelector('main');

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value == null || value === '' ? '—' : String(value);
  }

  function showError(message) {
    loading.hidden = true;
    main.hidden = true;
    errorMessage.textContent = message;
    errorPanel.hidden = false;
  }

  function redirectToLogin() {
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.assign(`/dang-nhap.html?returnTo=${encodeURIComponent(returnTo)}`);
  }

  function resolveMapUrl(model) {
    if (model.mapUrl) {
      try {
        const url = new URL(model.mapUrl, window.location.origin);
        if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
      } catch {
        // An invalid map URL uses the address-based search link below.
      }
    }
    return `https://www.google.com/maps/search/?api=1&query=${
      encodeURIComponent(model.address || model.facilityName)
    }`;
  }

  function renderBooking(booking, userData, facilityData) {
    const model = window.SportBookingTicketData.buildTicketViewModel(
      booking,
      userData,
      facilityData
    );
    const payment = booking.payment || {};
    const openTicket = document.getElementById('openTicket');
    const ticketQrLink = document.getElementById('ticketQrLink');
    const qrPanel = document.getElementById('bookingQrPanel');
    const bookingDetail = document.getElementById('bookingDetailLink');
    const fromPath = `${window.location.pathname}${window.location.search}`;

    setText('bookingIdText', `#${model.bookingCode}`);
    setText('ticketFacilityName', model.facilityName);
    setText('ticketAddress', model.address || 'Chưa có địa chỉ');
    setText('ticketAddressMap', model.address || 'Chưa có địa chỉ');
    setText('ticketStatus', model.statusLabel);
    setText('ticketCourtName', `${model.courtName} · ${model.sportName}`);
    setText('displayMatchSlot', model.timeRange);
    setText('displayMatchDayOfWeek', model.date.weekday);
    setText('displayMatchDate', model.date.label);
    setText('displayBookerName', model.bookerName);
    setText('displayBookerPhone', model.maskedPhone);
    setText('displayNotificationEmail', userData.user?.email || userData.email);
    setText('ticketTotalAmount', window.SportBookingTicketData.formatMoney(booking.total_amount));
    setText('ticketPaidAmount', window.SportBookingTicketData.formatMoney(payment.paid_amount || '0'));
    setText('ticketVenueAmount', window.SportBookingTicketData.formatMoney(
      booking.amount_due_at_venue || '0'
    ));

    const ticketUrl = window.SportBookingBackNav.buildTicketUrl(bookingId, fromPath);
    openTicket.href = ticketUrl;
    openTicket.hidden = false;
    bookingDetail.href = window.SportBookingBackNav.buildDetailUrl(bookingId, fromPath);
    if (booking.status === 'CONFIRMED') {
      document.getElementById('bookingQr').innerHTML = window.SportBookingQRCode.toSvg(
        model.qrPayload
      );
      ticketQrLink.href = ticketUrl;
      ticketQrLink.hidden = false;
      qrPanel.hidden = false;
    }
    const mapLink = document.getElementById('ticketMapLink');
    mapLink.href = resolveMapUrl(model);
    mapLink.target = '_blank';
    mapLink.rel = 'noopener noreferrer';
    const hotline = document.getElementById('ticketHotline');
    if (model.hotline) {
      hotline.href = `tel:${model.hotline}`;
      hotline.textContent = model.hotline;
    } else {
      hotline.removeAttribute('href');
      hotline.textContent = 'Chưa có thông tin';
    }

    document.getElementById('copyBtn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(model.bookingCode);
        setText('copyFeedback', 'Đã chép!');
      } catch {
        setText('copyFeedback', 'Không thể sao chép.');
      }
    });

    if (window.SportBookingStepper) {
      window.SportBookingStepper.render(document.querySelector('[data-booking-stepper]'), 'complete');
    }
    loading.hidden = true;
    errorPanel.hidden = true;
    main.hidden = false;
  }

  async function loadBooking() {
    loading.hidden = false;
    errorPanel.hidden = true;
    main.hidden = true;
    if (!bookingId || !/^[1-9]\d*$/.test(bookingId)) {
      showError('Thiếu mã đơn đặt sân.');
      return;
    }
    try {
      const booking = await window.SportBookingApi.getBooking(bookingId);
      if (!booking) return;
      if (booking.status === 'PENDING') {
        window.location.assign(`/thanh-toan.html?booking_id=${encodeURIComponent(bookingId)}`);
        return;
      }
      if (booking.status === 'CANCELLED' || booking.status === 'EXPIRED') {
        showError('Đơn không còn hiệu lực');
        return;
      }
      const facilityId = booking.slots?.[0]?.facility_id;
      const facilityRequest = facilityId
        ? window.SportBookingApi.getFacility(facilityId).catch((error) => {
          if (error?.status === 404) return null;
          throw error;
        })
        : Promise.resolve(null);
      const [userData, facilityData] = await Promise.all([
        window.SportBookingApi.getCurrentUser(),
        facilityRequest
      ]);
      if (!userData) return;
      renderBooking(booking, userData, facilityData);
    } catch (error) {
      if (error?.status === 401) {
        redirectToLogin();
      } else if (error?.status === 403 || error?.status === 404) {
        showError('Không tìm thấy đơn');
      } else {
        showError(error?.message || 'Không thể tải thông tin đơn. Vui lòng thử lại.');
      }
    }
  }

  retryButton.addEventListener('click', () => {
    loadBooking().catch((error) => showError(error.message || 'Không thể tải thông tin đơn.'));
  });
  loadBooking().catch((error) => showError(error.message || 'Không thể tải thông tin đơn.'));
})();
