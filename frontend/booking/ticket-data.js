'use strict';

(function exposeTicketData(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SportBookingTicketData = api;
}(typeof window === 'undefined' ? null : window, () => {
  function displayDate(value) {
    const dateText = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateText)) {
      throw new TypeError('Ngày đặt sân không hợp lệ.');
    }
    const date = new Date(`${dateText}T12:00:00+07:00`);
    if (Number.isNaN(date.valueOf())) throw new TypeError('Ngày đặt sân không hợp lệ.');
    return {
      iso: dateText,
      label: new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      }).format(date),
      weekday: new Intl.DateTimeFormat('vi-VN', {
        timeZone: 'Asia/Ho_Chi_Minh',
        weekday: 'long'
      }).format(date)
    };
  }

  function displayTime(value) {
    const match = /^(\d{2}):(\d{2})(?::\d{2})?$/.exec(String(value || ''));
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) {
      throw new TypeError('Khung giờ trong đơn không hợp lệ.');
    }
    return `${match[1]}:${match[2]}`;
  }

  function timeInMinutes(value) {
    const [hours, minutes] = displayTime(value).split(':').map(Number);
    return hours * 60 + minutes;
  }

  function truncateQrName(value) {
    const characters = Array.from(String(value || '').trim());
    if (characters.length <= 40) return characters.join('') || '—';
    return `${characters.slice(0, 39).join('')}…`;
  }

  function buildQrPayload(booking) {
    if (!booking || typeof booking.booking_code !== 'string' || !booking.booking_code.trim()) {
      throw new TypeError('Không tìm thấy mã đơn đặt sân.');
    }
    if (!Array.isArray(booking.slots) || booking.slots.length === 0) {
      throw new TypeError('Đơn đặt sân không có khung giờ.');
    }
    const slots = booking.slots.map((slot) => ({
      startsAt: displayTime(slot.starts_at),
      endsAt: displayTime(slot.ends_at),
      startMinutes: timeInMinutes(slot.starts_at),
      endMinutes: timeInMinutes(slot.ends_at)
    })).sort((left, right) => left.startMinutes - right.startMinutes);
    const ranges = [];
    for (const slot of slots) {
      const previous = ranges[ranges.length - 1];
      if (previous && previous.endMinutes === slot.startMinutes) {
        previous.endsAt = slot.endsAt;
        previous.endMinutes = slot.endMinutes;
      } else {
        ranges.push({ ...slot });
      }
    }
    const firstSlot = booking.slots[0];
    const facilityName = booking.facility_name
      || booking.facility?.name
      || firstSlot.facility_name
      || '';
    const [year, month, day] = displayDate(firstSlot.service_date).iso.split('-');
    const date = `${day}/${month}/${year}`;
    const time = ranges.map((range) => `${range.startsAt}-${range.endsAt}`).join(', ');
    return [
      'SPORTBOOKING',
      `Mã đơn: ${booking.booking_code.trim()}`,
      `Cơ sở: ${truncateQrName(facilityName)}`,
      `Ngày: ${date}`,
      `Giờ: ${time}`
    ].join('\n');
  }

  function buildTicketViewModel(booking, userData, facilityData) {
    if (!booking || !['CONFIRMED', 'COMPLETED'].includes(booking.status)) {
      throw new TypeError('Đơn đặt sân không có vé hợp lệ.');
    }
    if (typeof booking.booking_code !== 'string' || !booking.booking_code.trim()) {
      throw new TypeError('Không tìm thấy mã đơn đặt sân.');
    }
    if (!Array.isArray(booking.slots) || booking.slots.length === 0) {
      throw new TypeError('Đơn đặt sân không có khung giờ.');
    }

    const slots = booking.slots.map((slot) => ({
      serviceDate: displayDate(slot.service_date),
      startsAt: displayTime(slot.starts_at),
      endsAt: displayTime(slot.ends_at),
      startMinutes: timeInMinutes(slot.starts_at),
      endMinutes: timeInMinutes(slot.ends_at),
      courtName: String(slot.court_name || '').trim(),
      sportType: String(slot.sport_type || '').trim().toUpperCase()
    }));
    const facility = facilityData?.facility || facilityData || {};
    const facilityName = String(facility.name || booking.slots[0].facility_name || '').trim();
    const courtName = slots[0].courtName;
    const sportType = slots[0].sportType;
    if (!facilityName || !courtName || !sportType
        || slots.some((slot) => slot.courtName !== courtName
          || slot.sportType !== sportType
          || slot.serviceDate.iso !== slots[0].serviceDate.iso
          || slot.endMinutes <= slot.startMinutes)) {
      throw new TypeError('Thiếu thông tin cơ sở hoặc sân của đơn.');
    }

    const address = String(facility.address || '').trim();
    const hotline = String(facility.hotline || '').trim();
    const mapUrl = String(facility.map_url || '').trim();
    const date = slots[0].serviceDate;
    const sortedSlots = [...slots].sort((left, right) => left.startMinutes - right.startMinutes);
    const ranges = [];
    let durationMinutes = 0;
    for (const slot of sortedSlots) {
      durationMinutes += slot.endMinutes - slot.startMinutes;
      const previous = ranges[ranges.length - 1];
      if (previous && previous.endMinutes === slot.startMinutes) {
        previous.endsAt = slot.endsAt;
        previous.endMinutes = slot.endMinutes;
      } else {
        ranges.push({
          startsAt: slot.startsAt,
          endsAt: slot.endsAt,
          endMinutes: slot.endMinutes
        });
      }
    }
    const timeRange = ranges.map((range) => `${range.startsAt} - ${range.endsAt}`).join(', ');
    const sportLabels = {
      BADMINTON: 'Cầu lông',
      FOOTBALL_MINI: 'Bóng đá mini',
      PICKLEBALL: 'Pickleball'
    };
    const sportName = sportLabels[sportType];
    if (!sportName) throw new TypeError('Môn thể thao của đơn đặt sân không hợp lệ.');
    const user = userData?.user || userData || {};
    const phoneDigits = String(user.phone || '').replace(/\D/g, '');
    const maskedPhone = phoneDigits.length >= 8
      ? `${phoneDigits.slice(0, 4)} *** ${phoneDigits.slice(-3)}`
      : '—';
    const statusCode = booking.display_status_code
      || (booking.status === 'COMPLETED' ? 'COMPLETED' : 'UPCOMING');
    const statusLabels = {
      UPCOMING: 'Sắp tới',
      IN_PROGRESS: 'Đang trong trận',
      COMPLETED: 'Hoàn thành'
    };
    if (!statusLabels[statusCode]) {
      throw new TypeError('Trạng thái hiển thị của vé không hợp lệ.');
    }
    const qrPayload = buildQrPayload({ ...booking, facility_name: facilityName });

    return {
      bookingCode: booking.booking_code,
      facilityName,
      courtName,
      sportName,
      address,
      hotline,
      mapUrl,
      date,
      timeRange,
      durationMinutes,
      bookerName: String(user.fullName || user.full_name || user.name || '').trim() || '—',
      maskedPhone,
      statusLabel: statusLabels[statusCode],
      qrPayload
    };
  }

  function decideTicketAction({ bookingId, booking, error } = {}) {
    if (!bookingId) return { action: 'error', message: 'Thiếu mã đơn đặt sân.' };
    if (error?.status === 401) return { action: 'login' };
    if (error?.status === 403 || error?.status === 404) return { action: 'not-found' };
    if (error) return { action: 'error', message: error.message || 'Không thể tải vé đặt sân.' };
    if (booking?.status === 'PENDING') return { action: 'payment', bookingId };
    if (booking?.status === 'CANCELLED' || booking?.status === 'EXPIRED'
        || booking?.display_status_code === 'CANCELLED'
        || booking?.display_status_code === 'EXPIRED') {
      return { action: 'inactive' };
    }
    if (['CONFIRMED', 'COMPLETED'].includes(booking?.status)) return { action: 'render' };
    return { action: 'error', message: 'Đơn đặt sân chưa được xác nhận.' };
  }

  function formatMoney(value) {
    return `${new Intl.NumberFormat('vi-VN').format(BigInt(value))} đ`;
  }

  return { buildQrPayload, buildTicketViewModel, decideTicketAction, formatMoney };
}));
