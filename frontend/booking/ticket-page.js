'use strict';

(() => {
  const query = new URLSearchParams(window.location.search);
  const bookingId = query.get('booking_id');
  const loading = document.getElementById('ticketLoading');
  const errorPanel = document.getElementById('ticketError');
  const errorMessage = document.getElementById('ticketErrorMessage');
  const retryButton = document.getElementById('ticketRetry');
  const notice = document.getElementById('ticketNotice');
  const main = document.getElementById('ticketMain');
  const ticketData = window.SportBookingTicketData;
  const backTarget = window.SportBookingBackNav.resolveBackTarget(
    window.location.search,
    document.referrer,
    window.location.origin
  );
  const backText = window.SportBookingBackNav.backLabel(backTarget);

  for (const button of document.querySelectorAll('[data-back-button]')) {
    const label = button.querySelector('[data-back-label]');
    if (label) label.textContent = backText;
    button.addEventListener('click', () => window.location.assign(backTarget));
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value == null || value === '' ? '—' : String(value);
  }

  function showLoading() {
    loading.hidden = false;
    errorPanel.hidden = true;
    notice.hidden = true;
    main.hidden = true;
  }

  function showError(message) {
    loading.hidden = true;
    notice.hidden = true;
    main.hidden = true;
    errorMessage.textContent = message;
    errorPanel.hidden = false;
  }

  function showInactive() {
    loading.hidden = true;
    errorPanel.hidden = true;
    main.hidden = true;
    notice.hidden = false;
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
    const queryText = model.address || model.facilityName;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(queryText)}`;
  }

  function renderTicket(model) {
    setText('ticketStatusLabel', model.statusLabel);
    setText('ticketBookingCode', model.bookingCode);
    setText('ticketFacilityName', model.facilityName);
    setText('ticketAddress', model.address || 'Chưa có địa chỉ');
    setText('ticketCourtName', model.courtName);
    setText('ticketSportName', model.sportName);
    setText('ticketDate', model.date.label);
    setText('ticketWeekday', model.date.weekday);
    setText('ticketTimeRange', model.timeRange);
    setText('ticketDuration', `Thời lượng: ${model.durationMinutes} phút`);
    setText('ticketBookerName', model.bookerName);
    setText('ticketBookerPhone', `SĐT: ${model.maskedPhone}`);

    document.getElementById('bookingQr').innerHTML = window.SportBookingQRCode.toSvg(model.qrPayload);
    const mapLink = document.getElementById('ticketMapLink');
    mapLink.href = resolveMapUrl(model);
    mapLink.target = '_blank';
    mapLink.rel = 'noopener noreferrer';
    loading.hidden = true;
    errorPanel.hidden = true;
    notice.hidden = true;
    main.hidden = false;
  }

  function redirectToLogin() {
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.assign(`/dang-nhap.html?returnTo=${encodeURIComponent(returnTo)}`);
  }

  async function loadTicket() {
    showLoading();
    if (!bookingId || !/^[1-9]\d*$/.test(bookingId)) {
      showError('Thiếu mã đơn đặt sân.');
      return;
    }

    try {
      const booking = await window.SportBookingApi.getBooking(bookingId);
      if (!booking) return;

      const action = ticketData.decideTicketAction({ bookingId, booking });
      if (action.action === 'payment') {
        window.location.assign(`/thanh-toan.html?booking_id=${encodeURIComponent(action.bookingId)}`);
        return;
      }
      if (action.action === 'inactive') {
        showInactive();
        return;
      }
      if (action.action !== 'render') {
        showError(action.message || 'Không thể tải vé điện tử. Vui lòng thử lại.');
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

      const model = ticketData.buildTicketViewModel(booking, userData, facilityData);
      renderTicket(model);
    } catch (error) {
      const action = ticketData.decideTicketAction({ bookingId, error });
      if (action.action === 'login') {
        redirectToLogin();
      } else if (action.action === 'not-found') {
        showError('Không tìm thấy đơn');
      } else {
        showError(action.message || 'Không thể tải vé điện tử. Vui lòng thử lại.');
      }
    }
  }

  retryButton.addEventListener('click', () => {
    loadTicket().catch((error) => showError(error.message || 'Không thể tải vé điện tử.'));
  });
  loadTicket().catch((error) => showError(error.message || 'Không thể tải vé điện tử.'));
})();
