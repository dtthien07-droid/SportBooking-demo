'use strict';

const BOOKING_STATUSES = new Set([
  'PENDING',
  'CONFIRMED',
  'COMPLETED',
  'EXPIRED',
  'CANCELLED'
]);
const DASHBOARD_RANGES = new Set(['today', '7d', '30d']);
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

function toIsoUtc(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Dữ liệu thời gian từ cơ sở dữ liệu không hợp lệ.');
  return date.toISOString();
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

function parseFacilityId(value) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw invalidQuery('facility_id phải là số nguyên dương.');
  }
  if (BigInt(value) > MAX_UINT64) {
    throw invalidQuery('facility_id nằm ngoài phạm vi cho phép.');
  }
  return value;
}

function parseBookingDate(value) {
  if (value === undefined || value === '') return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalidQuery('date phải theo định dạng YYYY-MM-DD.');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw invalidQuery('date phải là ngày hợp lệ.');
  }
  return value;
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

function normalizeUserId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || BigInt(value) > MAX_UINT64) {
    throw createAdminError(404, 'USER_NOT_FOUND', 'Không tìm thấy người dùng.');
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
  if (!DASHBOARD_RANGES.has(period)) {
    throw invalidQuery('range phải là today, 7d hoặc 30d.');
  }
  if (!(currentTime instanceof Date) || !Number.isFinite(currentTime.getTime())) {
    throw new TypeError('Thời gian dashboard phải hợp lệ.');
  }

  const vietnamNow = new Date(currentTime.getTime() + VIETNAM_OFFSET_MS);
  const toDate = `${vietnamNow.getUTCFullYear()}-${String(vietnamNow.getUTCMonth() + 1).padStart(2, '0')}-${String(vietnamNow.getUTCDate()).padStart(2, '0')}`;
  const days = period === 'today' ? 1 : period === '7d' ? 7 : 30;
  const from = new Date(Date.UTC(
    vietnamNow.getUTCFullYear(),
    vietnamNow.getUTCMonth(),
    vietnamNow.getUTCDate() - days + 1
  ));
  const fromDate = `${from.getUTCFullYear()}-${String(from.getUTCMonth() + 1).padStart(2, '0')}-${String(from.getUTCDate()).padStart(2, '0')}`;
  const endDate = new Date(Date.UTC(
    vietnamNow.getUTCFullYear(),
    vietnamNow.getUTCMonth(),
    vietnamNow.getUTCDate() + 1
  ));
  return {
    from: fromDate,
    to: toDate,
    start: new Date(Date.parse(`${fromDate}T00:00:00.000+07:00`)),
    end: new Date(Date.parse(`${endDate.toISOString().slice(0, 10)}T00:00:00.000+07:00`))
  };
}

function createAdminService({
  adminRepository,
  bookingsRepository,
  now = () => new Date(),
  notifyIncidentCancellation,
  notifyPendingIncidentCancellation,
  writeAudit
}) {
  if (!adminRepository || typeof adminRepository.listBookings !== 'function'
      || !bookingsRepository || typeof bookingsRepository.withTransaction !== 'function') {
    throw new TypeError('Cần repository Admin và booking tương thích.');
  }
  if (typeof now !== 'function'
      || typeof notifyIncidentCancellation !== 'function'
      || typeof notifyPendingIncidentCancellation !== 'function'
      || typeof writeAudit !== 'function') {
    throw new TypeError('Cần đồng hồ và các hàm thông báo Admin tương thích.');
  }

  return {
    async listUsers(query = {}) {
      const status = query.status === undefined || query.status === '' ? null : query.status;
      if (status !== null && status !== 'ACTIVE' && status !== 'ADMIN_LOCKED') {
        throw invalidQuery('status phải là ACTIVE hoặc ADMIN_LOCKED.');
      }
      const search = query.q === undefined ? '' : query.q;
      if (typeof search !== 'string' || search.length > 100) {
        throw invalidQuery('q phải là chuỗi không quá 100 ký tự.');
      }
      const pageSize = parsePageValue(query.page_size, 20, 'page_size', MAX_PAGE_SIZE);
      const maxPage = Math.floor(Number.MAX_SAFE_INTEGER / pageSize) + 1;
      const page = parsePageValue(query.page, 1, 'page', maxPage);
      const result = await adminRepository.listUsers({
        query: search.trim(),
        status,
        page,
        pageSize
      });
      return {
        users: result.rows.map((user) => {
          const total = Number(user.total_bookings);
          const completed = Number(user.completed_count);
          const cancelled = Number(user.cancelled_count);
          return {
            id: String(user.id),
            full_name: user.full_name,
            email: user.email,
            phone: user.phone,
            role: user.role,
            account_status: user.account_status,
            created_at: toIsoUtc(user.created_at),
            updated_at: toIsoUtc(user.updated_at),
            stats: {
              total_bookings: total,
              completed_count: completed,
              cancelled_count: cancelled,
              late_cancel_count: Number(user.late_cancel_count),
              completion_rate: total === 0 ? 0 : Number((completed * 100 / total).toFixed(2)),
              cancel_rate: total === 0 ? 0 : Number((cancelled * 100 / total).toFixed(2))
            }
          };
        }),
        pagination: {
          page,
          page_size: pageSize,
          total: result.total,
          total_pages: Math.ceil(result.total / pageSize)
        },
        server_time: now().toISOString()
      };
    },

    async setUserLock(rawUserId, locked, adminUserId, reason = '') {
      const userId = normalizeUserId(rawUserId);
      if (typeof reason !== 'string' || reason.trim().length > 300) {
        throw createAdminError(400, 'INVALID_LOCK_REASON', 'Lý do khóa không được vượt quá 300 ký tự.');
      }
      if (String(userId) === String(adminUserId)) {
        throw createAdminError(409, 'ADMIN_SELF_LOCK', 'Không thể khóa tài khoản Admin đang đăng nhập.');
      }
      return adminRepository.withTransaction(async (connection) => {
        const user = await adminRepository.lockUser(connection, userId);
        if (!user) {
          throw createAdminError(404, 'USER_NOT_FOUND', 'Không tìm thấy người dùng.');
        }
        const expectedStatus = locked ? 'ACTIVE' : 'ADMIN_LOCKED';
        const nextStatus = locked ? 'ADMIN_LOCKED' : 'ACTIVE';
        if (user.account_status !== expectedStatus) {
          throw createAdminError(409, 'USER_STATUS_CONFLICT', 'Trạng thái tài khoản đã thay đổi.');
        }
        const sessions = locked
          ? await adminRepository.lockUserSessions(connection, userId)
          : [];
        await adminRepository.updateUserLock(connection, userId, nextStatus);
        if (locked) await adminRepository.revokeUserSessions(connection, sessions);
        await writeAudit(connection, {
          adminUserId,
          action: locked ? 'USER_LOCK' : 'USER_UNLOCK',
          resourceType: 'user',
          resourceId: userId,
          details: reason.trim() ? { reason: reason.trim() } : null
        });
        const [rows] = await connection.execute(
          'SELECT account_status, updated_at FROM users WHERE id = ?',
          [userId]
        );
        return {
          id: String(userId),
          account_status: rows[0].account_status,
          updated_at: toIsoUtc(rows[0].updated_at)
        };
      });
    },

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
      const facilityId = parseFacilityId(query.facility_id);
      const date = parseBookingDate(query.date);
      const result = await adminRepository.listBookings({
        status: status || null,
        query: search.trim(),
        facilityId,
        date,
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
        server_time: now().toISOString(),
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
      const selectedRange = period || 'today';
      const window = getDashboardWindow(selectedRange, now());
      const [counts, revenue, revenueByDayRows, fillRate, topCourts, recent] = await Promise.all([
        adminRepository.getDashboardBookingCounts(window.start, window.end),
        adminRepository.getDashboardPaymentMetrics(window.start, window.end),
        adminRepository.getRevenueByDay(window.start, window.end),
        adminRepository.getDashboardFillRate(window.from, window.to),
        adminRepository.getTopCourts(window.start, window.end),
        adminRepository.getRecentBookings(5)
      ]);
      const grossPaid = BigInt(String(revenue.gross_paid || 0));
      const refunded = BigInt(String(revenue.refunded || 0));
      const revenueByDate = new Map(revenueByDayRows.map((row) => [
        String(row.date).slice(0, 10),
        String(row.net_revenue)
      ]));
      const revenueDays = [];
      const from = new Date(`${window.from}T00:00:00.000Z`);
      const to = new Date(`${window.to}T00:00:00.000Z`);
      for (let day = from; day <= to; day.setUTCDate(day.getUTCDate() + 1)) {
        const date = day.toISOString().slice(0, 10);
        revenueDays.push({ date, net_revenue: revenueByDate.get(date) || '0' });
      }
      const bookingIds = recent.map((booking) => String(booking.id));
      const recentSlots = await adminRepository.findBookingSlots(bookingIds);
      const slotsByBookingId = new Map(bookingIds.map((id) => [id, []]));
      for (const slot of recentSlots) {
        slotsByBookingId.get(String(slot.booking_id)).push({
          facility_name: slot.facility_name,
          court_name: slot.court_name,
          service_date: slot.service_date,
          starts_at: slot.starts_at,
          ends_at: slot.ends_at
        });
      }
      const netRevenue = grossPaid - refunded;
      return {
        period: selectedRange,
        range: { from: window.from, to: window.to },
        kpis: {
          new_bookings: Number(counts.new_bookings),
          confirmed_bookings: Number(counts.confirmed_bookings),
          cancelled_bookings: Number(counts.cancelled_bookings),
          net_revenue: netRevenue.toString(),
          gross_paid: grossPaid.toString(),
          refunded: refunded.toString(),
          fill_rate_percent: Number(fillRate.total_slots) === 0
            ? 0
            : Number((Number(fillRate.booked_slots) * 100 / Number(fillRate.total_slots)).toFixed(2)),
          pending_match_requests: 0
        },
        revenue_by_day: revenueDays,
        bookings_by_status: counts.bookings_by_status,
        top_courts: topCourts.map((court) => ({
          facility_name: court.facility_name,
          court_name: court.court_name,
          sport_type: court.sport_type,
          booking_count: Number(court.booking_count),
          revenue: String(court.revenue)
        })),
        recent_bookings: recent.map((booking) => ({
          booking_id: String(booking.id),
          booking_code: booking.booking_code,
          status: booking.status,
          created_at: booking.created_at,
          owner_name: booking.owner_name,
          facility_name: slotsByBookingId.get(String(booking.id))?.[0]?.facility_name || '',
          court_name: slotsByBookingId.get(String(booking.id))?.[0]?.court_name || '',
          service_date: slotsByBookingId.get(String(booking.id))?.[0]?.service_date || null,
          starts_at: slotsByBookingId.get(String(booking.id))?.[0]?.starts_at || null,
          paid_amount: String(booking.paid_amount || 0)
        })),
        new_bookings: Number(counts.new_bookings),
        net_revenue: netRevenue.toString(),
        cancelled_bookings: Number(counts.cancelled_bookings),
        completed_bookings: Number(counts.completed_bookings),
        server_time: now().toISOString()
      };
    },

    async cancelBookingForIncident(rawBookingId, body, adminUserId) {
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
          await writeAudit(connection, {
            adminUserId,
            action: 'INCIDENT_CANCELLATION',
            resourceType: 'booking',
            resourceId: booking.id,
            details: { status_before: booking.status, refund_amount: refundAmount }
          });
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
