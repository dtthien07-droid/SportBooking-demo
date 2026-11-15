'use strict';

(function exposeFacilityState(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SportBookingAdminFacilitiesState = api;
}(typeof window === 'undefined' ? null : window, () => {
  const SPORTS = Object.freeze(['FOOTBALL_MINI', 'BADMINTON', 'PICKLEBALL']);

  function normalizeFacilityForm(form) {
    const amenities = form.amenities.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
    if (amenities.length > 20 || amenities.some((value) => value.length > 100)) {
      throw new Error('Tiện ích tối đa 20 mục, mỗi mục không quá 100 ký tự.');
    }
    const open = toMinutes(form.opening_time);
    const close = form.closing_time === '24:00' ? 1440 : toMinutes(form.closing_time);
    if (open === null) throw fieldError('opening_time', 'Giờ mở cửa phải là giờ tròn, phút bằng 00.');
    if (close === null) throw fieldError('closing_time', 'Giờ đóng cửa phải là giờ tròn, phút bằng 00 hoặc 24:00.');
    if (open >= close) throw fieldError('closing_time', 'Giờ mở cửa phải nhỏ hơn giờ đóng cửa.');
    const values = {
      name: form.name.trim(),
      address: form.address.trim(),
      district: form.district.trim(),
      opening_time: form.opening_time,
      closing_time: form.closing_time,
      hotline: form.hotline.trim(),
      map_url: form.map_url.trim(),
      image_url: form.image_url.trim(),
      amenities,
      description: form.description.trim(),
      rules: form.rules.trim(),
      cancellation_policy: form.cancellation_policy.trim(),
      is_active: Boolean(form.is_active)
    };
    if (values.name.length < 2 || values.name.length > 160
        || !values.address || !values.district) {
      throw new Error('Nhập tên cơ sở, địa chỉ và quận/huyện hợp lệ.');
    }
    if (values.hotline && !/^\+?[\d ()-]{8,20}$/.test(values.hotline)) {
      throw new Error('Hotline không đúng định dạng.');
    }
    for (const [field, value] of [['Bản đồ', values.map_url], ['Ảnh', values.image_url]]) {
      if (value && !value.startsWith('/assets/') && !/^https:\/\//i.test(value)) {
        throw new Error(`${field} chỉ nhận URL HTTPS hoặc đường dẫn /assets/.`);
      }
    }
    return values;
  }

  function normalizeCourtForm(form) {
    const normal = Number(form.price_normal);
    const peak = Number(form.price_peak);
    if (form.name.trim().length < 2 || form.name.trim().length > 120
        || !SPORTS.includes(form.sport_type)
        || !/^\d+$/.test(String(form.price_normal))
        || !/^\d+$/.test(String(form.price_peak))
        || !Number.isSafeInteger(normal) || normal < 0
        || !Number.isSafeInteger(peak) || peak < normal || peak > 999999999999) {
      throw new Error('Kiểm tra tên sân, môn thể thao và mức giá.');
    }
    return {
      name: form.name.trim(),
      sport_type: form.sport_type,
      price_normal: normal,
      price_peak: peak,
      description: form.description.trim(),
      is_active: Boolean(form.is_active)
    };
  }

  function toMinutes(value) {
    if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):00$/.test(value)) return null;
    return Number(value.slice(0, 2)) * 60;
  }

  function fieldError(field, message) {
    const error = new Error(message);
    error.field = field;
    return error;
  }

  function formatHours(value) {
    return typeof value === 'string' ? value.slice(0, 5) : '';
  }

  function facilityIdFromToggleEvent(event) {
    const id = event?.currentTarget?.dataset?.facilityId;
    return typeof id === 'string' && /^[1-9]\d*$/.test(id) ? id : null;
  }

  function findFacilityForToggleEvent(event, facilities) {
    const id = facilityIdFromToggleEvent(event);
    if (!id || !Array.isArray(facilities)) return null;
    return facilities.find((facility) => String(facility.id) === id) || null;
  }

  function buildFacilityRowModel(facility) {
    return {
      id: String(facility.id),
      name: facility.name,
      address: facility.address || '',
      district: facility.district || '',
      hours: facility.opening_time && facility.closing_time
        ? `${formatHours(facility.opening_time)} - ${formatHours(facility.closing_time)}`
        : 'Chưa thiết lập',
      active_court_count: Number(facility.active_court_count),
      court_count: Number(facility.court_count),
      no_courts: Number(facility.court_count) === 0,
      active_booking_count: Number(facility.active_booking_count),
      is_active: Boolean(facility.is_active),
      status_text: facility.is_active ? 'Đang hoạt động' : 'Tạm khóa',
      toggle_label: `${facility.is_active ? 'Tạm khóa' : 'Mở lại'} ${facility.name}`
    };
  }

  function buildFacilityDeleteConfirmation(facility) {
    if (!facility || typeof facility.name !== 'string') {
      throw new TypeError('Cơ sở cần xóa không hợp lệ.');
    }
    return {
      title: `Xóa cơ sở ${facility.name}?`,
      description: 'Hành động này không thể hoàn tác.',
      keep_label: 'Giữ lại',
      confirm_label: 'Xóa cơ sở'
    };
  }

  function updateFacilitySummary(summary) {
    const keys = [
      'total_facilities',
      'active_facilities',
      'inactive_facilities',
      'avg_fill_rate_percent'
    ];
    if (!summary || keys.some((key) => !Number.isFinite(Number(summary[key])))) {
      throw new Error('Số liệu tổng hợp cơ sở không hợp lệ.');
    }
    const values = Object.fromEntries(keys.map((key) => [key, Number(summary[key])]));
    if (values.total_facilities !== values.active_facilities + values.inactive_facilities) {
      throw new Error('Tổng cơ sở phải bằng số cơ sở đang mở cộng cơ sở tạm khóa.');
    }
    return values;
  }

  return {
    buildFacilityDeleteConfirmation,
    buildFacilityRowModel,
    facilityIdFromToggleEvent,
    findFacilityForToggleEvent,
    fieldError,
    formatHours,
    normalizeCourtForm,
    normalizeFacilityForm,
    updateFacilitySummary
  };
}));
