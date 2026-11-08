'use strict';

(() => {
  async function list(params) {
    const query = new URLSearchParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') {
        query.set(key, String(value));
      }
    });

    const response = await fetch(`/api/v1/facilities?${query}`, {
      credentials: 'same-origin'
    });
    if (response.status === 401) {
      window.location.assign('/dang-nhap.html');
      return null;
    }

    let data;
    try {
      data = await response.json();
    } catch {
      throw new Error('Máy chủ trả về phản hồi không hợp lệ.');
    }

    if (!response.ok) {
      throw new Error(data && data.error && data.error.message
        ? data.error.message
        : 'Không thể tải danh sách sân. Vui lòng thử lại.');
    }
    if (!data || !Array.isArray(data.facilities) || !data.pagination
        || !Number.isSafeInteger(data.pagination.page)
        || !Number.isSafeInteger(data.pagination.page_size)
        || !Number.isSafeInteger(data.pagination.total)
        || !Number.isSafeInteger(data.pagination.total_pages)) {
      throw new Error('Dữ liệu danh sách sân không đúng định dạng.');
    }
    return data;
  }

  window.SportBookingFacilities = { list };
})();
