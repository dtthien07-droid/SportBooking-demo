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
    if (open === null || close === null || open >= close) {
      throw new Error('Giờ mở cửa phải hợp lệ và nhỏ hơn giờ đóng cửa.');
    }
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
    if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
    return Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));
  }

  function formatHours(value) {
    return typeof value === 'string' ? value.slice(0, 5) : '';
  }

  return { formatHours, normalizeCourtForm, normalizeFacilityForm };
}));
