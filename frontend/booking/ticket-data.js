'use strict';

(function exposeTicketData(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SportBookingTicketData = api;
}(typeof window === 'undefined' ? null : window, () => {
  function amount(value, label) {
    const text = String(value);
    if (!/^(0|[1-9]\d*)$/.test(text)) {
      throw new TypeError(`${label} không hợp lệ.`);
    }
    return BigInt(text);
  }

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

  function buildTicketViewModel(booking, payments, facilityData) {
    if (!booking || booking.status !== 'CONFIRMED') {
      throw new TypeError('Đơn đặt sân chưa được xác nhận.');
    }
    if (typeof booking.booking_code !== 'string' || !booking.booking_code.trim()) {
      throw new TypeError('Không tìm thấy mã đơn đặt sân.');
    }
    if (!Array.isArray(booking.slots) || booking.slots.length === 0) {
      throw new TypeError('Đơn đặt sân không có khung giờ.');
    }
    const payment = payments?.payment;
    if (!payment || typeof payment !== 'object') {
      throw new TypeError('Không tìm thấy thông tin thanh toán của đơn.');
    }

    const total = amount(booking.total_amount, 'Tổng tiền');
    const paid = amount(payment.paid_amount, 'Số tiền đã thanh toán');
    if (paid > total) throw new TypeError('Số tiền đã thanh toán vượt quá tổng tiền.');

    const slots = booking.slots.map((slot) => ({
      serviceDate: displayDate(slot.service_date),
      startsAt: displayTime(slot.starts_at),
      endsAt: displayTime(slot.ends_at),
      courtName: String(slot.court_name || '').trim()
    }));
    const facility = facilityData?.facility || facilityData || {};
    const facilityName = String(facility.name || booking.slots[0].facility_name || '').trim();
    const courtNames = [...new Set(slots.map((slot) => slot.courtName).filter(Boolean))];
    if (!facilityName || courtNames.length === 0) {
      throw new TypeError('Thiếu thông tin cơ sở hoặc sân của đơn.');
    }

    const address = String(facility.address || '').trim();
    const hotline = String(facility.hotline || '').trim();
    const mapUrl = String(facility.map_url || '').trim();
    const date = slots[0].serviceDate;
    const slotLabels = slots.map((slot) => `${slot.startsAt} - ${slot.endsAt}`);
    const paidAmount = paid.toString();
    const venueAmount = (total - paid).toString();
    const qrPayload = JSON.stringify({
      booking_code: booking.booking_code,
      facility: facilityName,
      court: courtNames.join(', '),
      date: date.iso,
      slots: slotLabels,
      paid_amount: paidAmount,
      amount_due_at_venue: venueAmount,
      hotline
    });

    return {
      bookingCode: booking.booking_code,
      facilityName,
      courtName: courtNames.join(', '),
      address,
      hotline,
      mapUrl,
      date,
      slotLabels,
      totalAmount: total.toString(),
      paidAmount,
      venueAmount,
      qrPayload
    };
  }

  function decideTicketAction({ bookingId, booking, error } = {}) {
    if (!bookingId) return { action: 'error', message: 'Thiếu mã đơn đặt sân.' };
    if (error?.status === 401) return { action: 'login' };
    if (error?.status === 403 || error?.status === 404) return { action: 'not-found' };
    if (error) return { action: 'error', message: error.message || 'Không thể tải vé đặt sân.' };
    if (booking?.status === 'PENDING') return { action: 'payment', bookingId };
    if (booking?.status === 'CONFIRMED') return { action: 'render' };
    return { action: 'error', message: 'Đơn đặt sân chưa được xác nhận.' };
  }

  function formatMoney(value) {
    return `${new Intl.NumberFormat('vi-VN').format(BigInt(value))} đ`;
  }

  return { buildTicketViewModel, decideTicketAction, formatMoney };
}));
