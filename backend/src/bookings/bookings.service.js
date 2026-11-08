'use strict';

const crypto = require('node:crypto');

function createBookingError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function normalizeSlotIds(slotIds) {
  if (!Array.isArray(slotIds) || slotIds.length === 0) {
    throw createBookingError(400, 'INVALID_SLOT_IDS', 'slot_ids must be a non-empty array.');
  }

  const ids = slotIds.map((id) => {
    const value = typeof id === 'number' && Number.isSafeInteger(id) ? String(id) : id;
    if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
      throw createBookingError(400, 'INVALID_SLOT_IDS', 'Each slot ID must be a positive integer.');
    }
    if (BigInt(value) > 18446744073709551615n) {
      throw createBookingError(400, 'INVALID_SLOT_IDS', 'A slot ID is out of range.');
    }
    return value;
  });

  if (new Set(ids).size !== ids.length) {
    throw createBookingError(400, 'INVALID_SLOT_IDS', 'slot_ids must not contain duplicates.');
  }
  return ids;
}

function normalizeBookingId(id) {
  if (typeof id !== 'string' || !/^[1-9]\d*$/.test(id)
      || BigInt(id) > 18446744073709551615n) {
    throw createBookingError(400, 'INVALID_BOOKING_ID', 'The booking ID is invalid.');
  }
  return id;
}

function asNumber(value) {
  return Number(value);
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

function createBookingsService(repository) {
  if (!repository || typeof repository.withTransaction !== 'function') {
    throw new TypeError('A compatible bookings repository is required.');
  }

  async function createBooking(userId, body) {
    const slotIds = normalizeSlotIds(body && body.slot_ids);
    try {
      return await repository.withTransaction(async (connection) => {
        const user = await repository.lockUser(connection, userId);
        if (!user) {
          throw createBookingError(401, 'UNAUTHENTICATED', 'Authentication is required.');
        }
        if (await repository.findPendingBookingForUser(connection, userId)) {
          throw createBookingError(409, 'PENDING_BOOKING_EXISTS', 'You already have an active booking.');
        }

        const initialSlots = await repository.findRequestedSlotStates(connection, slotIds);
        if (initialSlots.length !== slotIds.length) {
          throw createBookingError(404, 'SLOT_NOT_FOUND', 'One or more time slots were not found.');
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
          throw createBookingError(409, 'SLOT_CHANGED', 'A time slot changed while booking.');
        }
        const lockedById = new Map(lockedSlots.map((slot) => [String(slot.id), slot]));
        const requestedSlots = slotIds.map((id) => lockedById.get(id));
        if (requestedSlots.some((slot) => !slot)) {
          throw createBookingError(404, 'SLOT_NOT_FOUND', 'One or more time slots were not found.');
        }

        for (const oldBookingId of uniqueExpiredBookingIds) {
          const booking = oldBookingById.get(oldBookingId);
          if (!booking || (booking.status === 'PENDING' && Number(booking.lock_expired) !== 1)) {
            throw createBookingError(409, 'SLOT_CHANGED', 'An expired slot is still held by a booking.');
          }
          await repository.expireStaleBooking(connection, oldBookingId);
        }

        for (const slot of requestedSlots) {
          if ((slot.court_is_active !== 1 && slot.court_is_active !== true)
              || (slot.facility_is_active !== 1 && slot.facility_is_active !== true)) {
            throw createBookingError(409, 'SLOT_UNAVAILABLE', 'The court is not available.');
          }
          const expiredLock = slot.status === 'LOCKED' && Number(slot.lock_expired) === 1;
          if (slot.status !== 'AVAILABLE' && !expiredLock) {
            throw createBookingError(409, 'SLOT_UNAVAILABLE', 'One or more time slots are unavailable.');
          }
          if (slot.status === 'LOCKED' && slot.current_booking_id !== null
              && !uniqueExpiredBookingIds.includes(String(slot.current_booking_id))) {
            throw createBookingError(409, 'SLOT_CHANGED', 'A time slot changed while booking.');
          }
          if (Number(slot.starts_in_time) !== 1) {
            throw createBookingError(400, 'SLOT_TOO_SOON', 'Slots must start at least 15 minutes from now.');
          }
        }

        const chronologicalSlots = [...requestedSlots].sort((left, right) => (
          left.starts_at.localeCompare(right.starts_at)
          || (BigInt(left.id) < BigInt(right.id) ? -1 : 1)
        ));
        const firstSlot = chronologicalSlots[0];
        for (let index = 1; index < chronologicalSlots.length; index += 1) {
          const previous = chronologicalSlots[index - 1];
          const current = chronologicalSlots[index];
          if (String(current.court_id) !== String(firstSlot.court_id)
              || String(previous.service_date) !== String(current.service_date)
              || previous.ends_at !== current.starts_at) {
            throw createBookingError(400, 'SLOTS_NOT_CONTIGUOUS', 'Slots must be consecutive on one court and date.');
          }
        }

        const totalAmount = chronologicalSlots.reduce(
          (total, slot) => total + BigInt(String(slot.price)),
          0n
        ).toString();
        const bookingCode = `SPB-${crypto.randomBytes(16).toString('hex').toUpperCase()}`;
        const lockExpiresAt = await repository.createHoldDeadline(connection);
        const bookingId = await repository.createBooking(connection, {
          bookingCode,
          userId,
          totalAmount,
          expiresAt: lockExpiresAt
        });
        await repository.createBookingSlots(connection, bookingId, chronologicalSlots);
        const affectedRows = await repository.lockTimeSlotsForBooking(
          connection,
          slotIds,
          bookingId,
          lockExpiresAt
        );
        if (affectedRows !== slotIds.length) {
          throw createBookingError(409, 'SLOT_UNAVAILABLE', 'One or more time slots are unavailable.');
        }

        return {
          booking_id: String(bookingId),
          booking_code: bookingCode,
          status: 'PENDING',
          total_amount: totalAmount,
          lock_expires_at: lockExpiresAt,
          remaining_seconds: 600,
          slots: chronologicalSlots.map(toSlotResponse)
        };
      });
    } catch (error) {
      if (error.code === 'ER_LOCK_DEADLOCK' || error.code === 'ER_LOCK_WAIT_TIMEOUT') {
        throw createBookingError(409, 'BOOKING_CONFLICT', 'The booking conflicted with another request.');
      }
      throw error;
    }
  }

  async function getBooking(user, rawBookingId) {
    const bookingId = normalizeBookingId(rawBookingId);
    const booking = await repository.findBookingById(bookingId);
    if (!booking || (String(booking.user_id) !== String(user.id) && user.role !== 'ADMIN')) {
      throw createBookingError(404, 'BOOKING_NOT_FOUND', 'The booking was not found.');
    }
    if (booking.status === 'EXPIRED'
        || booking.status === 'PENDING'
          && (booking.lock_expires_at === null || Number(booking.lock_expired) === 1)) {
      throw createBookingError(410, 'BOOKING_EXPIRED', 'The booking hold has expired.');
    }
    const slots = await repository.findBookingSlotsById(bookingId);
    return {
      booking_id: String(booking.id),
      booking_code: booking.booking_code,
      status: booking.status,
      total_amount: String(booking.total_amount),
      lock_expires_at: booking.lock_expires_at,
      remaining_seconds: booking.remaining_seconds === null
        ? null
        : asNumber(booking.remaining_seconds),
      slots: slots.map((slot) => ({
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
      }))
    };
  }

  async function cancelBooking(userId, rawBookingId) {
    const bookingId = normalizeBookingId(rawBookingId);
    const result = await repository.withTransaction(async (connection) => {
      const booking = await repository.lockBooking(connection, bookingId);
      if (!booking || String(booking.user_id) !== String(userId)) {
        throw createBookingError(404, 'BOOKING_NOT_FOUND', 'The booking was not found.');
      }
      if (booking.status !== 'PENDING') {
        throw createBookingError(409, 'BOOKING_NOT_PENDING', 'Only a pending booking can be cancelled.');
      }

      const slotIds = await repository.lockSlotsForBooking(connection, bookingId);
      await repository.lockTimeSlots(connection, slotIds);
      const expired = Number(booking.lock_expired) === 1;
      const status = expired ? 'EXPIRED' : 'CANCELLED';
      await repository.updateBookingStatus(connection, bookingId, status);
      await repository.releaseBookingSlots(connection, bookingId);
      return expired
        ? { expired: true }
        : { booking_id: String(booking.id), status };
    });
    if (result.expired) {
      throw createBookingError(410, 'BOOKING_EXPIRED', 'The booking hold has expired.');
    }
    return result;
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

  return { createBooking, getBooking, cancelBooking, releaseExpiredBookings };
}

module.exports = { createBookingsService };
