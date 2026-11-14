'use strict';

(function exposeAdminApi(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SportBookingAdminApi = api;
}(typeof window === 'undefined' ? null : window, () => {
  const cachedResponses = new Map();
  let pollingSignal = null;

  async function requestJson(url, options = {}) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    };
    if (method === 'GET' && cachedResponses.has(url)) {
      headers['If-None-Match'] = cachedResponses.get(url).etag;
    }
    const response = await fetch(url, {
      ...options,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: options.signal || (method === 'GET' ? pollingSignal : undefined),
      headers
    });

    if (response.status === 304 && cachedResponses.has(url)) {
      return cachedResponses.get(url).body;
    }
    let result = null;
    try {
      result = await response.json();
    } catch {
      if (response.ok) throw new Error('Máy chủ trả về dữ liệu không hợp lệ.');
    }

    if (!response.ok) {
      const error = new Error(result?.error?.message || 'Yêu cầu chưa thể hoàn tất.');
      error.status = response.status;
      error.code = result?.error?.code;
      throw error;
    }
    if (!result || typeof result !== 'object' || Array.isArray(result)) {
      throw new Error('Máy chủ trả về dữ liệu không hợp lệ.');
    }
    const etag = response.headers?.get?.('etag');
    if (method === 'GET' && etag) {
      cachedResponses.set(url, { etag, body: result });
    } else if (method !== 'GET') {
      cachedResponses.clear();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('admin-data-changed'));
      }
    }
    return result;
  }

  function getMe() {
    return requestJson('/api/v1/auth/me');
  }

  function getDashboard(range) {
    return requestJson(`/api/v1/admin/dashboard?range=${encodeURIComponent(range)}`);
  }

  function getFacilities({ page, pageSize }) {
    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize)
    });
    return requestJson(`/api/v1/facilities?${params.toString()}`);
  }

  function getBookings(filters = {}) {
    const page = filters.page ?? 1;
    const pageSize = filters.page_size ?? filters.pageSize ?? 10;
    const query = filters.q ?? filters.query;
    const facilityId = filters.facility_id ?? filters.facilityId;
    const params = new URLSearchParams({ page: String(page), page_size: String(pageSize) });
    if (filters.status) params.set('status', filters.status);
    if (query) params.set('q', query);
    if (filters.date) params.set('date', filters.date);
    if (facilityId) params.set('facility_id', facilityId);
    return requestJson(`/api/v1/admin/bookings?${params.toString()}`);
  }

  function getUsers(filters = {}) {
    const params = new URLSearchParams({
      page: String(filters.page ?? 1),
      page_size: String(filters.page_size ?? filters.pageSize ?? 20)
    });
    if (filters.q) params.set('q', filters.q);
    if (filters.status) params.set('status', filters.status);
    return requestJson(`/api/v1/admin/users?${params.toString()}`);
  }

  function listAdminFacilities(filters = {}) {
    const params = new URLSearchParams({
      page: String(filters.page ?? 1),
      page_size: String(filters.page_size ?? 20)
    });
    if (filters.q) params.set('q', filters.q);
    if (filters.district) params.set('district', filters.district);
    if (filters.is_active !== undefined && filters.is_active !== '') {
      params.set('is_active', String(filters.is_active));
    }
    return requestJson(`/api/v1/admin/facilities?${params.toString()}`);
  }

  function getAdminFacility(id) {
    return requestJson(`/api/v1/admin/facilities/${encodeURIComponent(id)}`);
  }

  function createAdminFacility(values) {
    return requestJson('/api/v1/admin/facilities', {
      method: 'POST',
      body: JSON.stringify(values)
    });
  }

  function updateAdminFacility(id, values) {
    return requestJson(`/api/v1/admin/facilities/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(values)
    });
  }

  function createAdminCourt(values) {
    return requestJson('/api/v1/admin/courts', {
      method: 'POST',
      body: JSON.stringify(values)
    });
  }

  function updateAdminCourt(id, values) {
    return requestJson(`/api/v1/admin/courts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(values)
    });
  }

  function getAdminTimeSlots(courtId, date, fromDate) {
    const params = new URLSearchParams({ date, from_date: fromDate });
    return requestJson(
      `/api/v1/admin/courts/${encodeURIComponent(courtId)}/time-slots?${params.toString()}`
    );
  }

  function generateAdminTimeSlots(courtId, fromDate, toDate) {
    return requestJson(`/api/v1/admin/courts/${encodeURIComponent(courtId)}/generate-slots`, {
      method: 'POST',
      body: JSON.stringify({ from_date: fromDate, to_date: toDate })
    });
  }

  function updateAdminCourtPrices(courtId, values) {
    return requestJson(`/api/v1/admin/courts/${encodeURIComponent(courtId)}/prices`, {
      method: 'PATCH',
      body: JSON.stringify(values)
    });
  }

  function setUserLock(userId, locked, reason = '') {
    return requestJson(`/api/v1/admin/users/${encodeURIComponent(userId)}/${locked ? 'lock' : 'unlock'}`, {
      method: 'PATCH',
      body: JSON.stringify({ reason })
    });
  }

  function cancelIncident(bookingId, reason) {
    return requestJson(
      `/api/v1/admin/bookings/${encodeURIComponent(bookingId)}/incident-cancellation`,
      {
        method: 'POST',
        body: JSON.stringify({ cancellation_reason: reason })
      }
    );
  }

  function clearCache() {
    cachedResponses.clear();
  }

  function setPollingSignal(signal) {
    pollingSignal = signal;
  }

  return {
    cancelIncident,
    clearCache,
    createAdminCourt,
    createAdminFacility,
    getBookings,
    getDashboard,
    getAdminFacility,
    getAdminTimeSlots,
    getFacilities,
    getMe,
    getUsers,
    listAdminFacilities,
    requestJson,
    setUserLock,
    setPollingSignal,
    generateAdminTimeSlots,
    updateAdminCourt,
    updateAdminCourtPrices,
    updateAdminFacility
  };
}));
