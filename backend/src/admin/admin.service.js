'use strict';

const {
  createBookingsExport,
  createDashboardExport,
  createUsersExport
} = require('./bookings-export');
const createAdminRepository = require('./admin.repository');

const BOOKING_STATUSES = new Set([
  'PENDING',
  'CONFIRMED',
  'COMPLETED',
  'EXPIRED',
  'CANCELLED'
]);
const EXPORT_STATUSES = new Set([...BOOKING_STATUSES, 'UPCOMING', 'IN_PROGRESS']);
const DASHBOARD_RANGES = new Set(['today', '7d', '30d']);
const MAX_PAGE_SIZE = 50;
const BOOKING_PAGE_SIZE = createAdminRepository.BOOKING_PAGE_SIZE;
const MAX_EXPORT_ROWS = 5000;
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

function getVietnamMonthStartUtc(currentTime) {
  if (!(currentTime instanceof Date) || !Number.isFinite(currentTime.getTime())) {
    throw new TypeError('Thời gian thống kê người dùng phải hợp lệ.');
  }
  const vietnamNow = new Date(currentTime.getTime() + VIETNAM_OFFSET_MS);
  const utcBoundary = (month) => new Date(Date.UTC(
    vietnamNow.getUTCFullYear(),
    month,
    1
  ) - VIETNAM_OFFSET_MS).toISOString().slice(0, 23).replace('T', ' ');
  return {
    start: utcBoundary(vietnamNow.getUTCMonth()),
    end: utcBoundary(vietnamNow.getUTCMonth() + 1)
  };
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

function parseBookingFilters(query = {}, allowDisplayStatuses = true) {
  if (!query || typeof query !== 'object' || Array.isArray(query)) {
    throw invalidQuery('Bộ lọc đơn đặt sân không hợp lệ.');
  }
  const status = query.status;
  const validStatuses = allowDisplayStatuses ? EXPORT_STATUSES : BOOKING_STATUSES;
  if (status !== undefined && !validStatuses.has(status)) {
    throw invalidQuery('Trạng thái booking không được hỗ trợ.');
  }
  const search = query.q === undefined ? '' : query.q;
  if (typeof search !== 'string' || search.length > 100) {
    throw invalidQuery('q phải là chuỗi không quá 100 ký tự.');
  }
  const range = query.range === undefined || query.range === '' ? null : query.range;
  if (range !== null && !DASHBOARD_RANGES.has(range)) {
    throw invalidQuery('range phải là today, 7d hoặc 30d.');
  }
  return {
    status: status || null,
    query: search.trim(),
    facilityId: parseFacilityId(query.facility_id),
    date: parseBookingDate(query.date),
    range
  };
}

function getBookingPeriodFilters(range, currentTime) {
  if (!range) return { createdFrom: null, createdTo: null };
  const window = getDashboardWindow(range, currentTime);
  return { createdFrom: window.start, createdTo: window.end };
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
  if (typeof reason !== 'string') {
    throw createAdminError(400, 'INVALID_CANCELLATION_REASON', 'Lý do cần từ 3 đến 500 ký tự.');
  }
  const normalizedReason = reason.trim();
  if (normalizedReason.length < 3 || normalizedReason.length > 500) {
    throw createAdminError(400, 'INVALID_CANCELLATION_REASON', 'Lý do cần từ 3 đến 500 ký tự.');
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
  const previousFrom = new Date(from);
  previousFrom.setUTCDate(previousFrom.getUTCDate() - days);
  return {
    from: fromDate,
    to: toDate,
    start: new Date(Date.parse(`${fromDate}T00:00:00.000+07:00`)),
    end: new Date(Date.parse(`${endDate.toISOString().slice(0, 10)}T00:00:00.000+07:00`)),
    previousStart: new Date(Date.parse(`${previousFrom.toISOString().slice(0, 10)}T00:00:00.000+07:00`)),
    previousEnd: new Date(Date.parse(`${fromDate}T00:00:00.000+07:00`)),
    days
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
      const monthWindowUtc = getVietnamMonthStartUtc(now());
      const result = await adminRepository.listUsers({
        query: search.trim(),
        status,
        page,
        pageSize,
        monthStartUtc: monthWindowUtc.start,
        monthEndUtc: monthWindowUtc.end
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
        summary: result.summary,
        server_time: now().toISOString()
      };
    },

    async exportUsers(query = {}, adminUserId) {
      if (typeof adminRepository.exportUsers !== 'function'
          || typeof adminRepository.withTransaction !== 'function') {
        throw new TypeError('Repository Admin chưa hỗ trợ xuất người dùng.');
      }
      const status = query.status === undefined || query.status === '' ? null : query.status;
      if (status !== null && status !== 'ACTIVE' && status !== 'ADMIN_LOCKED') {
        throw invalidQuery('status phải là ACTIVE hoặc ADMIN_LOCKED.');
      }
      const search = query.q === undefined ? '' : query.q;
      if (typeof search !== 'string' || search.length > 100) {
        throw invalidQuery('q phải là chuỗi không quá 100 ký tự.');
      }
      const monthWindowUtc = getVietnamMonthStartUtc(now());
      const result = await adminRepository.exportUsers({
        query: search.trim(),
        status,
        monthStartUtc: monthWindowUtc.start,
        monthEndUtc: monthWindowUtc.end,
        maxRows: MAX_EXPORT_ROWS
      });
      if (result.total > MAX_EXPORT_ROWS) {
        throw createAdminError(
          400,
          'EXPORT_TOO_MANY_ROWS',
          'Quá nhiều dòng, hãy lọc thu hẹp'
        );
      }
      const exported = await createUsersExport({
        users: result.rows,
        summary: result.summary,
        now: now()
      });
      await adminRepository.withTransaction((connection) => writeAudit(connection, {
        adminUserId,
        action: 'EXPORT_USERS',
        resourceType: 'users_export',
        resourceId: String(adminUserId),
        details: {
          filters: { status, query_applied: Boolean(search.trim()) },
          row_count: result.total
        }
      }));
      return exported;
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

    async listBookings(query = {}) {
      const filters = parseBookingFilters(query);
      if (query.page_size !== undefined
          && parsePageValue(query.page_size, BOOKING_PAGE_SIZE, 'page_size', MAX_PAGE_SIZE)
            !== BOOKING_PAGE_SIZE) {
        throw invalidQuery(`page_size cố định ở mức ${BOOKING_PAGE_SIZE}.`);
      }
      const pageSize = BOOKING_PAGE_SIZE;
      const maxPage = Math.floor(Number.MAX_SAFE_INTEGER / pageSize) + 1;
      const page = parsePageValue(query.page, 1, 'page', maxPage);
      const periodFilters = getBookingPeriodFilters(filters.range, now());
      const result = await adminRepository.listBookings({
        ...filters,
        ...periodFilters,
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
          can_cancel_incident: booking.status === 'CONFIRMED'
            || (booking.status === 'PENDING' && Number(booking.lock_active) === 1),
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
        },
        status_counts: result.statusCounts
      };
    },

    async exportBookings(query = {}, adminUserId) {
      if (typeof adminRepository.exportBookings !== 'function'
          || typeof adminRepository.withTransaction !== 'function') {
        throw new TypeError('Repository Admin chưa hỗ trợ xuất đơn đặt sân.');
      }
      const filters = parseBookingFilters(query, true);
      const periodFilters = getBookingPeriodFilters(filters.range, now());
      const result = await adminRepository.exportBookings({
        ...filters,
        ...periodFilters,
        maxRows: MAX_EXPORT_ROWS
      });
      if (result.total > MAX_EXPORT_ROWS) {
        throw createAdminError(
          400,
          'EXPORT_TOO_MANY_ROWS',
          'Quá nhiều dòng, hãy lọc thu hẹp'
        );
      }
      const bookingIds = result.rows.map((booking) => String(booking.id));
      const slotRows = await adminRepository.findBookingSlots(bookingIds);
      const slotsByBookingId = new Map(bookingIds.map((id) => [id, []]));
      for (const slot of slotRows) {
        slotsByBookingId.get(String(slot.booking_id)).push(slot);
      }
      const currentTime = now();
      const exported = await createBookingsExport({
        bookings: result.rows,
        slotsByBookingId,
        now: currentTime
      });
      await adminRepository.withTransaction((connection) => writeAudit(connection, {
        adminUserId,
        action: 'EXPORT_BOOKINGS',
        resourceType: 'bookings_export',
        resourceId: String(adminUserId),
        details: {
          filters: {
            status: filters.status,
            range: filters.range,
            facility_id: filters.facilityId,
            date: filters.date,
            query_applied: Boolean(filters.query)
          },
          row_count: result.total
        }
      }));
      return exported;
    },

    async getBookingDetail(rawBookingId) {
      const bookingId = normalizeBookingId(rawBookingId);
      const booking = await adminRepository.getBookingDetail(bookingId);
      if (!booking) {
        throw createAdminError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy đơn đặt sân.');
      }
      const slots = await adminRepository.findBookingSlots([bookingId]);
      return {
        booking: {
          booking_id: bookingId,
          booking_code: booking.booking_code,
          status: booking.status,
          can_cancel_incident: booking.status === 'CONFIRMED'
            || (booking.status === 'PENDING' && Number(booking.lock_active) === 1),
          created_at: toIsoUtc(booking.created_at),
          total_amount: String(booking.total_amount),
          payment_status: booking.payment_status,
          payment_option: booking.payment_option,
          paid_amount: String(booking.paid_amount || 0),
          refunded_amount: String(booking.refunded_amount || 0),
          cancelled_by: booking.cancelled_by,
          cancellation_reason: booking.cancellation_reason,
          owner: {
            user_id: String(booking.owner_id),
            full_name: booking.owner_full_name,
            email: booking.owner_email,
            phone: booking.owner_phone
          },
          slots: slots.map((slot) => ({
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
          }))
        }
      };
    },

    async getDashboard(periodOrQuery = 'today') {
      const query = typeof periodOrQuery === 'string'
        ? { range: periodOrQuery || 'today' }
        : {
          ...periodOrQuery,
          range: periodOrQuery?.range || periodOrQuery?.period || 'today'
        };
      const filters = parseBookingFilters(query, true);
      const selectedRange = filters.range || 'today';
      const window = getDashboardWindow(selectedRange, now());
      const [counts, revenue, previousRevenue, revenueByDayRows, revenueSeriesRows,
        bookingSeriesRows, fillRate, courtCounts, topCourts, recent] = await Promise.all([
        adminRepository.getDashboardBookingCounts(window.start, window.end, filters),
        adminRepository.getDashboardPaymentMetrics(window.start, window.end, filters),
        adminRepository.getDashboardPaymentMetrics(window.previousStart, window.previousEnd, filters),
        adminRepository.getRevenueByDay(window.start, window.end, filters),
        adminRepository.getRevenueSeries(window.start, window.end, selectedRange === 'today', filters),
        adminRepository.getBookingSeries(window.start, window.end, selectedRange === 'today', filters),
        adminRepository.getDashboardFillRate(window.from, window.to),
        adminRepository.getDashboardCourtCounts(window.start, window.end, filters),
        adminRepository.getTopCourts(window.start, window.end, filters),
        adminRepository.getRecentBookings(5, {
          ...filters,
          createdFrom: window.start,
          createdTo: window.end
        })
      ]);
      const grossPaid = BigInt(String(revenue.gross_paid || 0));
      const refunded = BigInt(String(revenue.refunded || 0));
      const occupiedSlots = Number(fillRate.occupied_slots);
      const totalSlots = Number(fillRate.total_slots);
      const daysWithSlots = Number(fillRate.days_with_slots);
      const previousNetRevenue = BigInt(String(previousRevenue.gross_paid || 0))
        - BigInt(String(previousRevenue.refunded || 0));
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
      const granularity = selectedRange === 'today' ? 'hour' : 'day';
      const revenueByBucket = new Map(revenueSeriesRows.map((row) => [
        String(row.bucket),
        String(row.net_revenue)
      ]));
      const bookingsByBucket = new Map(bookingSeriesRows.map((row) => [
        String(row.bucket),
        Number(row.bookings)
      ]));
      const buckets = [];
      if (granularity === 'hour') {
        for (let hour = 0; hour < 24; hour += 1) {
          const localBucket = `${window.from} ${String(hour).padStart(2, '0')}:00:00`;
          buckets.push({
            start: new Date(Date.parse(`${window.from}T${String(hour).padStart(2, '0')}:00:00+07:00`)).toISOString(),
            net_revenue: revenueByBucket.get(localBucket) || '0',
            bookings: bookingsByBucket.get(localBucket) || 0
          });
        }
      } else {
        for (const day of revenueDays) {
          const localBucket = `${day.date} 00:00:00`;
          buckets.push({
            start: new Date(Date.parse(`${day.date}T00:00:00+07:00`)).toISOString(),
            net_revenue: revenueByBucket.get(localBucket) || '0',
            bookings: bookingsByBucket.get(localBucket) || 0
          });
        }
      }
      return {
        period: selectedRange,
        range: { from: window.from, to: window.to },
        kpis: {
          new_bookings: Number(counts.new_bookings),
          confirmed_bookings: Number(counts.confirmed_bookings),
          cancelled_bookings: Number(counts.cancelled_bookings),
          net_revenue: netRevenue.toString(),
          net_revenue_prev: previousNetRevenue.toString(),
          gross_paid: grossPaid.toString(),
          refunded: refunded.toString(),
          fill_rate_percent: totalSlots === 0
            ? 0
            : occupiedSlots * 100 / totalSlots,
          fill_rate_occupied_slots: occupiedSlots,
          fill_rate_total_slots: totalSlots,
          fill_rate_days_with_slots: daysWithSlots,
          fill_rate_period_days: window.days,
          courts_active: Number(courtCounts.courts_active),
          courts_with_bookings: Number(courtCounts.courts_with_bookings),
          courts_inactive: Number(courtCounts.courts_inactive),
          pending_match_requests: 0
        },
        series: { granularity, buckets },
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
          customer_phone: booking.owner_phone || null,
          facility_name: slotsByBookingId.get(String(booking.id))?.[0]?.facility_name || '',
          court_name: slotsByBookingId.get(String(booking.id))?.[0]?.court_name || '',
          service_date: slotsByBookingId.get(String(booking.id))?.[0]?.service_date || null,
          starts_at: slotsByBookingId.get(String(booking.id))?.[0]?.starts_at || null,
          paid_amount: String(booking.paid_amount || 0),
          refunded_amount: String(booking.refunded_amount || 0),
          payment_status: booking.payment_status,
          payment_option: booking.payment_option,
          can_cancel_incident: booking.status === 'CONFIRMED'
            || (booking.status === 'PENDING' && Boolean(booking.lock_active))
        })),
        new_bookings: Number(counts.new_bookings),
        net_revenue: netRevenue.toString(),
        cancelled_bookings: Number(counts.cancelled_bookings),
        completed_bookings: Number(counts.completed_bookings),
        server_time: now().toISOString()
      };
    },

    async exportDashboard(query = {}, adminUserId) {
      if (typeof adminRepository.withTransaction !== 'function') {
        throw new TypeError('Repository Admin chưa hỗ trợ nhật ký xuất báo cáo.');
      }
      const dashboard = await this.getDashboard({
        ...query,
        range: query.range || query.period || 'today'
      });
      const exported = await createDashboardExport({ dashboard, now: now() });
      await adminRepository.withTransaction((connection) => writeAudit(connection, {
        adminUserId,
        action: 'EXPORT_DASHBOARD',
        resourceType: 'dashboard_export',
        resourceId: String(adminUserId),
        details: { filters: { period: query.range || query.period || 'today' }, row_count: 1 }
      }));
      return exported;
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
            await notifyIncidentCancellation(
              connection,
              notificationBooking,
              refundAmount,
              cancellationReason
            );
          } else {
            await notifyIncidentCancellation(
              connection,
              notificationBooking,
              refundAmount,
              cancellationReason
            );
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
