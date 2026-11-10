'use strict';

(() => {
  const query = new URLSearchParams(window.location.search);
  const bookingId = query.get('booking_id') || query.get('id');
  const main = document.querySelector('main');
  const loading = document.getElementById('ticketLoading');
  const errorPanel = document.getElementById('ticketError');
  const errorMessage = document.getElementById('ticketErrorMessage');
  const retryButton = document.getElementById('ticketRetry');
  const stepper = document.querySelector('[data-booking-stepper]');
  const ticketData = window.SportBookingTicketData;

  const iconPaths = {
    arrow_back: 'M19 12H5m7 7-7-7 7-7',
    content_copy: 'M8 8V4h12v12h-4M4 8h12v12H4z',
    calendar_month: 'M8 3v4m8-4v4M4 9h16M5 5h14a1 1 0 0 1 1 1v13H4V6a1 1 0 0 1 1-1Zm3 8h2m4 0h2m-8 4h2m4 0h2',
    download: 'M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4',
    home: 'm3 11 9-8 9 8M5 10v11h14V10m-9 11v-7h4v7',
    share: 'M12 16V4m-5 5 5-5 5 5M5 14v6h14v-6',
    forum: 'M4 5h16v11H9l-5 4V5Zm4 4h8m-8 4h5',
    chat: 'M4 5h16v12H9l-5 4V5Z',
    link: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2m3 6a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2',
    navigation: 'm3 3 18 9-8 2-2 7-8-18Z',
    open_in_new: 'M14 4h6v6m0-6-9 9M18 13v6H4V5h6',
    directions_walk: 'M13 5a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm-2 18 1-7-3-3 2-5 4 3 4 1m-9 3-3 6m6-5 4 5',
    call: 'M6 3h4l2 5-3 2a15 15 0 0 0 5 5l2-3 5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 4 5a2 2 0 0 1 2-2Z',
    local_parking: 'M6 21V3h7a6 6 0 0 1 0 12h-7',
    shield: 'M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11Zm-4-11 3 3 5-6',
    check_circle: 'M22 11.1V12a10 10 0 1 1-5.9-9.2M22 4 12 14l-3-3',
    verified: 'm12 2 3 2 4-.1.9 3.9 2.8 2.8-2 3.4.3 4-4 .9-3 2.8-3-2.8-4-.9.3-4-2-3.4 2.8-2.8L9 3.9 12 2Z',
    sports_tennis: 'M4 20 20 4M7 3a6 6 0 0 1 8 8l-4 4a6 6 0 0 1-8-8l4-4Zm10 10a6 6 0 0 1 4 10l-7-7a6 6 0 0 1 3-3Z',
    location_on: 'M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Zm-5 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z',
    stadium: 'M3 8 12 3l9 5v13H3V8Zm0 4h18M7 12v5m5-5v5m5-5v5',
    schedule: 'M12 8v5l3 2m6-3a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
    calendar_today: 'M5 4h14v17H5V4Zm3-2v4m8-4v4M5 9h14',
    person: 'M20 21a8 8 0 0 0-16 0m8-10a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z',
    qr_code_2: 'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h3v3h-3zm4 4h3v3h-3zm0-4h3',
    info: 'M12 17v-5m0-4h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z',
    group_add: 'M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2m6-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8-7v6m-3-3h6'
  };

  function showLoading() {
    loading.hidden = false;
    errorPanel.hidden = true;
    main.hidden = true;
  }

  function showError(message) {
    loading.hidden = true;
    main.hidden = true;
    errorMessage.textContent = message;
    errorPanel.hidden = false;
  }

  function replaceIcons() {
    document.querySelectorAll('.material-symbols-outlined').forEach((icon) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      const name = icon.textContent.trim();
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '1em');
      svg.setAttribute('height', '1em');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('stroke-width', '1.8');
      svg.setAttribute('stroke-linecap', 'round');
      svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('aria-hidden', 'true');
      svg.classList.add(...icon.classList);
      path.setAttribute('d', iconPaths[name] || iconPaths.info);
      svg.append(path);
      icon.replaceWith(svg);
    });
  }

  function setText(id, value) {
    const element = document.getElementById(id);
    if (element) element.textContent = value || '—';
  }

  function resolveMapUrl(model) {
    if (model.mapUrl) {
      try {
        const url = new URL(model.mapUrl, window.location.origin);
        if (url.protocol === 'https:' || url.protocol === 'http:') return url.href;
      } catch {
        // Fall back to the facility address below.
      }
    }
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(model.address || model.facilityName)}`;
  }

  function renderTicket(model, user) {
    window.SportBookingStepper.render(stepper, 'complete');
    const detailLink = document.getElementById('bookingDetailLink');
    if (detailLink) {
      const fromPath = `${window.location.pathname}${window.location.search}`;
      detailLink.href = window.SportBookingBackNav.buildDetailUrl(bookingId, fromPath);
      detailLink.removeAttribute('aria-disabled');
      detailLink.classList.remove('cursor-not-allowed', 'opacity-60');
    }
    setText('bookingIdText', window.SportBookingFormat.formatBookingCode(model.bookingCode));
    setText('ticketFacilityName', model.facilityName);
    setText('ticketCourtName', model.courtName);
    setText('ticketAddress', model.address);
    setText('ticketAddressMap', model.address);
    setText('ticketStatus', 'Đã xác nhận');
    setText('displayMatchSlot', model.slotLabels.join(', '));
    setText('displayMatchDayOfWeek', model.date.weekday);
    setText('displayMatchDate', model.date.label);
    setText('displayBookerName', user.fullName || user.full_name || user.name);
    setText('displayBookerPhone', window.SportBookingFormat.maskPhone(user.phone));
    setText('displayNotificationEmail', user.email);
    setText('ticketTotalAmount', ticketData.formatMoney(model.totalAmount));
    setText('ticketPaidAmount', ticketData.formatMoney(model.paidAmount));
    setText('ticketVenueAmount', ticketData.formatMoney(model.venueAmount));

    const qr = document.getElementById('bookingQr');
    qr.innerHTML = window.SportBookingQRCode.toSvg(model.qrPayload);
    const map = document.getElementById('ticketMapLink');
    map.href = resolveMapUrl(model);
    map.target = '_blank';
    map.rel = 'noopener noreferrer';
    const hotline = document.getElementById('ticketHotline');
    if (model.hotline) {
      hotline.href = `tel:${model.hotline}`;
      hotline.textContent = model.hotline;
    } else {
      hotline.removeAttribute('href');
      hotline.textContent = 'Chưa có thông tin';
    }

    const copyButton = document.getElementById('copyBtn');
    copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(model.bookingCode);
        setText('copyFeedback', 'Đã chép!');
      } catch {
        setText('copyFeedback', 'Không thể sao chép.');
      }
    });

    replaceIcons();
    errorPanel.hidden = true;
    loading.hidden = true;
    main.hidden = false;
  }

  async function loadTicket() {
    showLoading();
    if (!bookingId) {
      showError('Thiếu mã đơn đặt sân.');
      return;
    }

    try {
      const booking = await window.SportBookingApi.getBooking(bookingId);
      if (!booking) {
        showError('Không thể tải đơn đặt sân. Vui lòng thử lại.');
        return;
      }

      const action = ticketData.decideTicketAction({ bookingId, booking });
      if (action.action === 'payment') {
        window.location.replace(`/thanh-toan.html?booking_id=${encodeURIComponent(action.bookingId)}`);
        return;
      }
      if (action.action !== 'render') {
        showError(action.message || 'Không thể tải vé đặt sân.');
        return;
      }

      const firstSlot = booking.slots?.[0];
      if (!firstSlot?.facility_id) throw new Error('Thiếu mã cơ sở trong đơn đặt sân.');
      const [payments, facilityData, userData] = await Promise.all([
        window.SportBookingApi.getPayments(bookingId),
        window.SportBookingApi.getFacility(firstSlot.facility_id),
        window.SportBookingApi.getCurrentUser()
      ]);
      if (!payments || !facilityData || !userData) {
        throw new Error('Không thể tải đầy đủ thông tin vé. Vui lòng thử lại.');
      }

      const model = ticketData.buildTicketViewModel(booking, payments, facilityData);
      const user = userData.user || userData;
      renderTicket(model, user);
    } catch (error) {
      const action = ticketData.decideTicketAction({ bookingId, error });
      if (action.action === 'login') {
        const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        window.location.replace(`/dang-nhap.html?returnTo=${encodeURIComponent(returnTo)}`);
      } else if (action.action === 'not-found') {
        showError('Không tìm thấy đơn đặt sân.');
      } else {
        showError(action.message || 'Không thể tải vé đặt sân.');
      }
    }
  }

  retryButton.addEventListener('click', () => {
    loadTicket().catch((error) => showError(error.message || 'Không thể tải vé đặt sân.'));
  });
  loadTicket().catch((error) => showError(error.message || 'Không thể tải vé đặt sân.'));
})();
