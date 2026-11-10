'use strict';

(() => {
  const query = new URLSearchParams(window.location.search);
  const bookingId = query.get('booking_id');
  const demoMode = query.get('demo') === '1';
  const loading = document.getElementById('paymentLoading');
  const errorPanel = document.getElementById('paymentError');
  const errorText = document.getElementById('paymentErrorMessage');
  const content = document.getElementById('paymentContent');
  const countdownBanner = document.getElementById('countdownBanner');
  const countdown = document.getElementById('countdown-badge');
  const holdStatus = document.getElementById('holdStatus');
  const submitButton = document.getElementById('btn-submit-payment');
  const message = document.getElementById('paymentMessage');
  const demoFailureLink = document.getElementById('demoFailureLink');
  const options = [...document.querySelectorAll('input[name="payment_method"]')];
  const bankDetails = document.getElementById('bankTransferDetails');
  const qrContainer = document.getElementById('transferQr');
  const stepperMount = document.querySelector('[data-booking-stepper]');
  const step1Back = document.getElementById('paymentStep1Back');
  const returnToBookingButton = document.getElementById('returnToBooking');
  let remaining = 0;
  let deadline = 0;
  let timer;
  let busy = false;
  let step1Url = '';

  const fallbackImages = {
    BADMINTON: '/assets/images/court-default-badminton.svg',
    FOOTBALL_MINI: '/assets/images/court-default-football-mini.svg',
    PICKLEBALL: '/assets/images/court-default-pickleball.svg'
  };
  const sports = {
    BADMINTON: 'Cầu lông',
    FOOTBALL_MINI: 'Bóng đá mini',
    PICKLEBALL: 'Pickleball'
  };

  function setMessage(text, kind = 'info') {
    message.textContent = text;
    message.dataset.kind = kind;
    message.hidden = !text;
  }

  function formatMoney(value) {
    const amount = BigInt(String(value));
    if (amount < 0n) throw new Error('Số tiền từ máy chủ không hợp lệ.');
    return `${new Intl.NumberFormat('vi-VN').format(amount)} đ`;
  }

  function formatDate(value) {
    const date = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Ngày chơi không hợp lệ.');
    return new Intl.DateTimeFormat('vi-VN', {
      timeZone: 'Asia/Ho_Chi_Minh',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    }).format(new Date(`${date}T00:00:00+07:00`));
  }

  function formatSlots(slots) {
    if (!Array.isArray(slots) || slots.length === 0) {
      throw new Error('Đơn đặt sân không có khung giờ.');
    }
    return slots.map((slot) => {
      const start = String(slot.starts_at || '').slice(0, 5);
      const end = String(slot.ends_at || '').slice(0, 5);
      if (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end)) {
        throw new Error('Khung giờ trong đơn không hợp lệ.');
      }
      return `${start} - ${end}`;
    }).join(', ');
  }

  function setImage(imageUrl, sportType) {
    const image = document.getElementById('sidebarVenueImg');
    const fallback = fallbackImages[String(sportType || '').toUpperCase()]
      || fallbackImages.BADMINTON;
    let safeImageUrl = '';
    if (imageUrl) {
      try {
        const url = new URL(imageUrl, window.location.origin);
        if (url.protocol === 'https:' || url.protocol === 'http:') safeImageUrl = url.href;
      } catch {
        safeImageUrl = '';
      }
    }
    let triedFallback = false;
    image.onerror = () => {
      if (!triedFallback && image.src !== new URL(fallback, window.location.origin).href) {
        triedFallback = true;
        image.src = fallback;
        return;
      }
      image.hidden = true;
    };
    image.hidden = false;
    image.src = safeImageUrl || fallback;
  }

  function renderQr(bookingCode, amountDue) {
    const payload = window.SportBookingPaymentData.buildTransferQrPayload(bookingCode, amountDue);
    qrContainer.replaceChildren();
    qrContainer.insertAdjacentHTML('afterbegin', window.SportBookingQRCode.toSvg(payload));
  }

  function setMethodView() {
    const method = options.find((option) => option.checked)?.value || 'BANK_TRANSFER';
    bankDetails.hidden = method !== 'BANK_TRANSFER';
    options.forEach((option) => {
      const label = option.closest('label');
      label.classList.toggle('ring-2', option.checked);
      label.classList.toggle('ring-primary', option.checked);
      label.classList.toggle('border-primary/20', option.checked);
    });
  }

  function setBusy(value) {
    busy = value;
    submitButton.disabled = busy || remaining <= 0;
    options.forEach((option) => { option.disabled = busy || remaining <= 0; });
    demoFailureLink.hidden = !demoMode;
    demoFailureLink.setAttribute('aria-disabled', String(busy || remaining <= 0));
  }

  function renderCountdown() {
    const safeRemaining = Math.max(0, Math.floor(remaining));
    countdown.textContent = `${String(Math.floor(safeRemaining / 60)).padStart(2, '0')}:${String(safeRemaining % 60).padStart(2, '0')}`;
    if (safeRemaining === 0) {
      window.clearInterval(timer);
      holdStatus.textContent = 'Thời gian giữ chỗ đã hết';
      setBusy(false);
      renderStepper();
    }
  }

  function createStep1Url(booking) {
    const firstSlot = booking.slots?.[0];
    if (!firstSlot?.facility_id || !firstSlot?.court_id || !firstSlot?.service_date
        || booking.slots.some((slot) => !slot.time_slot_id)) return '';
    const params = new URLSearchParams({
      facility_id: String(firstSlot.facility_id),
      court_id: String(firstSlot.court_id),
      date: String(firstSlot.service_date).slice(0, 10),
      slots: booking.slots.map((slot) => String(slot.time_slot_id)).join(',')
    });
    return `/dat-san.html?${params}`;
  }

  function renderStepper() {
    const canReturn = remaining > 0 && Boolean(step1Url);
    if (step1Back) {
      if (canReturn) {
        step1Back.href = step1Url;
        step1Back.removeAttribute('aria-disabled');
        step1Back.classList.add('cursor-pointer', 'hover:bg-surface-container');
      } else {
        step1Back.removeAttribute('href');
        step1Back.setAttribute('aria-disabled', 'true');
        step1Back.classList.remove('cursor-pointer', 'hover:bg-surface-container');
      }
    }
    window.SportBookingStepper.render(stepperMount, 2, {
      previousHref: canReturn ? step1Url : ''
    });
    if (returnToBookingButton) {
      returnToBookingButton.disabled = !canReturn;
      returnToBookingButton.setAttribute('aria-disabled', String(!canReturn));
    }
  }

  function startCountdown(seconds) {
    remaining = Math.max(0, Number(seconds) || 0);
    deadline = Date.now() + remaining * 1000;
    renderCountdown();
    if (remaining > 0) {
      timer = window.setInterval(() => {
        remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
        renderCountdown();
      }, 250);
    }
  }

  function showLoadError(text) {
    loading.hidden = true;
    content.hidden = true;
    errorPanel.hidden = false;
    errorText.textContent = text;
  }

  function redirectToTicket() {
    window.location.replace(`/dat-san-thanh-cong.html?booking_id=${encodeURIComponent(bookingId)}`);
  }

  async function submitPayment(result) {
    if (busy || remaining <= 0) return;
    const method = options.find((option) => option.checked)?.value || 'BANK_TRANSFER';
    const payload = window.SportBookingPaymentData.buildPaymentAttemptPayload(method, result);
    setBusy(true);
    setMessage('Đang xử lý thanh toán…');
    try {
      const response = await window.SportBookingApi.createPaymentAttempt(
        bookingId,
        payload.method,
        payload.simulation_result
      );
      if (!response) return;
      if (result === 'SUCCESS') {
        redirectToTicket();
        return;
      }
      setMessage('Thanh toán thất bại. Đơn vẫn được giữ chỗ; bạn có thể thử lại.', 'error');
    } catch (error) {
      if (error.status === 401) return;
      if (error.status === 409) {
        try {
          const currentBooking = await window.SportBookingApi.getBooking(bookingId);
          if (currentBooking?.status === 'CONFIRMED'
              || currentBooking?.payment?.status === 'PAID') {
            redirectToTicket();
            return;
          }
          setMessage('Trạng thái đơn đã thay đổi. Hãy tải lại trang để kiểm tra.', 'error');
        } catch (refreshError) {
          if (refreshError.status === 401) return;
          if (refreshError.status === 410) {
            remaining = 0;
            renderCountdown();
            setMessage('Thời gian giữ chỗ đã hết. Vui lòng tạo đơn mới.', 'error');
            return;
          }
          setMessage(refreshError.message || 'Không thể xác minh trạng thái thanh toán.', 'error');
        }
        return;
      }
      if (error.status === 410) {
        remaining = 0;
        renderCountdown();
        setMessage('Thời gian giữ chỗ đã hết. Vui lòng tạo đơn mới.', 'error');
        return;
      }
      setMessage(error.message || 'Không thể xử lý thanh toán. Vui lòng thử lại.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function loadPaymentPage() {
    if (!bookingId) {
      showLoadError('Thiếu mã đơn đặt sân.');
      return;
    }
    try {
      const loadedBooking = await window.SportBookingApi.getBooking(bookingId);
      if (!loadedBooking) return;
      if (loadedBooking.status === 'CONFIRMED') {
        redirectToTicket();
        return;
      }
      if (loadedBooking.status !== 'PENDING') {
        showLoadError(loadedBooking.status === 'EXPIRED'
          ? 'Thời gian giữ chỗ đã hết. Vui lòng tạo đơn mới.'
          : `Đơn đặt sân không còn ở trạng thái chờ thanh toán (${loadedBooking.status}).`);
        return;
      }

      const firstSlot = loadedBooking.slots?.[0];
      if (!firstSlot) throw new Error('Đơn đặt sân không có thông tin sân.');
      step1Url = createStep1Url(loadedBooking);
      const [payments, currentUser, facilityData] = await Promise.all([
        window.SportBookingApi.getPayments(bookingId),
        window.SportBookingApi.getCurrentUser(),
        window.SportBookingApi.getFacility(firstSlot.facility_id)
      ]);
      if (!payments || !currentUser || !facilityData) return;
      const payment = loadedBooking.payment;
      if (!payment || !payments.payment) throw new Error('Không tìm thấy thông tin thanh toán của đơn.');
      if (String(payment.amount_due) !== String(payments.payment.amount_due)) {
        throw new Error('Số tiền thanh toán không nhất quán giữa thông tin đơn và lịch sử thanh toán.');
      }

      const facility = facilityData.facility || facilityData;
      const court = facilityData.courts?.find((item) => String(item.id) === String(firstSlot.court_id));
      const sportType = String(firstSlot.sport_type || court?.sport_type || '').toUpperCase();
      const user = currentUser.user || currentUser;
      const amountDue = String(payment.amount_due);
      const amountAtVenue = (
        BigInt(String(loadedBooking.total_amount)) - BigInt(amountDue)
      ).toString();

      document.getElementById('displaySidebarOrderId').textContent = window.SportBookingFormat.formatBookingCode(loadedBooking.booking_code);
      document.getElementById('sidebarSportLabel').textContent = sports[sportType] || firstSlot.sport_type || '';
      document.getElementById('sidebarCourtName').textContent = firstSlot.court_name || court?.name || '';
      document.getElementById('sidebarVenueName').textContent = facility.name || firstSlot.facility_name || '';
      document.getElementById('displaySidebarDate').textContent = formatDate(firstSlot.service_date);
      document.getElementById('displaySidebarTimeSlot').textContent = formatSlots(loadedBooking.slots);
      const phone = window.SportBookingFormat.maskPhone(user.phone);
      document.getElementById('displaySidebarUser').textContent = phone
        ? `${user.fullName || user.full_name || 'Người đặt'} (${phone})`
        : user.fullName || user.full_name || 'Người đặt';
      document.getElementById('displaySidebarCourtPrice').textContent = formatMoney(loadedBooking.total_amount);
      document.getElementById('displaySidebarRemainingPrice').textContent = formatMoney(amountAtVenue);
      document.getElementById('displaySidebarDepositPrice').textContent = formatMoney(amountDue);
      document.getElementById('sidebarPaymentLabel').textContent = payment.payment_option === 'FULL'
        ? 'THANH TOÁN TOÀN BỘ'
        : 'TIỀN CỌC GIỮ SÂN';
      document.getElementById('qrDepositAmount').textContent = formatMoney(amountDue);
      document.getElementById('displayTransferMemo').textContent = loadedBooking.booking_code;
      const hotline = String(facility.hotline || '').trim();
      const hotlineLine = document.getElementById('supportHotline');
      if (hotline) {
        hotlineLine.hidden = false;
        const hotlineLink = document.getElementById('supportHotlineLink');
        hotlineLink.href = `tel:${hotline}`;
        hotlineLink.textContent = hotline;
      }

      const imageUrl = typeof facility.image_url === 'string' ? facility.image_url.trim() : '';
      setImage(imageUrl, sportType);
      renderQr(loadedBooking.booking_code, amountDue);
      startCountdown(loadedBooking.remaining_seconds);
      renderStepper();
      holdStatus.textContent = 'Hệ thống đang tạm khóa slot';
      countdownBanner.hidden = false;
      content.hidden = false;
      loading.hidden = true;
      setMethodView();
      setBusy(false);
    } catch (error) {
      if (error.status === 401) return;
      showLoadError(error.message || 'Không thể tải thông tin thanh toán.');
    }
  }

  options.forEach((option) => option.addEventListener('change', setMethodView));
  submitButton.addEventListener('click', () => submitPayment('SUCCESS'));
  demoFailureLink.addEventListener('click', (event) => {
    event.preventDefault();
    if (demoMode) submitPayment('FAILURE');
  });
  returnToBookingButton.addEventListener('click', () => {
    if (remaining > 0 && step1Url) window.location.assign(step1Url);
  });
  document.getElementById('retryPaymentLoad').addEventListener('click', () => {
    errorPanel.hidden = true;
    loading.hidden = false;
    loadPaymentPage();
  });

  if (!demoMode) demoFailureLink.hidden = true;
  setBusy(true);
  loadPaymentPage();
})();
