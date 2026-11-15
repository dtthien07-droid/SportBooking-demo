'use strict';

(() => {
  function redirectToLogin() {
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.assign(`/dang-nhap.html?returnTo=${encodeURIComponent(returnTo)}`);
  }

  async function requestJson(path, options = {}, includeHttpStatus = false) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);
    let response;
    try {
      response = await fetch(path, {
        ...options,
        credentials: 'same-origin',
        signal: controller.signal,
        headers: {
          ...(options.body ? { 'content-type': 'application/json' } : {}),
          ...options.headers
        }
      });
    } catch (error) {
      const requestError = new Error(error.name === 'AbortError'
        ? 'Máy chủ phản hồi quá lâu. Vui lòng thử lại.'
        : 'Không thể kết nối tới máy chủ. Vui lòng thử lại.');
      requestError.cause = error;
      throw requestError;
    } finally {
      window.clearTimeout(timeout);
    }

    if (response.status === 401) {
      if (await window.SportBookingHeaderAuth?.redirectIfAccountLocked(response)) return null;
      redirectToLogin();
      return null;
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      const requestError = new Error(`HTTP ${response.status}: Máy chủ trả về phản hồi không hợp lệ.`);
      requestError.status = response.status;
      requestError.cause = error;
      throw requestError;
    }

    if (!response.ok) {
      const requestError = new Error(data?.error?.message || 'Yêu cầu không thể hoàn tất.');
      requestError.status = response.status;
      requestError.body = data;
      requestError.code = data?.error?.code;
      requestError.details = data?.error?.details || {};
      throw requestError;
    }
    if (includeHttpStatus && data && typeof data === 'object' && !Array.isArray(data)) {
      Object.defineProperty(data, 'httpStatus', { value: response.status });
    }
    return data;
  }

  function getFacility(id) {
    return requestJson(`/api/v1/facilities/${encodeURIComponent(id)}`);
  }

  function getCurrentUser() {
    return requestJson('/api/v1/auth/me');
  }

  async function logout() {
    const response = await fetch('/api/v1/auth/logout', {
      method: 'POST',
      credentials: 'same-origin'
    });
    if (response.status === 401) {
      if (await window.SportBookingHeaderAuth?.redirectIfAccountLocked(response)) return false;
      redirectToLogin();
      return false;
    }
    if (!response.ok && response.status !== 204) {
      throw new Error('Không thể đăng xuất. Vui lòng thử lại.');
    }
    return true;
  }

  function getCourtSlots(courtId, date) {
    const query = new URLSearchParams({ date });
    return requestJson(
      `/api/v1/courts/${encodeURIComponent(courtId)}/time-slots?${query}`,
      { cache: 'no-store' }
    );
  }

  async function createBooking(slotIds, paymentOption, matchPreference) {
    const payload = { slot_ids: slotIds, payment_option: paymentOption };
    if (matchPreference) payload.match_preference = matchPreference;
    const booking = await requestJson('/api/v1/bookings', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (booking) window.dispatchEvent(new Event('pending-booking-changed'));
    return booking;
  }

  async function cancelBooking(bookingId, cancellationReason, preview) {
    const body = {};
    if (cancellationReason) body.cancellation_reason = cancellationReason;
    if (preview) {
      body.expected_refund_amount = preview.refund_amount;
      body.expected_refund_percent = preview.refund_percent;
    }
    const result = await requestJson(`/api/v1/bookings/${encodeURIComponent(bookingId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify(body)
    });
    if (result) window.dispatchEvent(new Event('pending-booking-changed'));
    return result;
  }

  function getRefundPreview(bookingId) {
    return requestJson(
      `/api/v1/bookings/${encodeURIComponent(bookingId)}/refund-preview`,
      { cache: 'no-store' },
      true
    );
  }

  function getBooking(bookingId) {
    return requestJson(`/api/v1/bookings/${encodeURIComponent(bookingId)}`, { cache: 'no-store' });
  }

  function listBookings({ status, page = 1, pageSize = 10, q, sport } = {}) {
    const query = new URLSearchParams({
      mine: 'true',
      page: String(page),
      page_size: String(pageSize)
    });
    if (status) query.set('status', status);
    if (q) query.set('q', q);
    if (sport) query.set('sport', sport);
    return requestJson(`/api/v1/bookings?${query}`, { cache: 'no-store' });
  }

  function getBookingSummary() {
    return requestJson('/api/v1/bookings/summary', { cache: 'no-store' });
  }

  function getPendingBooking() {
    return requestJson('/api/v1/bookings/pending', { cache: 'no-store' });
  }

  async function createPaymentAttempt(bookingId, method, simulationResult) {
    const result = await requestJson(`/api/v1/bookings/${encodeURIComponent(bookingId)}/payment-attempts`, {
      method: 'POST',
      body: JSON.stringify({ method, simulation_result: simulationResult })
    });
    if (result && simulationResult === 'SUCCESS') {
      window.dispatchEvent(new Event('pending-booking-changed'));
    }
    return result;
  }

  function getPayments(bookingId) {
    return requestJson(`/api/v1/bookings/${encodeURIComponent(bookingId)}/payments`);
  }

  window.SportBookingApi = {
    cancelBooking,
    createPaymentAttempt,
    createBooking,
    getBooking,
    getBookingSummary,
    getRefundPreview,
    getPendingBooking,
    listBookings,
    getCourtSlots,
    getCurrentUser,
    getFacility,
    getPayments,
    logout
  };
})();
