'use strict';

(function exposeAdminApi(root, factory) {
  const exportDownload = typeof module === 'object' && module.exports
    ? require('./export-download.js')
    : root?.SportBookingExportDownload;
  const api = factory(exportDownload);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SportBookingAdminApi = api;
}(typeof window === 'undefined' ? null : window, (exportDownload) => {
  if (!exportDownload) throw new Error('Thiếu module tải báo cáo Excel.');
  const cachedResponses = new Map();
  let pollingSignal = null;
  const ERROR_MESSAGES = Object.freeze({
    INTERNAL_ERROR: 'Không thể hoàn tất thao tác do lỗi hệ thống. Vui lòng thử lại.',
    NOT_FOUND: 'Không tìm thấy dữ liệu yêu cầu.',
    REQUEST_ERROR: 'Yêu cầu chưa thể hoàn tất. Vui lòng kiểm tra lại thông tin.',
    UNAUTHENTICATED: 'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
    ACCOUNT_LOCKED: 'Tài khoản của bạn đã bị khóa. Vui lòng liên hệ quản trị viên để được hỗ trợ.',
    ADMIN_STALE_DATA: 'Dữ liệu vừa thay đổi. Vui lòng tải lại rồi thử lại.',
    COURT_INACTIVE: 'Sân đang tạm ngưng hoạt động.',
    FACILITY_INACTIVE: 'Cơ sở đang tạm ngưng hoạt động.',
    SLOT_OUTSIDE_OPENING_HOURS: 'Khung giờ nằm ngoài giờ hoạt động của cơ sở.',
    ADMIN_SELF_LOCK: 'Không thể khóa tài khoản Admin đang đăng nhập.',
    INVALID_LOCK_REASON: 'Lý do khóa không được vượt quá 300 ký tự.',
    USER_NOT_FOUND: 'Không tìm thấy người dùng.',
    USER_STATUS_CONFLICT: 'Trạng thái tài khoản đã thay đổi. Vui lòng tải lại.',
    FACILITY_NOT_FOUND: 'Không tìm thấy cơ sở.',
    COURT_NOT_FOUND: 'Không tìm thấy sân.',
    COURT_NAME_CONFLICT: 'Tên sân đã tồn tại trong cơ sở này.',
    BOOKING_NOT_FOUND: 'Không tìm thấy đơn đặt sân.',
    BOOKING_NOT_CANCELLABLE: 'Đơn đã hoàn thành, hết hạn hoặc đã hủy nên không thể hủy sự cố.',
    BOOKING_EXPIRED: 'Đơn đặt sân đã hết hạn.',
    PAYMENT_NOT_FOUND: 'Không tìm thấy thông tin thanh toán của đơn.',
    PAYMENT_NOT_PAID: 'Đơn đã xác nhận nhưng thanh toán không hợp lệ.',
    PAYMENT_STATE_INVALID: 'Trạng thái thanh toán của đơn không hợp lệ.',
    BOOKING_SLOTS_CHANGED: 'Khung giờ của đơn đã thay đổi. Vui lòng tải lại.',
    INVALID_CANCELLATION: 'Thông tin hủy sự cố không hợp lệ.',
    INVALID_CANCELLATION_REASON: 'Lý do cần từ 3 đến 500 ký tự.',
    INVALID_DATE: 'Ngày không hợp lệ.',
    INVALID_DATE_RANGE: 'Khoảng ngày không hợp lệ.',
    INVALID_MONTH: 'Tháng không hợp lệ.',
    EXPORT_TOO_MANY_ROWS: 'Quá nhiều dòng, hãy lọc thu hẹp.'
  });
  const LOCALIZED_SERVER_MESSAGE_CODES = new Set([
    'INVALID_INPUT',
    'INVALID_QUERY',
    'FACILITY_HAS_ACTIVE_BOOKINGS',
    'FACILITY_HAS_BOOKING_HISTORY',
    'COURT_HAS_ACTIVE_BOOKINGS',
    'INVALID_OPENING_HOURS',
    'INVALID_DATE',
    'INVALID_DATE_RANGE'
  ]);
  const GENERIC_ERROR_MESSAGE = 'Yêu cầu chưa thể hoàn tất. Vui lòng thử lại.';

  function getErrorMessage(error) {
    if (Object.hasOwn(ERROR_MESSAGES, error?.code)) {
      return ERROR_MESSAGES[error.code];
    }
    return LOCALIZED_SERVER_MESSAGE_CODES.has(error?.code)
      && typeof error?.message === 'string'
      && error.message.trim()
      ? error.message
      : GENERIC_ERROR_MESSAGE;
  }

  function redirectIfAccountLocked(response, result) {
    if (response.status !== 401 || result?.error?.code !== 'ACCOUNT_LOCKED'
        || typeof window === 'undefined') {
      return;
    }
    window.SportBookingCurrentUser = null;
    window.location.replace('/dang-nhap.html?locked=1');
  }

  async function fetchWithNetworkMessage(url, options) {
    try {
      return await fetch(url, options);
    } catch (error) {
      const requestError = new Error('Không thể kết nối tới máy chủ. Vui lòng thử lại.');
      requestError.cause = error;
      throw requestError;
    }
  }

  async function requestJson(url, options = {}, forceRefresh = false) {
    const method = String(options.method || 'GET').toUpperCase();
    const headers = {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers
    };
    const cachedResponse = method === 'GET' && !forceRefresh ? cachedResponses.get(url) : null;
    if (cachedResponse) {
      headers['If-None-Match'] = cachedResponse.etag;
    }
    const response = await fetchWithNetworkMessage(url, {
      ...options,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: options.signal || (method === 'GET' ? pollingSignal : undefined),
      headers
    });

    if (response.status === 304) {
      if (cachedResponse && cachedResponses.get(url) === cachedResponse) {
        return cachedResponse.body;
      }
      if (cachedResponse) return requestJson(url, options, true);
    }
    let result = null;
    try {
      result = await response.json();
    } catch {
      if (response.ok) throw new Error('Máy chủ trả về dữ liệu không hợp lệ.');
    }

    if (!response.ok) {
      redirectIfAccountLocked(response, result);
      const error = new Error(getErrorMessage(result?.error));
      error.status = response.status;
      error.code = result?.error?.code;
      error.details = result?.error?.details || {};
      error.field = error.details.field;
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

  async function exportBookings(filters = {}) {
    const params = new URLSearchParams();
    if (filters.status) params.set('status', filters.status);
    if (filters.q) params.set('q', filters.q);
    if (filters.date) params.set('date', filters.date);
    if (filters.facility_id) params.set('facility_id', filters.facility_id);
    return exportDownload.fetchFile(`/api/v1/admin/bookings/export?${params.toString()}`);
  }

  function exportDashboard(period) {
    const params = new URLSearchParams({ period: String(period) });
    return exportDownload.fetchFile(`/api/v1/admin/dashboard/export?${params.toString()}`);
  }

  function exportUsers(filters = {}) {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.status) params.set('status', filters.status);
    return exportDownload.fetchFile(`/api/v1/admin/users/export?${params.toString()}`);
  }

  function exportFacilities(filters = {}) {
    const params = new URLSearchParams();
    if (filters.q) params.set('q', filters.q);
    if (filters.district) params.set('district', filters.district);
    if (filters.is_active !== undefined && filters.is_active !== '') {
      params.set('is_active', String(filters.is_active));
    }
    return exportDownload.fetchFile(`/api/v1/admin/facilities/export?${params.toString()}`);
  }

  function exportTimeSlots(courtId, { from, to } = {}) {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return exportDownload.fetchFile(
      `/api/v1/admin/courts/${encodeURIComponent(courtId)}/time-slots/export?${params.toString()}`
    );
  }

  function getBookingDetail(bookingId) {
    return requestJson(`/api/v1/admin/bookings/${encodeURIComponent(bookingId)}`);
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

  function deleteAdminFacility(id, values) {
    return requestJson(`/api/v1/admin/facilities/${encodeURIComponent(id)}`, {
      method: 'DELETE',
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

  function getAdminTimeSlots(courtId, dateOrRange, fromDate, toDate) {
    let params;
    if (dateOrRange && typeof dateOrRange === 'object') {
      params = new URLSearchParams({
        from: String(dateOrRange.from),
        to: String(dateOrRange.to)
      });
    } else if (toDate !== undefined) {
      params = new URLSearchParams({ from: String(fromDate), to: String(toDate) });
    } else {
      params = new URLSearchParams({ date: String(dateOrRange) });
      if (fromDate !== undefined) params.set('from_date', String(fromDate));
    }
    return requestJson(
      `/api/v1/admin/courts/${encodeURIComponent(courtId)}/time-slots?${params.toString()}`
    );
  }

  function getAdminTimeSlotSummary(courtId, month) {
    const params = new URLSearchParams({ month });
    return requestJson(
      `/api/v1/admin/courts/${encodeURIComponent(courtId)}/time-slots/summary?${params.toString()}`
    );
  }

  function generateAdminTimeSlots(courtId, fromDate, toDate) {
    return requestJson(`/api/v1/admin/courts/${encodeURIComponent(courtId)}/generate-slots`, {
      method: 'POST',
      body: JSON.stringify({ from_date: fromDate, to_date: toDate })
    });
  }

  function updateAdminCourtPrices(courtId, values, dryRun = false) {
    const suffix = dryRun ? '?dry_run=true' : '';
    return requestJson(`/api/v1/admin/courts/${encodeURIComponent(courtId)}/prices${suffix}`, {
      method: 'PATCH',
      body: JSON.stringify(values)
    });
  }

  function setUserLock(userId, locked, reason = '') {
    return requestJson(`/api/v1/admin/users/${encodeURIComponent(userId)}/${locked ? 'lock' : 'unlock'}`, {
      method: 'PATCH',
      body: JSON.stringify(locked ? { reason } : {})
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
    deleteAdminFacility,
    exportBookings,
    exportDashboard,
    exportFacilities,
    exportTimeSlots,
    exportUsers,
    getBookings,
    getBookingDetail,
    getDashboard,
    getAdminFacility,
    getAdminTimeSlots,
    getAdminTimeSlotSummary,
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
