'use strict';

const {
  notifyHoldExpired,
  notifyPaymentSucceeded,
  notifyUserCancellation
} = require('../notifications/notification-events');

const crypto = require('node:crypto');
const {
  REFUND_MESSAGES,
  getCancellationRefund,
  slotEndTimestamp,
  slotStartTimestamp
} = require('./cancellation-policy');

function createBookingError(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function normalizeSlotIds(slotIds) {
  if (!Array.isArray(slotIds) || slotIds.length === 0) {
    throw createBookingError(400, 'INVALID_SLOT_IDS', 'Danh sách slot_ids không được để trống.');
  }

  const ids = slotIds.map((id) => {
    const value = typeof id === 'number' && Number.isSafeInteger(id) ? String(id) : id;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
      throw createBookingError(400, 'INVALID_SLOT_IDS', 'Mỗi ID khung giờ phải là số nguyên dương.');
    }
    if (BigInt(value) > 18446744073709551615n) {
      throw createBookingError(400, 'INVALID_SLOT_IDS', 'ID khung giờ vượt quá phạm vi cho phép.');
    }
    return value;
  });

  if (new Set(ids).size !== ids.length) {
    throw createBookingError(400, 'INVALID_SLOT_IDS', 'Danh sách slot_ids không được chứa giá trị trùng.');
  }
  return ids;
}

function normalizePaymentOption(value) {
  if (value !== 'DEPOSIT_50' && value !== 'FULL') {
    throw createBookingError(400, 'INVALID_PAYMENT_OPTION', 'payment_option phải là DEPOSIT_50 hoặc FULL.');
  }
  return value;
}

function normalizeMatchPreference(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw createBookingError(400, 'INVALID_MATCH_PREFERENCE', 'match_preference phải là một đối tượng hoặc null.');
  }
  const allowedKeys = new Set(['mode', 'gender', 'skill', 'format', 'message']);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) {
    throw createBookingError(400, 'INVALID_MATCH_PREFERENCE', 'match_preference chứa trường không được hỗ trợ.');
  }
  if (value.mode !== 'RANDOM' && value.mode !== 'CRITERIA') {
    throw createBookingError(400, 'INVALID_MATCH_PREFERENCE', 'match_preference.mode phải là RANDOM hoặc CRITERIA.');
  }
  const validGender = value.gender === undefined || value.gender === null
    || ['ANY', 'MALE', 'FEMALE'].includes(value.gender);
  const validSkill = value.skill === undefined || value.skill === null
    || ['BEGINNER', 'INTERMEDIATE', 'GOOD'].includes(value.skill);
  const validFormat = value.format === undefined || value.format === null
    || ['SINGLES', 'DOUBLES'].includes(value.format);
  if (!validGender || !validSkill || !validFormat) {
    throw createBookingError(400, 'INVALID_MATCH_PREFERENCE', 'Tùy chọn tìm đối chứa tiêu chí không được hỗ trợ.');
  }
  if (value.message !== undefined && value.message !== null
      && (typeof value.message !== 'string' || value.message.length > 1000)) {
    throw createBookingError(400, 'INVALID_MATCH_PREFERENCE', 'match_preference.message không được vượt quá 1000 ký tự.');
  }
  if (value.mode === 'RANDOM' && (value.gender != null || value.skill != null)) {
    throw createBookingError(400, 'INVALID_MATCH_PREFERENCE', 'Tìm đối ngẫu nhiên không thể kèm tiêu chí giới tính hoặc trình độ.');
  }
  return {
    mode: value.mode,
    gender: value.gender ?? null,
    skill: value.skill ?? null,
    format: value.format ?? null,
    message: typeof value.message === 'string' && value.message.trim()
      ? value.message.trim()
      : null
  };
}

function parseMatchPreference(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (error) {
      throw createBookingError(500, 'INVALID_STORED_MATCH_PREFERENCE', 'Tùy chọn tìm đối đã lưu không hợp lệ.');
    }
  }
  return value;
}

function normalizeBookingId(id) {
  if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id)
      || BigInt(id) > 18446744073709551615n) {
    throw createBookingError(400, 'INVALID_BOOKING_ID', 'Mã đơn đặt sân không hợp lệ.');
  }
  return id;
}

function normalizeCancellationRequest(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => ![
        'cancellation_reason',
        'expected_refund_amount',
        'expected_refund_percent'
      ].includes(key))) {
    throw createBookingError(400, 'INVALID_CANCELLATION', 'Thông tin hủy đơn không hợp lệ.');
  }
  const reason = body.cancellation_reason;
  if (reason !== undefined && reason !== null && reason !== ''
      && (typeof reason !== 'string' || reason.length > 500)) {
    throw createBookingError(400, 'INVALID_CANCELLATION_REASON', 'Lý do hủy không được vượt quá 500 ký tự.');
  }
  const expectedAmountProvided = Object.hasOwn(body, 'expected_refund_amount');
  const expectedPercentProvided = Object.hasOwn(body, 'expected_refund_percent');
  if (expectedAmountProvided !== expectedPercentProvided) {
    throw createBookingError(400, 'INVALID_CANCELLATION', 'Thông tin preview hoàn tiền không đầy đủ.');
  }
  let expectedRefund = null;
  if (expectedAmountProvided) {
    if (!/^(0|[1-9]\d*)$/.test(String(body.expected_refund_amount))
        || ![0, 50, 100].includes(body.expected_refund_percent)) {
      throw createBookingError(400, 'INVALID_CANCELLATION', 'Thông tin preview hoàn tiền không hợp lệ.');
    }
    expectedRefund = {
      refund_amount: String(body.expected_refund_amount),
      refund_percent: body.expected_refund_percent
    };
  }
  return {
    cancellationReason: typeof reason === 'string' ? reason.trim() || null : null,
    expectedRefund
  };
}

function normalizePaymentAttempt(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)
      || Object.keys(body).some((key) => !['method', 'simulation_result'].includes(key))) {
    throw createBookingError(400, 'INVALID_PAYMENT_ATTEMPT', 'Thông tin yêu cầu thanh toán không hợp lệ.');
  }
  const methods = ['BANK_TRANSFER', 'MOMO', 'DOMESTIC_ATM', 'INTERNATIONAL_CARD'];
  if (!methods.includes(body.method)
      || !['SUCCESS', 'FAILURE'].includes(body.simulation_result)) {
    throw createBookingError(400, 'INVALID_PAYMENT_ATTEMPT', 'method hoặc simulation_result không hợp lệ.');
  }
  return { method: body.method, simulationResult: body.simulation_result };
}

function asNumber(value) {
  return Number(value);
}

const BOOKING_STATUSES = new Set(['PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'EXPIRED']);
const MAX_PAGE_SIZE = 50;
const MAX_BOOKING_CODE_ATTEMPTS = 5;
const BOOKING_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const SUMMARY_STATUS_LABELS = Object.freeze({
  pending: 'Chờ thanh toán',
  active: 'Sắp tới/Đang trong trận',
  completed: 'Hoàn thành',
  cancelled: 'Đã hủy',
  expired: 'Hết hạn'
});

function generateBookingCode(now = new Date(), randomBytes = crypto.randomBytes) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new TypeError('Thời điểm tạo đơn đặt sân phải hợp lệ.');
  }
  const date = new Date(now.getTime() + 7 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10)
    .replaceAll('-', '');
  const bytes = randomBytes(6);
  if (!Buffer.isBuffer(bytes) || bytes.length !== 6) {
    throw new TypeError('Hàm tạo mã đơn phải trả về sáu byte ngẫu nhiên.');
  }
  const suffix = [...bytes].map((byte) => BOOKING_CODE_ALPHABET[byte & 31]).join('');
  return `SPB-${date}-${suffix}`;
}

async function createBookingWithUniqueCode(repository, connection, bookingInput, {
  now,
  generateCode = generateBookingCode
}) {
  for (let attempt = 0; attempt < MAX_BOOKING_CODE_ATTEMPTS; attempt += 1) {
    const bookingCode = generateCode(now());
    try {
      const bookingId = await repository.createBooking(connection, {
        ...bookingInput,
        bookingCode
      });
      return { bookingId, bookingCode };
    } catch (error) {
      if (attempt === MAX_BOOKING_CODE_ATTEMPTS - 1
          || !repository.isBookingCodeConflict(error)) {
        throw error;
      }
    }
  }
  throw new Error('Đã hết số lần thử tạo mã đơn đặt sân.');
}

function createInvalidQueryError(message) {
  return createBookingError(400, 'INVALID_BOOKING_QUERY', message);
}

function parsePageValue(value, fallback, field, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw createInvalidQueryError(`${field} phải là số nguyên dương.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw createInvalidQueryError(`${field} nằm ngoài phạm vi cho phép.`);
  }
  return parsed;
}

function parseLocalTimestamp(value) {
  if (typeof value !== 'string') {
    throw new TypeError('Cơ sở dữ liệu trả về thời gian khung giờ không hợp lệ.');
  }
  const match = value.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})$/);
  if (!match) {
    throw new TypeError('Cơ sở dữ liệu trả về thời gian khung giờ không hợp lệ.');
  }
  const timestamp = Date.parse(`${match[1]}T${match[2]}+07:00`);
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('Cơ sở dữ liệu trả về thời gian khung giờ không hợp lệ.');
  }
  return timestamp;
}

function getBookingDisplayState(booking, now = new Date()) {
  const nowMs = now instanceof Date ? now.getTime() : Number.NaN;
  if (!Number.isFinite(nowMs)) {
    throw new TypeError('Thời gian hiện tại phải hợp lệ.');
  }

  switch (booking.status) {
    case 'PENDING':
      return Number(booking.lock_expired) === 1
        ? { code: 'EXPIRED', label: 'Đã hết hạn' }
        : { code: 'PENDING', label: 'Chờ thanh toán' };
    case 'EXPIRED':
      return { code: 'EXPIRED', label: 'Đã hết hạn' };
    case 'CANCELLED':
      return { code: 'CANCELLED', label: 'Đã hủy' };
    case 'COMPLETED':
      return { code: 'COMPLETED', label: 'Hoàn thành' };
    case 'CONFIRMED':
      break;
    default:
      throw new TypeError('Cơ sở dữ liệu trả về trạng thái đơn đặt sân không được hỗ trợ.');
  }

  let startAt;
  let endAt;
  if (booking.first_slot_start && booking.last_slot_end) {
    startAt = parseLocalTimestamp(booking.first_slot_start);
    endAt = parseLocalTimestamp(booking.last_slot_end);
  } else {
    if (!Array.isArray(booking.slots) || booking.slots.length === 0) {
      throw new TypeError('Đơn đã xác nhận phải có ít nhất một khung giờ.');
    }
    const orderedSlots = [...booking.slots].sort((left, right) => {
      const startDifference = parseLocalTimestamp(
        `${left.service_date}T${left.starts_at}`
      ) - parseLocalTimestamp(`${right.service_date}T${right.starts_at}`);
      return startDifference;
    });
    const first = orderedSlots[0];
    const last = orderedSlots[orderedSlots.length - 1];
    startAt = parseLocalTimestamp(`${first.service_date}T${first.starts_at}`);
    endAt = parseLocalTimestamp(`${last.service_date}T${last.ends_at}`);
  }
  if (endAt < startAt) {
    throw new TypeError('Cơ sở dữ liệu trả về khoảng thời gian khung giờ không hợp lệ.');
  }

  if (nowMs < startAt) {
    return { code: 'UPCOMING', label: 'Sắp tới' };
  }
  if (nowMs < endAt) {
    return { code: 'IN_PROGRESS', label: 'Đang trong trận' };
  }
  return { code: 'COMPLETED', label: 'Hoàn thành' };
}

function toHistorySlot(slot) {
  return {
    time_slot_id: String(slot.time_slot_id),
    court_id: String(slot.court_id),
    service_date: slot.service_date,
    starts_at: slot.starts_at,
    ends_at: slot.ends_at,
    price_at_booking: String(slot.price_at_booking),
    court_name: slot.court_name,
    sport_type: slot.sport_type,
    facility_id: String(slot.facility_id),
    facility_name: slot.facility_name
  };
}

function toSlotResponse(slot) {
  return {
    time_slot_id: String(slot.id || slot.time_slot_id),
    court_id: String(slot.court_id),
    service_date: slot.service_date,
    starts_at: slot.starts_at,
    ends_at: slot.ends_at,
    price: String(slot.price),
    court_name: slot.court_name,
    sport_type: slot.sport_type,
    facility_id: String(slot.facility_id),
    facility_name: slot.facility_name
  };
}

function createBookingsService(repository, {
  now = () => new Date(),
  generateCode = generateBookingCode
} = {}) {
  if (!repository || typeof repository.withTransaction !== 'function') {
    throw new TypeError('Cần repository đặt sân tương thích.');
  }
  if (typeof now !== 'function') {
    throw new TypeError('Cần hàm cung cấp thời gian hiện tại.');
  }

  async function createBooking(userId, body) {
    const slotIds = normalizeSlotIds(body && body.slot_ids);
    const paymentOption = normalizePaymentOption(body && body.payment_option);
    const matchPreference = normalizeMatchPreference(body && body.match_preference);
    try {
      const result = await repository.withTransaction(async (connection) => {
        const user = await repository.lockUser(connection, userId);
        if (!user) {
          throw createBookingError(401, 'UNAUTHENTICATED', 'Vui lòng đăng nhập.');
        }
        const pendingBookings = await repository.lockPendingBookingsForUser(connection, userId);
        const activePending = pendingBookings.find((booking) => Number(booking.lock_expired) !== 1);
        const expiredPendingIds = pendingBookings
          .filter((booking) => Number(booking.lock_expired) === 1)
          .map((booking) => String(booking.id));
        if (expiredPendingIds.length > 0) {
          const staleSlotIds = await repository.findSlotIdsForBookings(connection, expiredPendingIds);
          const uniqueStaleSlotIds = [...new Set(staleSlotIds.map(String))]
            .sort((left, right) => (BigInt(left) < BigInt(right) ? -1 : 1));
          const staleSlots = await repository.lockTimeSlots(connection, uniqueStaleSlotIds);
          if (staleSlots.length !== uniqueStaleSlotIds.length) {
            throw createBookingError(409, 'SLOT_CHANGED', 'Khung giờ của đơn hết hạn đã thay đổi khi được giải phóng.');
          }
          for (const expiredBookingId of expiredPendingIds) {
            const expiredBooking = pendingBookings.find(
              (booking) => String(booking.id) === expiredBookingId
            );
            await repository.expireStaleBooking(connection, expiredBookingId);
            const slots = await repository.findNotificationSlots(connection, expiredBookingId);
            await notifyHoldExpired(connection, { ...expiredBooking, slots });
          }
        }
        if (activePending) {
          return { pendingConflict: activePending };
        }

        const initialSlots = await repository.findRequestedSlotStates(connection, slotIds);
        if (initialSlots.length !== slotIds.length) {
          throw createBookingError(404, 'SLOT_NOT_FOUND', 'Không tìm thấy một hoặc nhiều khung giờ.');
        }

        const expiredBookingIds = initialSlots
          .filter((slot) => slot.status === 'LOCKED'
            && slot.current_booking_id !== null
            && Number(slot.lock_expired) === 1)
          .map((slot) => String(slot.current_booking_id));
        const uniqueExpiredBookingIds = [...new Set(expiredBookingIds)]
          .sort((left, right) => (BigInt(left) < BigInt(right) ? -1 : 1));
        const oldBookings = await repository.lockBookings(connection, uniqueExpiredBookingIds);
        const oldBookingById = new Map(oldBookings.map((booking) => [String(booking.id), booking]));
        const oldBookingSlotIds = await repository.findSlotIdsForBookings(
          connection,
          uniqueExpiredBookingIds
        );
        const allSlotIds = [...new Set([...slotIds, ...oldBookingSlotIds.map(String)])]
          .sort((left, right) => (BigInt(left) < BigInt(right) ? -1 : 1));
        const lockedSlots = await repository.lockTimeSlots(connection, allSlotIds);
        if (lockedSlots.length !== allSlotIds.length) {
          throw createBookingError(409, 'SLOT_CHANGED', 'Khung giờ đã thay đổi trong khi đặt sân.');
        }
        const lockedById = new Map(lockedSlots.map((slot) => [String(slot.id), slot]));
        const requestedSlots = slotIds.map((id) => lockedById.get(id));
        if (requestedSlots.some((slot) => !slot)) {
          throw createBookingError(404, 'SLOT_NOT_FOUND', 'Không tìm thấy một hoặc nhiều khung giờ.');
        }

        for (const oldBookingId of uniqueExpiredBookingIds) {
          const booking = oldBookingById.get(oldBookingId);
          if (!booking || (booking.status === 'PENDING' && Number(booking.lock_expired) !== 1)) {
            throw createBookingError(409, 'SLOT_CHANGED', 'Khung giờ hết hạn vẫn đang được một đơn đặt giữ.');
          }
          await repository.expireStaleBooking(connection, oldBookingId);
          const slots = await repository.findNotificationSlots(connection, oldBookingId);
          await notifyHoldExpired(connection, { ...booking, slots });
        }

        for (const slot of requestedSlots) {
          if ((slot.court_is_active !== 1 && slot.court_is_active !== true)
              || (slot.facility_is_active !== 1 && slot.facility_is_active !== true)) {
            throw createBookingError(409, 'SLOT_UNAVAILABLE', 'Sân hiện không khả dụng.');
          }
          const expiredLock = slot.status === 'LOCKED' && Number(slot.lock_expired) === 1;
          if (slot.status !== 'AVAILABLE' && !expiredLock) {
            throw createBookingError(409, 'SLOT_UNAVAILABLE', 'Một hoặc nhiều khung giờ không khả dụng.');
          }
          if (slot.status === 'LOCKED' && slot.current_booking_id !== null
              && !uniqueExpiredBookingIds.includes(String(slot.current_booking_id))) {
            throw createBookingError(409, 'SLOT_CHANGED', 'Khung giờ đã thay đổi trong khi đặt sân.');
          }
          if (Number(slot.starts_in_time) !== 1) {
            throw createBookingError(400, 'SLOT_TOO_SOON', 'Khung giờ phải bắt đầu sau thời điểm hiện tại ít nhất 15 phút.');
          }
          if (matchPreference && Number(slot.starts_in_match_time) !== 1) {
            throw createBookingError(
              400,
              'MATCH_PREFERENCE_TOO_LATE',
              'Tìm đối yêu cầu khung giờ đầu tiên bắt đầu sau thời điểm hiện tại ít nhất 30 phút.'
            );
          }
        }

        const chronologicalSlots = [...requestedSlots].sort((left, right) => (
          left.starts_at.localeCompare(right.starts_at)
          || (BigInt(left.id) < BigInt(right.id) ? -1 : 1)
        ));
        const firstSlot = chronologicalSlots[0];
        if (matchPreference && matchPreference.format
            && !['BADMINTON', 'PICKLEBALL'].includes(firstSlot.sport_type)) {
          throw createBookingError(
            400,
            'MATCH_FORMAT_NOT_SUPPORTED',
            'Chỉ hỗ trợ hình thức đơn/đôi với cầu lông và pickleball.'
          );
        }
        for (let index = 1; index < chronologicalSlots.length; index += 1) {
          const previous = chronologicalSlots[index - 1];
          const current = chronologicalSlots[index];
          if (String(current.court_id) !== String(firstSlot.court_id)
              || String(previous.service_date) !== String(current.service_date)
              || previous.ends_at !== current.starts_at) {
            throw createBookingError(400, 'SLOTS_NOT_CONTIGUOUS', 'Các khung giờ phải liên tiếp, cùng sân và cùng ngày.');
          }
        }

        const totalAmount = chronologicalSlots.reduce(
          (total, slot) => total + BigInt(String(slot.price)),
          0n
        ).toString();
        const totalAmountInteger = BigInt(totalAmount);
        const depositAmount = ((totalAmountInteger + 1n) / 2n).toString();
        const amountDue = paymentOption === 'DEPOSIT_50' ? depositAmount : totalAmount;
        const amountDueAtVenue = paymentOption === 'DEPOSIT_50'
          ? (totalAmountInteger - BigInt(depositAmount)).toString()
          : '0';
        const lockExpiresAt = await repository.createHoldDeadline(connection);
        const createdBooking = await createBookingWithUniqueCode(repository, connection, {
          userId,
          totalAmount,
          matchPreference: matchPreference === null ? null : JSON.stringify(matchPreference),
          expiresAt: lockExpiresAt
        }, { now, generateCode });
        const { bookingId, bookingCode } = createdBooking;
        await repository.createPayment(connection, {
          bookingId,
          amountDue,
          paymentOption
        });
        await repository.createBookingSlots(connection, bookingId, chronologicalSlots);
        const affectedRows = await repository.lockTimeSlotsForBooking(
          connection,
          slotIds,
          bookingId,
          lockExpiresAt
        );
        if (affectedRows !== slotIds.length) {
          throw createBookingError(409, 'SLOT_UNAVAILABLE', 'Một hoặc nhiều khung giờ không khả dụng.');
        }

        return {
          booking_id: String(bookingId),
          booking_code: bookingCode,
          status: 'PENDING',
          total_amount: totalAmount,
          payment: {
            status: 'PENDING',
            payment_option: paymentOption,
            amount_due: amountDue
          },
          deposit_amount: depositAmount,
          amount_due_at_venue: amountDueAtVenue,
          match_preference: matchPreference,
          lock_expires_at: lockExpiresAt,
          remaining_seconds: 600,
          slots: chronologicalSlots.map(toSlotResponse)
        };
      });
      if (result?.pendingConflict) {
        throw createBookingError(
          409,
          'PENDING_BOOKING_EXISTS',
          'Bạn đang có một đơn đặt sân còn hiệu lực.',
          {
            pending_booking_id: String(result.pendingConflict.id),
            remaining_seconds: Number(result.pendingConflict.remaining_seconds)
          }
        );
      }
      return result;
    } catch (error) {
      if (error.code === 'ER_LOCK_DEADLOCK' || error.code === 'ER_LOCK_WAIT_TIMEOUT') {
        throw createBookingError(409, 'BOOKING_CONFLICT', 'Đơn đặt sân bị xung đột với một yêu cầu khác.');
      }
      throw error;
    }
  }

  async function listBookings(user, query) {
    if (query.mine !== 'true') {
      throw createInvalidQueryError('mine phải là true.');
    }
    const status = query.status;
    if (status !== undefined && !BOOKING_STATUSES.has(status)) {
      throw createInvalidQueryError('Trạng thái không được hỗ trợ.');
    }
    const search = query.q === undefined ? '' : query.q;
    if (typeof search !== 'string' || search.length > 100) {
      throw createInvalidQueryError('q phải là chuỗi không quá 100 ký tự.');
    }
    const q = search.trim();
    const sport = query.sport === undefined ? null : query.sport;
    if (sport !== null && !['FOOTBALL_MINI', 'BADMINTON', 'PICKLEBALL'].includes(sport)) {
      throw createInvalidQueryError('Môn thể thao không được hỗ trợ.');
    }
    const pageSize = parsePageValue(query.page_size, 10, 'page_size', MAX_PAGE_SIZE);
    const maxPage = Math.floor(Number.MAX_SAFE_INTEGER / pageSize) + 1;
    const page = parsePageValue(query.page, 1, 'page', maxPage);
    const result = await repository.listBookingsForUser({
      userId: user.id,
      status: status || null,
      q: q || null,
      sport,
      page,
      pageSize
    });
    const bookingIds = result.rows.map((booking) => String(booking.id));
    const slotRows = await repository.findOwnedBookingSlotsByIds(user.id, bookingIds);
    const slotsByBookingId = new Map(bookingIds.map((id) => [id, []]));
    for (const slot of slotRows) {
      slotsByBookingId.get(String(slot.booking_id)).push(toHistorySlot(slot));
    }
    const currentTime = now();
    const bookings = result.rows.map((booking) => {
      const slots = slotsByBookingId.get(String(booking.id));
      const displayState = getBookingDisplayState({
        status: booking.status,
        lock_expired: booking.lock_expired,
        slots
      }, currentTime);
      return {
        booking_id: String(booking.id),
        booking_code: booking.booking_code,
        status: booking.status,
        display_status_code: displayState.code,
        display_status: displayState.label,
        created_at: booking.created_at,
        total_amount: String(booking.total_amount),
        facility_id: slots[0] ? slots[0].facility_id : null,
        court_id: slots[0] ? slots[0].court_id : null,
        sport_type: slots[0] ? slots[0].sport_type : null,
        payment_status: booking.payment_status,
        paid_amount: booking.paid_amount === null ? null : String(booking.paid_amount),
        refunded_amount: booking.refunded_amount === null ? null : String(booking.refunded_amount),
        remaining_seconds: booking.remaining_seconds === null
          ? null
          : asNumber(booking.remaining_seconds),
        slots
      };
    });
    return {
      bookings,
      pagination: {
        page,
        page_size: pageSize,
        total: result.total,
        total_pages: Math.ceil(result.total / pageSize)
      }
    };
  }

  async function getBookingSummary(user) {
    const bookingRows = await repository.findBookingSummaryRows(user.id);
    const spent = await repository.getTotalSpentForUser(user.id);
    const summary = {
      upcoming_count: 0,
      completed_count: 0,
      total_spent: String(spent),
      counts_by_status: {
        [SUMMARY_STATUS_LABELS.pending]: 0,
        [SUMMARY_STATUS_LABELS.active]: 0,
        [SUMMARY_STATUS_LABELS.completed]: 0,
        [SUMMARY_STATUS_LABELS.cancelled]: 0,
        [SUMMARY_STATUS_LABELS.expired]: 0
      }
    };
    const currentTime = now();

    for (const booking of bookingRows) {
      const displayState = getBookingDisplayState({
        status: booking.status,
        lock_expired: booking.lock_expired,
        first_slot_start: booking.first_slot_start,
        last_slot_end: booking.last_slot_end
      }, currentTime);

      if (booking.status === 'CONFIRMED') {
        if (displayState.code === 'COMPLETED') summary.completed_count += 1;
        else summary.upcoming_count += 1;
      } else if (booking.status === 'COMPLETED') {
        summary.completed_count += 1;
      }

      const label = displayState.code === 'PENDING'
        ? SUMMARY_STATUS_LABELS.pending
        : displayState.code === 'UPCOMING' || displayState.code === 'IN_PROGRESS'
          ? SUMMARY_STATUS_LABELS.active
          : displayState.code === 'COMPLETED'
            ? SUMMARY_STATUS_LABELS.completed
            : displayState.code === 'CANCELLED'
              ? SUMMARY_STATUS_LABELS.cancelled
              : SUMMARY_STATUS_LABELS.expired;
      summary.counts_by_status[label] += 1;
    }
    return summary;
  }

  async function getBooking(user, rawBookingId) {
    const bookingId = normalizeBookingId(rawBookingId);
    const booking = await repository.findOwnedBookingById(bookingId, user.id);
    if (!booking) {
      throw createBookingError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy đơn đặt sân.');
    }
    const slots = (await repository.findOwnedBookingSlotsById(bookingId, user.id))
      .map(toHistorySlot);
    const displayState = getBookingDisplayState({
      status: booking.status,
      lock_expired: booking.lock_expired,
      slots
    }, now());
    return {
      booking_id: String(booking.id),
      booking_code: booking.booking_code,
      status: booking.status,
      display_status_code: displayState.code,
      display_status: displayState.label,
      created_at: booking.created_at,
      total_amount: String(booking.total_amount),
      facility_id: slots[0] ? slots[0].facility_id : null,
      court_id: slots[0] ? slots[0].court_id : null,
      sport_type: slots[0] ? slots[0].sport_type : null,
      payment: booking.payment_status === null ? null : {
        status: booking.payment_status,
        payment_option: booking.payment_option,
        amount_due: String(booking.amount_due),
        paid_amount: String(booking.paid_amount),
        refunded_amount: String(booking.refunded_amount)
      },
      deposit_amount: ((BigInt(String(booking.total_amount)) + 1n) / 2n).toString(),
      amount_due_at_venue: booking.payment_option === 'DEPOSIT_50'
        ? (BigInt(String(booking.total_amount))
          - ((BigInt(String(booking.total_amount)) + 1n) / 2n)).toString()
        : booking.payment_option === 'FULL' ? '0' : null,
      match_preference: parseMatchPreference(booking.match_preference),
      lock_expires_at: booking.lock_expires_at,
      remaining_seconds: booking.remaining_seconds === null
        ? null
        : asNumber(booking.remaining_seconds),
      slots
    };
  }

  async function getPendingBooking(user) {
    const pending = await repository.findActivePendingBookingByUser(user.id);
    if (!pending) return null;
    try {
      const booking = await getBooking(user, String(pending.id));
      return booking.display_status_code === 'EXPIRED'
        ? null
        : { ...booking, id: booking.booking_id };
    } catch (error) {
      if (error.status === 410) return null;
      throw error;
    }
  }

  async function getRefundPreview(userId, rawBookingId) {
    const bookingId = normalizeBookingId(rawBookingId);
    const booking = await repository.findOwnedBookingById(bookingId, userId);
    if (!booking) {
      throw createBookingError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy đơn đặt sân.');
    }
    if (booking.status !== 'CONFIRMED' && booking.status !== 'PENDING') {
      throw createBookingError(409, 'BOOKING_NOT_CANCELLABLE', 'Đơn đặt sân không còn có thể hủy.');
    }
    if (!booking.payment_status) {
      throw createBookingError(409, 'PAYMENT_NOT_FOUND', 'Không tìm thấy thông tin thanh toán của đơn.');
    }
    if ((booking.status === 'CONFIRMED' && booking.payment_status !== 'PAID')
        || (booking.status === 'PENDING' && booking.payment_status !== 'PENDING')) {
      throw createBookingError(409, 'PAYMENT_STATE_INVALID', 'Trạng thái thanh toán không phù hợp với đơn đặt sân.');
    }
    const slots = await repository.findOwnedBookingSlotsById(bookingId, userId);
    if (slots.length === 0) {
      throw createBookingError(409, 'BOOKING_SLOTS_CHANGED', 'Đơn đặt sân không còn khung giờ hợp lệ.');
    }
    const firstSlot = slots[0];
    const currentTime = now();
    const startAt = slotStartTimestamp(firstSlot);
    const endAt = slotEndTimestamp(slots[slots.length - 1]);
    if (booking.status === 'PENDING' && Number(booking.lock_expired) === 1) {
      throw createBookingError(409, 'BOOKING_EXPIRED', 'Đơn đặt sân đã hết hạn.');
    }
    if (booking.status === 'CONFIRMED'
        && (currentTime.getTime() >= startAt || currentTime.getTime() >= endAt)) {
      throw createBookingError(409, 'BOOKING_NOT_CANCELLABLE', 'Đơn đang diễn ra hoặc đã hoàn thành, không thể hủy.');
    }
    if (booking.status === 'PENDING') {
      return {
        refund_percent: 0,
        refund_amount: '0',
        paid_amount: String(booking.paid_amount || '0'),
        hours_until_start: Number(((startAt - currentTime.getTime()) / 3_600_000).toFixed(2)),
        seconds_until_start: Math.max(0, Math.floor((startAt - currentTime.getTime()) / 1000)),
        server_time: currentTime.toISOString(),
        message: REFUND_MESSAGES.unpaid
      };
    }
    return getCancellationRefund({
      firstSlot,
      paidAmount: String(booking.paid_amount),
      now: currentTime
    });
  }

  async function cancelBooking(userId, rawBookingId, body = {}) {
    const bookingId = normalizeBookingId(rawBookingId);
    const { cancellationReason, expectedRefund } = normalizeCancellationRequest(body);
    const result = await repository.withTransaction(async (connection) => {
      const booking = await repository.lockBooking(connection, bookingId);
      if (!booking || String(booking.user_id) !== String(userId)) {
        throw createBookingError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy đơn đặt sân.');
      }
      if (booking.status !== 'PENDING' && booking.status !== 'CONFIRMED') {
        throw createBookingError(409, 'BOOKING_NOT_CANCELLABLE', 'Đơn đã hủy, hết hạn hoặc hoàn thành nên không thể hủy.');
      }

      const payment = await repository.lockPaymentForBooking(connection, bookingId);
      if (!payment) {
        throw createBookingError(409, 'PAYMENT_NOT_FOUND', 'Không tìm thấy thông tin thanh toán của đơn.');
      }
      const slotIds = await repository.lockSlotsForBooking(connection, bookingId);
      const slots = await repository.lockTimeSlots(connection, slotIds);
      if (slots.length === 0 || slots.length !== slotIds.length) {
        throw createBookingError(409, 'BOOKING_SLOTS_CHANGED', 'Các khung giờ của đơn đã thay đổi.');
      }

      if (booking.status === 'PENDING' && Number(booking.lock_expired) === 1) {
        await repository.updateBookingStatus(connection, bookingId, 'EXPIRED');
        await repository.releaseBookingSlots(connection, bookingId);
        const notificationSlots = await repository.findNotificationSlots(connection, bookingId);
        await notifyHoldExpired(connection, { ...booking, slots: notificationSlots });
        return { expired: true };
      }
      const requiredSlotStatus = booking.status === 'PENDING' ? 'LOCKED' : 'BOOKED';
      if (slots.some((slot) => slot.status !== requiredSlotStatus
          || String(slot.current_booking_id) !== String(booking.id))) {
        throw createBookingError(409, 'BOOKING_SLOTS_CHANGED', 'Các khung giờ của đơn đã thay đổi.');
      }

      let refund = {
        refund_percent: 0,
        refund_amount: '0',
        paid_amount: String(payment.paid_amount || '0')
      };
      if (booking.status === 'CONFIRMED') {
        const currentTime = now();
        const firstSlot = [...slots].sort((left, right) => (
          left.service_date.localeCompare(right.service_date)
          || left.starts_at.localeCompare(right.starts_at)
        ))[0];
        const lastSlot = [...slots].sort((left, right) => (
          right.service_date.localeCompare(left.service_date)
          || right.ends_at.localeCompare(left.ends_at)
        ))[0];
        if (payment.status !== 'PAID') {
          throw createBookingError(409, 'PAYMENT_NOT_PAID', 'Đơn đã xác nhận nhưng thanh toán không hợp lệ.');
        }
        if (currentTime.getTime() >= slotStartTimestamp(firstSlot)
            || currentTime.getTime() >= slotEndTimestamp(lastSlot)) {
          throw createBookingError(409, 'BOOKING_NOT_CANCELLABLE', 'Đơn đang diễn ra hoặc đã hoàn thành, không thể hủy.');
        }
        refund = getCancellationRefund({
          firstSlot,
          paidAmount: String(payment.paid_amount),
          now: currentTime
        });
        if (expectedRefund && (expectedRefund.refund_amount !== refund.refund_amount
            || expectedRefund.refund_percent !== refund.refund_percent)) {
          throw createBookingError(
            409,
            'REFUND_PREVIEW_CHANGED',
            'Khoản hoàn đã thay đổi. Vui lòng kiểm tra và xác nhận lại.',
            { refund_preview: refund }
          );
        }
        await repository.refundPaymentForBooking(connection, payment.id, refund.refund_amount);
      }
      if (booking.status === 'PENDING' && payment.status !== 'PENDING') {
        throw createBookingError(409, 'PAYMENT_STATE_INVALID', 'Đơn chưa thanh toán có trạng thái thanh toán không hợp lệ.');
      }
      const updated = await repository.updateBookingCancellation(connection, {
        bookingId,
        cancellationReason
      });
      if (!updated) {
        throw createBookingError(409, 'BOOKING_NOT_CANCELLABLE', 'Đơn đặt sân đã thay đổi, vui lòng tải lại.');
      }
      await repository.releaseBookingSlots(connection, bookingId);
      if (booking.status === 'CONFIRMED') {
        await notifyUserCancellation(
          connection,
          { ...booking, slots },
          refund.refund_amount
        );
      }
      return {
        booking_id: String(booking.id),
        status: 'CANCELLED',
        refund_percent: refund.refund_percent,
        paid_amount: refund.paid_amount,
        refunded_amount: refund.refund_amount
      };
    });
    if (result.expired) {
      throw createBookingError(409, 'BOOKING_EXPIRED', 'Đơn đặt sân đã hết hạn.');
    }
    return result;
  }

  async function createPaymentAttempt(user, rawBookingId, body) {
    const bookingId = normalizeBookingId(rawBookingId);
    const input = normalizePaymentAttempt(body);
    let expired = false;
    try {
      const result = await repository.withTransaction(async (connection) => {
        const booking = await repository.lockBooking(connection, bookingId);
        if (!booking || (String(booking.user_id) !== String(user.id) && user.role !== 'ADMIN')) {
          throw createBookingError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy đơn đặt sân.');
        }
        if (String(booking.user_id) !== String(user.id)) {
          throw createBookingError(403, 'BOOKING_NOT_OWNED', 'Chỉ chủ đơn mới có thể thanh toán.');
        }
        if (booking.status === 'EXPIRED') {
          expired = true;
          return null;
        }
        if (booking.status !== 'PENDING') {
          throw createBookingError(409, 'BOOKING_NOT_PENDING', 'Chỉ có thể thanh toán đơn đang chờ thanh toán.');
        }

        const payment = await repository.lockPaymentForBooking(connection, bookingId);
        if (!payment) {
          throw createBookingError(409, 'PAYMENT_NOT_FOUND', 'Không tìm thấy thông tin thanh toán của đơn.');
        }
        const slotIds = await repository.lockSlotsForBooking(connection, bookingId);
        const slots = await repository.lockTimeSlots(connection, slotIds);
        if (slots.length !== slotIds.length) {
          throw createBookingError(409, 'BOOKING_SLOTS_CHANGED', 'Các khung giờ của đơn đã thay đổi.');
        }
        if (Number(booking.lock_expired) === 1 || !booking.lock_expires_at) {
          await repository.updateBookingStatus(connection, bookingId, 'EXPIRED');
          await repository.releaseBookingSlots(connection, bookingId);
          const notificationSlots = await repository.findNotificationSlots(connection, bookingId);
          await notifyHoldExpired(connection, { ...booking, slots: notificationSlots });
          expired = true;
          return null;
        }
        if (payment.status !== 'PENDING') {
          throw createBookingError(409, 'PAYMENT_NOT_PENDING', 'Khoản thanh toán không còn ở trạng thái chờ.');
        }

        const attempt = await repository.createPaymentAttempt(connection, {
          paymentId: payment.id,
          method: input.method,
          amount: payment.amount_due,
          result: input.simulationResult === 'SUCCESS' ? 'SUCCEEDED' : 'FAILED'
        });

        let ticket = null;
        if (input.simulationResult === 'SUCCESS') {
          await repository.markPaymentPaid(connection, payment.id, payment.amount_due);
          await repository.confirmBooking(connection, bookingId);
          const bookedSlots = await repository.bookSlotsForBooking(connection, bookingId);
          if (bookedSlots !== slotIds.length) {
            throw createBookingError(409, 'BOOKING_SLOTS_CHANGED', 'Không thể xác nhận tất cả khung giờ của đơn.');
          }
          await notifyPaymentSucceeded(
            connection,
            { ...booking, slots },
            { ...payment, paid_amount: payment.amount_due }
          );
          ticket = await repository.createBookingTicket(connection, bookingId);
        }

        return {
          attempt,
          payment: {
            status: input.simulationResult === 'SUCCESS' ? 'PAID' : 'PENDING',
            amount_due: String(payment.amount_due),
            paid_amount: input.simulationResult === 'SUCCESS' ? String(payment.amount_due) : '0'
          },
          booking: {
            id: String(booking.id),
            booking_code: booking.booking_code,
            status: input.simulationResult === 'SUCCESS' ? 'CONFIRMED' : 'PENDING',
            lock_expires_at: input.simulationResult === 'SUCCESS' ? null : booking.lock_expires_at
          },
          ticket
        };
      });
      if (expired) {
        throw createBookingError(410, 'BOOKING_EXPIRED', 'Thời gian giữ chỗ của đơn đã hết hạn.');
      }
      return result;
    } catch (error) {
      if (error.code === 'ER_LOCK_DEADLOCK' || error.code === 'ER_LOCK_WAIT_TIMEOUT') {
        throw createBookingError(409, 'BOOKING_CONFLICT', 'Thanh toán bị xung đột với một yêu cầu khác.');
      }
      throw error;
    }
  }

  async function getPayments(user, rawBookingId) {
    const bookingId = normalizeBookingId(rawBookingId);
    const booking = await repository.findBookingById(bookingId);
    if (!booking || (String(booking.user_id) !== String(user.id) && user.role !== 'ADMIN')) {
      throw createBookingError(404, 'BOOKING_NOT_FOUND', 'Không tìm thấy đơn đặt sân.');
    }
    return repository.findPaymentsByBookingId(bookingId);
  }

  async function releaseExpiredBookings(batchSize = 100) {
    const bookingIds = await repository.findExpiredBookingIds(batchSize);
    let released = 0;
    for (const bookingId of bookingIds) {
      const didRelease = await repository.expireBookingIfDue(bookingId);
      if (didRelease) {
        released += 1;
        console.log(`[Booking Expiry Job] Released booking ${bookingId}`);
      }
    }
    return released;
  }

  async function completeDueBookings(batchSize = 100) {
    const candidates = await repository.findConfirmedBookingsDueForCompletion(batchSize);
    let completed = 0;
    const currentTime = now();
    for (const booking of candidates) {
      const state = getBookingDisplayState({
        status: 'CONFIRMED',
        first_slot_start: booking.first_slot_start,
        last_slot_end: booking.last_slot_end
      }, currentTime);
      if (state.code === 'COMPLETED'
          && await repository.markBookingCompletedIfDue(booking.id)) {
        completed += 1;
      }
    }
    return completed;
  }

  return {
    createBooking,
    listBookings,
    getBookingSummary,
    getBooking,
    getPendingBooking,
    getRefundPreview,
    cancelBooking,
    createPaymentAttempt,
    getPayments,
    releaseExpiredBookings,
    completeDueBookings
  };
}

module.exports = {
  createBookingsService,
  createBookingWithUniqueCode,
  generateBookingCode,
  getBookingDisplayState
};
