'use strict';

(() => {
  function redirectToLogin() {
    const returnTo = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    window.location.assign(`/dang-nhap.html?returnTo=${encodeURIComponent(returnTo)}`);
  }

  async function requestJson(path, options = {}) {
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
      redirectToLogin();
      return null;
    }

    let data;
    try {
      data = await response.json();
    } catch (error) {
      const requestError = new Error('Máy chủ trả về phản hồi không hợp lệ.');
      requestError.status = response.status;
      requestError.cause = error;
      throw requestError;
    }

    if (!response.ok) {
      const requestError = new Error(data?.error?.message || 'Yêu cầu không thể hoàn tất.');
      requestError.status = response.status;
      requestError.code = data?.error?.code;
      throw requestError;
    }
    return data;
  }

  function getFacility(id) {
    return requestJson(`/api/v1/facilities/${encodeURIComponent(id)}`);
  }

  function getCourtSlots(courtId, date) {
    const query = new URLSearchParams({ date });
    return requestJson(`/api/v1/courts/${encodeURIComponent(courtId)}/time-slots?${query}`);
  }

  function createBooking(slotIds) {
    return requestJson('/api/v1/bookings', {
      method: 'POST',
      body: JSON.stringify({ slot_ids: slotIds })
    });
  }

  function getBooking(bookingId) {
    return requestJson(`/api/v1/bookings/${encodeURIComponent(bookingId)}`);
  }

  function cancelBooking(bookingId) {
    return requestJson(`/api/v1/bookings/${encodeURIComponent(bookingId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({})
    });
  }

  window.SportBookingApi = {
    cancelBooking,
    createBooking,
    getBooking,
    getCourtSlots,
    getFacility
  };
})();
