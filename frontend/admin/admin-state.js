'use strict';

(function exposeAdminPageState(root, factory) {
  const sharedState = typeof module === 'object' && module.exports
    ? require('../booking/admin-state.js')
    : root?.SportBookingAdminState;
  const api = factory(sharedState);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SportBookingAdminPageState = api;
}(typeof window === 'undefined' ? null : window, (sharedState) => {
  if (!sharedState) throw new Error('Thiếu cấu hình điều hướng dùng chung.');

  const USER_HOME = sharedState.USER_HOME;
  const ADMIN_HOME = sharedState.ADMIN_HOME;
  const STATUS_LABELS = Object.freeze({
    PENDING: 'Chờ thanh toán',
    UPCOMING: 'Sắp tới',
    IN_PROGRESS: 'Đang trong trận',
    COMPLETED: 'Hoàn thành',
    CANCELLED: 'Đã hủy',
    EXPIRED: 'Hết hạn'
  });
  const STATUS_CLASSES = Object.freeze({
    PENDING: 'pending',
    UPCOMING: 'upcoming',
    IN_PROGRESS: 'in-progress',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    EXPIRED: 'expired'
  });
  const SERVER_STATUSES = new Set([
    'PENDING',
    'CONFIRMED',
    'COMPLETED',
    'CANCELLED',
    'EXPIRED'
  ]);
  const DISPLAY_STATUSES = new Set(['UPCOMING', 'IN_PROGRESS']);
  const FILTER_STATUSES = new Set([
    'PENDING',
    'UPCOMING',
    'IN_PROGRESS',
    'COMPLETED',
    'CANCELLED',
    'EXPIRED'
  ]);
  const FILTER_KEYS = new Set(['query', 'date', 'facilityId']);
  const CANCELLATION_ERROR_ACTIONS = Object.freeze({
    400: 'reason',
    401: 'login',
    403: 'home',
    404: 'not-found',
    409: 'refresh'
  });

  function getPostLoginDestination(role) {
    return role === 'ADMIN' ? ADMIN_HOME : USER_HOME;
  }

  function getAdminAccessDestination(authenticated) {
    return authenticated
      ? USER_HOME
      : `/dang-nhap.html?returnTo=${encodeURIComponent(ADMIN_HOME)}`;
  }

  function isValidServiceDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }

  function isValidFacilityId(value) {
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) return false;
    try {
      return BigInt(value) <= 18446744073709551615n;
    } catch {
      return false;
    }
  }

  function createFilterState(filters = {}) {
    const applied = {
      status: FILTER_STATUSES.has(filters.status) ? filters.status : '',
      query: typeof filters.query === 'string' ? filters.query.slice(0, 100) : '',
      date: isValidServiceDate(filters.date) ? filters.date : '',
      facilityId: isValidFacilityId(filters.facilityId) ? filters.facilityId : '',
      page: Number.isSafeInteger(filters.page) && filters.page > 0 ? filters.page : 1
    };
    return {
      draft: {
        query: applied.query,
        date: applied.date,
        facilityId: applied.facilityId
      },
      applied
    };
  }

  function updateDraftFilter(filterState, key, value) {
    if (!filterState || !FILTER_KEYS.has(key)) {
      throw new TypeError('An admin filter state and supported draft filter are required.');
    }
    const normalized = key === 'query' && typeof value === 'string'
      ? value.slice(0, 100)
      : key === 'date' && isValidServiceDate(value)
        ? value
        : key === 'facilityId' && isValidFacilityId(value)
          ? value
          : '';
    return {
      ...filterState,
      draft: { ...filterState.draft, [key]: normalized }
    };
  }

  function applyDraftFilters(filterState) {
    if (!filterState || !filterState.draft || !filterState.applied) {
      throw new TypeError('An admin filter state is required.');
    }
    const draft = { ...filterState.draft, query: filterState.draft.query.trim() };
    return {
      draft,
      applied: { ...filterState.applied, ...draft, page: 1 }
    };
  }

  function setAppliedStatus(filterState, status) {
    if (!filterState || !filterState.applied
        || (status !== '' && !FILTER_STATUSES.has(status))) {
      throw new TypeError('An admin filter state and supported status are required.');
    }
    return {
      ...filterState,
      applied: { ...filterState.applied, status, page: 1 }
    };
  }

  function setAppliedPage(filterState, page) {
    if (!filterState || !filterState.applied
        || !Number.isSafeInteger(page) || page < 1) {
      throw new TypeError('An admin filter state and positive page are required.');
    }
    return {
      ...filterState,
      applied: { ...filterState.applied, page }
    };
  }

  function resetFilterState() {
    return createFilterState();
  }

  function hasUnappliedFilters(filterState) {
    return Boolean(filterState)
      && ['query', 'date', 'facilityId'].some((key) => (
        filterState.draft[key] !== filterState.applied[key]
      ));
  }

  function buildQuery(applied) {
    const query = {};
    if (applied.status) query.status = applied.status;
    if (applied.query) query.q = applied.query;
    if (applied.date) query.date = applied.date;
    if (applied.facilityId) query.facility_id = applied.facilityId;
    if (Number.isSafeInteger(applied.page) && applied.page > 0) query.page = applied.page;
    return query;
  }

  function buildExportFilters(filterState) {
    if (!filterState?.applied) {
      throw new TypeError('An admin filter state is required.');
    }
    return buildQuery({ ...filterState.applied, page: undefined });
  }

  function serializeFilterState(applied) {
    const params = new URLSearchParams();
    if (applied.status) params.set('status', applied.status);
    if (applied.query) params.set('q', applied.query);
    if (applied.date) params.set('date', applied.date);
    if (applied.facilityId) params.set('facility', applied.facilityId);
    params.set('page', String(applied.page));
    return `?${params.toString()}`;
  }

  function restoreFilterState(search) {
    const params = new URLSearchParams(search);
    const filters = {};
    const status = params.get('status');
    const query = params.get('q');
    const date = params.get('date');
    const facilityId = params.get('facility');
    const pageValue = params.get('page');
    if (FILTER_STATUSES.has(status)) filters.status = status;
    if (query !== null && query.length <= 100) filters.query = query.trim();
    if (isValidServiceDate(date)) filters.date = date;
    if (isValidFacilityId(facilityId)) filters.facilityId = facilityId;
    if (pageValue && /^[1-9]\d*$/.test(pageValue)) {
      const page = Number(pageValue);
      if (Number.isSafeInteger(page)) filters.page = page;
    }
    return createFilterState(filters);
  }

  function groupFacilitiesByDistrict(facilities) {
    if (!Array.isArray(facilities)) return [];
    const groups = new Map();
    for (const facility of facilities) {
      const idValue = facility?.id ?? facility?.facility_id;
      const id = typeof idValue === 'number' && Number.isSafeInteger(idValue)
        ? String(idValue)
        : typeof idValue === 'string' ? idValue : '';
      if (!isValidFacilityId(id)) continue;
      const district = String(facility.district || '').trim() || 'Chưa phân loại';
      if (!groups.has(district)) groups.set(district, []);
      groups.get(district).push({
        id,
        name: String(facility.name || '').trim(),
        district
      });
    }
    return [...groups.entries()]
      .sort(([first], [second]) => first.localeCompare(second, 'vi'))
      .map(([district, items]) => ({
        district,
        facilities: items.sort((first, second) => (
          first.name.localeCompare(second.name, 'vi')
          || first.id.localeCompare(second.id, undefined, { numeric: true })
        ))
      }));
  }

  function getAllFacilitiesLabel(count) {
    return `Tất cả cơ sở (${Number.isSafeInteger(count) && count >= 0 ? count : 0})`;
  }

  function formatMoney(value) {
    if (value === null || value === undefined || value === '') return '0 đ';
    const raw = String(value);
    if (!/^-?\d+$/.test(raw)) return '0 đ';
    return `${new Intl.NumberFormat('vi-VN').format(BigInt(raw))} đ`;
  }

  function normalizeName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function mergeVenueNames(facilityName, courtName) {
    const facility = normalizeName(facilityName);
    const court = normalizeName(courtName);
    if (!facility) return court || 'Chưa có thông tin sân';
    if (!court || facility.toLocaleLowerCase('vi') === court.toLocaleLowerCase('vi')) {
      return facility;
    }
    return `${facility} — ${court}`;
  }

  function parseSlotDateTime(dateValue, timeValue) {
    const date = String(dateValue || '').slice(0, 10);
    const time = String(timeValue || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}:\d{2}$/.test(time)) {
      return null;
    }
    const timestamp = Date.parse(`${date}T${time}+07:00`);
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function sortedSlots(booking) {
    if (!Array.isArray(booking?.slots)) return [];
    return booking.slots.slice().sort((first, second) => (
      String(first.service_date).localeCompare(String(second.service_date))
      || String(first.starts_at).localeCompare(String(second.starts_at))
    ));
  }

  function getDisplayStatus(booking, currentTime = new Date()) {
    if (!booking || typeof booking !== 'object') return 'UNKNOWN';
    if (booking.status === 'CONFIRMED') {
      const slots = sortedSlots(booking);
      const firstSlot = slots[0];
      const lastSlot = slots[slots.length - 1];
      const start = parseSlotDateTime(firstSlot?.service_date, firstSlot?.starts_at);
      const end = parseSlotDateTime(lastSlot?.service_date, lastSlot?.ends_at);
      if (start !== null && end !== null && end >= start
          && currentTime instanceof Date && Number.isFinite(currentTime.getTime())) {
        if (currentTime.getTime() < start) return 'UPCOMING';
        if (currentTime.getTime() < end) return 'IN_PROGRESS';
        return 'COMPLETED';
      }
      return 'UNKNOWN';
    }
    return Object.hasOwn(STATUS_LABELS, booking.status) ? booking.status : 'UNKNOWN';
  }

  function getBookingStatusLabel(status) {
    return STATUS_LABELS[status] || 'Không xác định';
  }

  function canCancelIncident(status) {
    return status === 'PENDING' || status === 'CONFIRMED';
  }

  function getApiStatusForFilter(filter) {
    if (DISPLAY_STATUSES.has(filter)) return 'CONFIRMED';
    if (filter === '' || SERVER_STATUSES.has(filter)) return filter;
    return '';
  }

  function filterBookingsByDisplayStatus(bookings, displayStatus, currentTime = new Date()) {
    if ((!DISPLAY_STATUSES.has(displayStatus) && displayStatus !== 'COMPLETED')
        || !Array.isArray(bookings)) return [];
    return bookings.filter((booking) => getDisplayStatus(booking, currentTime) === displayStatus);
  }

  function countDisplayStatuses(bookings, currentTime = new Date()) {
    return bookings.reduce((counts, booking) => {
      const displayStatus = getDisplayStatus(booking, currentTime);
      if (Object.hasOwn(counts, displayStatus)) counts[displayStatus] += 1;
      return counts;
    }, { UPCOMING: 0, IN_PROGRESS: 0, COMPLETED: 0 });
  }

  function getBookingRowPresentation(booking, currentTime = new Date()) {
    const displayStatus = getDisplayStatus(booking, currentTime);
    return {
      displayStatus,
      label: getBookingStatusLabel(displayStatus),
      statusClass: STATUS_CLASSES[displayStatus] || 'unknown',
      canCancel: canCancelIncident(booking?.status),
      paidAmount: formatMoney(booking?.paid_amount),
      refundedAmount: formatMoney(booking?.refunded_amount)
    };
  }

  function getBookingRowModel(booking, currentTime = new Date()) {
    const owner = booking?.owner && typeof booking.owner === 'object' ? booking.owner : {};
    return {
      bookingCode: booking?.booking_code || 'Chưa có mã đơn',
      ownerName: owner.full_name || 'Chưa cập nhật tên',
      ownerEmail: owner.email || 'Chưa có email',
      venue: getVenueLabel(booking),
      schedule: formatSchedule(booking),
      ...getBookingRowPresentation(booking, currentTime)
    };
  }

  function formatDate(value) {
    const date = String(value || '').slice(0, 10);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    return match ? `${match[3]}/${match[2]}/${match[1]}` : 'Chưa có ngày';
  }

  function formatTime(value) {
    const time = String(value || '');
    return /^\d{2}:\d{2}/.test(time) ? time.slice(0, 5) : 'Chưa có giờ';
  }

  function formatSchedule(booking) {
    const slots = sortedSlots(booking);
    if (slots.length === 0) return 'Chưa có thông tin khung giờ';
    const first = slots[0];
    const last = slots[slots.length - 1];
    const startDate = formatDate(first.service_date);
    const endDate = formatDate(last.service_date);
    const start = `${startDate} ${formatTime(first.starts_at)}`;
    const end = `${endDate} ${formatTime(last.ends_at)}`;
    return startDate === endDate
      ? `${startDate} · ${formatTime(first.starts_at)}–${formatTime(last.ends_at)}`
      : `${start} – ${end}`;
  }

  function getVenueLabel(booking) {
    const labels = sortedSlots(booking).map((slot) => (
      mergeVenueNames(slot.facility_name, slot.court_name)
    ));
    return [...new Set(labels)].join(', ') || 'Chưa có thông tin sân';
  }

  function isValidCancellationReason(reason) {
    return typeof reason === 'string'
      && reason.trim().length >= 3
      && reason.trim().length <= 500;
  }

  function getCancellationErrorAction(status) {
    return CANCELLATION_ERROR_ACTIONS[status] || 'retry';
  }

  function getCancellationErrorMessage(status, code, message) {
    if (status === 400) return message || 'Lý do cần từ 3 đến 500 ký tự.';
    if (status === 404) return 'Không tìm thấy đơn đặt sân. Danh sách đã được làm mới.';
    if (status === 409) {
      if (message) return message;
      if (code === 'BOOKING_EXPIRED') return 'Đơn đã hết hạn nên không thể hủy do sự cố.';
      if (code === 'BOOKING_NOT_CANCELLABLE') {
        return 'Đơn đã bị hủy, hết hạn hoặc đã hoàn thành nên không thể hủy do sự cố.';
      }
      return 'Đơn đã thay đổi hoặc không còn hợp lệ. Danh sách đã được làm mới.';
    }
    if (status === 403) return 'Bạn không có quyền truy cập trang quản trị.';
    if (status === 401) return 'Phiên đăng nhập đã hết hạn.';
    return 'Không thể gửi yêu cầu. Vui lòng kiểm tra kết nối và thử lại.';
  }

  function getNewBookingIds(currentIds, previousIds = []) {
    const previous = new Set([...previousIds].map(String));
    return [...new Set(currentIds.map(String).filter((id) => id && !previous.has(id)))];
  }

  return {
    ADMIN_HOME,
    STATUS_LABELS,
    USER_HOME,
    applyDraftFilters,
    buildQuery,
    buildExportFilters,
    canCancelIncident,
    countDisplayStatuses,
    createFilterState,
    filterBookingsByDisplayStatus,
    formatDate,
    formatMoney,
    formatSchedule,
    formatTime,
    getAllFacilitiesLabel,
    getAdminAccessDestination,
    getApiStatusForFilter,
    getBookingRowModel,
    getBookingRowPresentation,
    getBookingStatusLabel,
    getCancellationErrorAction,
    getCancellationErrorMessage,
    getNewBookingIds,
    getDisplayStatus,
    groupFacilitiesByDistrict,
    hasUnappliedFilters,
    getPostLoginDestination,
    getVenueLabel,
    isValidCancellationReason,
    mergeVenueNames,
    resetFilterState,
    restoreFilterState,
    serializeFilterState,
    setAppliedPage,
    setAppliedStatus,
    updateDraftFilter
  };
}));
