'use strict';

const BOOKING_STATUSES = new Set([
  'PENDING',
  'CONFIRMED',
  'COMPLETED',
  'EXPIRED',
  'CANCELLED'
]);
const DASHBOARD_PERIODS = new Set(['today', '7d', '30d']);
const MAX_PAGE_SIZE = 50;
const MAX_UINT64 = 18446744073709551615n;
const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1000;

function createAdminError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function invalidQuery(message) {
  return createAdminError(400, 'INVALID_ADMIN_QUERY', message);
}

function parsePageValue(value, fallback, field, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw invalidQuery(`${field} phải là số nguyên dương.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw invalidQuery(`${field} nằm ngoài phạm vi cho phép.`);
  }
  return parsed;
}

function normalizeBookingId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw createAdminError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy đơn đặt sân.');
  }
  if (BigInt(value) > MAX_UINT64) {
    throw createAdminError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy đơn đặt sân.');
  }
  return value;
}

function normalizeCancellationReason(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => key !== 'cancellation_reason')) {
    throw createAdminError(400, 'INVALID_CANCELLATION', 'Thông tin hủy sự cố không hợp lệ.');
  }
  const reason = body.cancellation_reason;
  if (typeof reason !== 'string' || reason.trim().length === 0) {
    throw createAdminError(400, 'INVALID_CANCELLATION_REASON', 'Lý do hủy sự cố là bắt buộc.');
  }
  const normalizedReason = reason.trim();
  if (normalizedReason.length > 500) {
    throw createAdminError(400, 'INVALID_CANCELLATION_REASON', 'Lý do hủy không được vượt quá 500 ký tự.');
  }
  return normalizedReason;
}

function getDashboardWindow(period, currentTime) {
  if (!DASHBOARD_PERIODS.has(period)) {
    throw invalidQuery('period phải là today, 7d hoặc 30d.');
  }
  if (!(currentTime instanceof Date) || !Number.isFinite(currentTime.getTime())) {
    throw new TypeError('Thời gian dashboard phải hợp lệ.');
  }

  let start;
  if (period === 'today') {
    const vietnamNow = new Date(currentTime.getTime() + VIETNAM_OFFSET_MS);
    start = new Date(Date.UTC(
      vietnamNow.getUTCFullYear(),
      vietnamNow.getUTCMonth(),
      vietnamNow.getUTCDate()
    ) - VIETNAM_OFFSET_MS);
  } else {
    const days = period === '7d' ? 7 : 30;
    start = new Date(currentTime.getTime() - days * 24 * 60 * 60 * 1000);
  }
  return { start, end: currentTime };
}

function createAdminService({
  adminRepository,
  bookingsRepository,
  now = () => new Date(),
  notifyIncidentCancellation,
  notifyPendingIncidentCancellation
}) {
  if (!adminRepository || typeof adminRepository.listBookings !== 'function'
      || !bookingsRepository || typeof bookingsRepository.withTransaction !== 'function') {
    throw new TypeError('Cần repository Admin và booking tương thích.');
  }
  if (typeof now !== 'function'
      || typeof notifyIncidentCancellation !== 'function'
      || typeof notifyPendingIncidentCancellation !== 'function') {
    throw new TypeError('Cần đồng hồ và các hàm thông báo Admin tương thích.');
  }

  return {
    async listBookings(query) {
      const status = query.status;
      if (status !== undefined && !BOOKING_STATUSES.has(status)) {
        throw invalidQuery('Trạng thái booking không được hỗ trợ.');
      }
      const search = query.q === undefined ? '' : query.q;
      if (typeof search !== 'string' || search.length > 100) {
        throw invalidQuery('q phải là chuỗi không quá 100 ký tự.');
      }
      const pageSize = parsePageValue(query.page_size, 10, 'page_size', MAX_PAGE_SIZE);
      const maxPage = Math.floor(Number.MAX_SAFE_INTEGER / pageSize) + 1;
      const page = parsePageValue(query.page, 1, 'page', maxPage);
      const result = await adminRepository.listBookings({
        status: status || null,
        query: search.trim(),
        page,
        pageSize
      });
      const bookingIds = result.rows.map((booking) => String(booking.id));
      const slotRows = await adminRepository.findBookingSlots(bookingIds);
      const slotsByBookingId = new Map(bookingIds.map((id) => [id, []]));
      for (const slot of slotRows) {
        slotsByBookingId.get(String(slot.booking_id)).push({
          time_slot_id: String(slot.time_slot_id),
          court_id: String(slot.court_id),
          facility_id: String(slot.facility_id),
          facility_name: slot.facility_name,
          court_name: slot.court_name,
          sport_type: slot.sport_type,
          service_date: slot.service_date,
          starts_at: slot.starts_at,
          ends_at: slot.ends_at,
          price_at_booking: String(slot.price_at_booking)
        });
      }
      return {
        bookings: result.rows.map((booking) => ({
          booking_id: String(booking.id),
          booking_code: booking.booking_code,
          status: booking.status,
          created_at: booking.created_at,
          total_amount: String(booking.total_amount),
          payment_status: booking.payment_status,
          paid_amount: booking.paid_amount === null ? null : String(booking.paid_amount),
          refunded_amount: booking.refunded_amount === null
            ? null
            : String(booking.refunded_amount),
          owner: {
            user_id: String(booking.owner_id),
            full_name: booking.owner_full_name,
            email: booking.owner_email,
            phone: booking.owner_phone
          },
          slots: slotsByBookingId.get(String(booking.id))
        })),
        pagination: {
          page,
          page_size: pageSize,
          total: result.total,
          total_pages: Math.ceil(result.total / pageSize)
        }
      };
    },

    async getDashboard(period = 'today') {
      const { start, end } = getDashboardWindow(period, now());
      const [counts, revenue] = await Promise.all([
        adminRepository.getBookingDashboardCounts(start, end),
        adminRepository.getRevenueEvents(start, end)
      ]);
      const netRevenue = BigInt(String(revenue.paid_amount))
        - BigInt(String(revenue.refunded_amount));
      return {
        period,
        new_bookings: Number(counts.new_bookings),
        net_revenue: netRevenue.toString(),
        cancelled_bookings: Number(counts.cancelled_bookings),
        completed_bookings: Number(counts.completed_bookings)
      };
    },

    async cancelBookingForIncident(rawBookingId, body) {
      const bookingId = normalizeBookingId(rawBookingId);
      const cancellationReason = normalizeCancellationReason(body);
      try {
        return await bookingsRepository.withTransaction(async (connection) => {
          const booking = await bookingsRepository.lockBooking(connection, bookingId);
          if (!booking) {
            throw createAdminError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy đơn đặt sân.');
          }
          if (booking.status !== 'PENDING' && booking.status !== 'CONFIRMED') {
            throw createAdminError(
              409,
              'BOOKING_NOT_CANCELLABLE',
              'Đơn đã hoàn thành, hết hạn hoặc đã hủy nên không thể hủy sự cố.'
            );
          }
          if (booking.status === 'PENDING' && Number(booking.lock_expired) === 1) {
            throw createAdminError(409, 'BOOKING_EXPIRED', 'Đơn đặt sân đã hết hạn.');
          }

          const payment = await bookingsRepository.lockPaymentForBooking(connection, bookingId);
          if (!payment) {
            throw createAdminError(409, 'PAYMENT_NOT_FOUND', 'Không tìm thấy thông tin thanh toán của đơn.');
          }
          if (booking.status === 'CONFIRMED' && payment.status !== 'PAID') {
            throw createAdminError(409, 'PAYMENT_NOT_PAID', 'Đơn đã xác nhận nhưng thanh toán không hợp lệ.');
          }
          if (booking.status === 'PENDING' && payment.status !== 'PENDING') {
            throw createAdminError(409, 'PAYMENT_STATE_INVALID', 'Đơn đang chờ thanh toán có trạng thái payment không hợp lệ.');
          }

          const slotIds = await bookingsRepository.lockSlotsForBooking(connection, bookingId);
          const slots = await bookingsRepository.lockTimeSlots(connection, slotIds);
          if (slotIds.length === 0 || slots.length !== slotIds.length) {
            throw createAdminError(409, 'BOOKING_SLOTS_CHANGED', 'Các khung giờ của đơn đã thay đổi.');
          }
          const requiredSlotStatus = booking.status === 'PENDING' ? 'LOCKED' : 'BOOKED';
          if (slots.some((slot) => slot.status !== requiredSlotStatus
              || String(slot.current_booking_id) !== String(booking.id)
              || (booking.status === 'PENDING' && Number(slot.lock_expired) === 1))) {
            throw createAdminError(409, 'BOOKING_SLOTS_CHANGED', 'Các khung giờ của đơn đã thay đổi.');
          }

          const paidAmount = String(payment.paid_amount);
          const refundAmount = booking.status === 'CONFIRMED' ? paidAmount : '0';
          const updated = await bookingsRepository.updateAdminBookingCancellation(connection, {
            bookingId,
            cancellationReason
          });
          if (!updated) {
            throw createAdminError(409, 'BOOKING_NOT_CANCELLABLE', 'Đơn đặt sân đã thay đổi, vui lòng tải lại.');
          }
          if (booking.status === 'CONFIRMED') {
            await bookingsRepository.refundPaymentForBooking(connection, payment.id, refundAmount);
          }
          await bookingsRepository.releaseBookingSlots(connection, bookingId);
          const notificationSlots = await bookingsRepository.findNotificationSlots(connection, bookingId);
          const notificationBooking = { ...booking, slots: notificationSlots };
          if (booking.status === 'CONFIRMED') {
            await notifyIncidentCancellation(connection, notificationBooking, refundAmount);
          } else {
            await notifyPendingIncidentCancellation(connection, notificationBooking);
          }
          return {
            booking_id: String(booking.id),
            status: 'CANCELLED',
            cancelled_by: 'ADMIN',
            refund_percent: booking.status === 'CONFIRMED' ? 100 : 0,
            paid_amount: paidAmount,
            refunded_amount: refundAmount
          };
        });
      } catch (error) {
        if (error.code === 'ER_LOCK_DEADLOCK' || error.code === 'ER_LOCK_WAIT_TIMEOUT') {
          throw createAdminError(409, 'BOOKING_CONFLICT', 'Đơn đặt sân bị xung đột với một yêu cầu khác.');
        }
        throw error;
      }
    }
  };
}

module.exports = {
  createAdminService
};
