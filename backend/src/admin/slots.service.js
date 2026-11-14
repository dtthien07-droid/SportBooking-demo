'use strict';

const { writeAudit } = require('./admin-audit');
const {
  insertMissingSlotsForCourt,
  localDateString,
  normalizedHours
} = require('../facilities/slot-generator');

const MAX_DATE_RANGE_DAYS = 31;
const UINT64_MAX = 18446744073709551615n;

function failure(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function parseId(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || BigInt(value) > UINT64_MAX) {
    throw failure(404, 'COURT_NOT_FOUND', 'Không tìm thấy sân.');
  }
  return value;
}

function parseDate(value, field) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw failure(400, 'INVALID_DATE', `${field} phải theo định dạng YYYY-MM-DD.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw failure(400, 'INVALID_DATE', `${field} không phải ngày hợp lệ.`);
  }
  return value;
}

function parseUpdatedAt(value) {
  if (typeof value !== 'string' || !value.endsWith('Z') || !Number.isFinite(Date.parse(value))) {
    throw failure(400, 'INVALID_INPUT', 'expected_updated_at phải là thời gian ISO UTC.');
  }
  return new Date(value);
}

function parsePrice(value, field) {
  if ((typeof value !== 'number' && typeof value !== 'string')
      || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))
      || BigInt(value) > 999999999999n) {
    throw failure(400, 'INVALID_INPUT', `${field} phải là số nguyên VND.`);
  }
  return String(value);
}

function formatTime(value) {
  return String(value).slice(0, 8);
}

function createAdminSlotsService(pool) {
  async function transaction(callback) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      const result = await callback(connection);
      await connection.commit();
      return result;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  async function lockCourt(connection, courtId) {
    const [referenceRows] = await connection.execute(
      'SELECT facility_id FROM courts WHERE id = ?',
      [courtId]
    );
    if (!referenceRows.length) throw failure(404, 'COURT_NOT_FOUND', 'Không tìm thấy sân.');
    const facilityId = String(referenceRows[0].facility_id);
    const [facilityRows] = await connection.execute(
      'SELECT id, is_active, opening_time, closing_time FROM facilities WHERE id = ? FOR UPDATE',
      [facilityId]
    );
    const [courtRows] = await connection.execute(
      `SELECT id, facility_id, price_normal, price_peak, is_active, updated_at
       FROM courts WHERE id = ? FOR UPDATE`,
      [courtId]
    );
    if (!facilityRows.length || !courtRows.length) {
      throw failure(404, 'COURT_NOT_FOUND', 'Không tìm thấy sân.');
    }
    return { court: courtRows[0], facility: facilityRows[0] };
  }

  return {
    async listTimeSlots(rawCourtId, rawDate, rawFromDate) {
      const courtId = parseId(rawCourtId);
      const serviceDate = parseDate(rawDate, 'date');
      const fromDate = rawFromDate === undefined
        ? localDateString()
        : parseDate(rawFromDate, 'from_date');
      const [courtRows] = await pool.execute(
        'SELECT id FROM courts WHERE id = ?',
        [courtId]
      );
      if (!courtRows.length) throw failure(404, 'COURT_NOT_FOUND', 'Không tìm thấy sân.');
      const [rows] = await pool.execute(
        `SELECT ts.id, ts.court_id, ts.service_date, ts.starts_at, ts.ends_at,
                ts.price, ts.status, ts.lock_expires_at, b.booking_code,
                CASE
                  WHEN ts.status = 'LOCKED'
                    AND (ts.lock_expires_at IS NULL OR ts.lock_expires_at <= UTC_TIMESTAMP(3))
                  THEN 'AVAILABLE'
                  ELSE ts.status
                END AS effective_status
         FROM time_slots AS ts
         LEFT JOIN bookings AS b ON b.id = ts.current_booking_id
         WHERE ts.court_id = ? AND ts.service_date = ?
         ORDER BY ts.starts_at ASC, ts.id ASC`,
        [courtId, serviceDate]
      );
      const [previewRows] = await pool.execute(
        `SELECT COUNT(*) AS available_count
         FROM time_slots
         WHERE court_id = ? AND service_date >= ? AND status = 'AVAILABLE'`,
        [courtId, fromDate]
      );
      return {
        court_id: courtId,
        service_date: serviceDate,
        price_preview: {
          from_date: fromDate,
          available_slots: Number(previewRows[0].available_count)
        },
        time_slots: rows.map((row) => ({
          id: String(row.id),
          court_id: String(row.court_id),
          service_date: serviceDate,
          starts_at: formatTime(row.starts_at),
          ends_at: formatTime(row.ends_at),
          price: String(row.price),
          status: row.effective_status,
          booking_code: row.effective_status === 'AVAILABLE' ? null : row.booking_code
        })),
        server_time: new Date().toISOString()
      };
    },

    async generateSlots(rawCourtId, input, adminUserId) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw failure(400, 'INVALID_INPUT', 'Khoảng ngày tạo khung giờ không hợp lệ.');
      }
      const courtId = parseId(rawCourtId);
      const fromDate = parseDate(input.from_date, 'from_date');
      const toDate = parseDate(input.to_date, 'to_date');
      const daysAhead = Math.round(
        (Date.parse(`${toDate}T00:00:00Z`) - Date.parse(`${fromDate}T00:00:00Z`))
        / (24 * 60 * 60 * 1000)
      ) + 1;
      if (daysAhead < 1 || daysAhead > MAX_DATE_RANGE_DAYS) {
        throw failure(400, 'INVALID_DATE_RANGE', 'Khoảng tạo khung giờ tối đa 31 ngày.');
      }
      return transaction(async (connection) => {
        const { court, facility } = await lockCourt(connection, courtId);
        if (!court.is_active || !facility.is_active) {
          throw failure(409, 'COURT_INACTIVE', 'Cơ sở hoặc sân đang ngừng hoạt động.');
        }
        const hours = normalizedHours(facility.opening_time, facility.closing_time);
        if (!hours) throw failure(409, 'INVALID_OPENING_HOURS', 'Giờ hoạt động của cơ sở chưa hợp lệ.');
        const summary = await insertMissingSlotsForCourt(connection, {
          courtId,
          firstDate: fromDate,
          daysAhead,
          ...hours,
          priceNormal: Number(court.price_normal),
          pricePeak: Number(court.price_peak)
        });
        await writeAudit(connection, {
          adminUserId,
          action: 'SLOTS_GENERATE',
          resourceType: 'court',
          resourceId: courtId,
          details: {
            from_date: fromDate,
            to_date: toDate,
            inserted: summary.inserted,
            existing: summary.existing
          }
        });
        return { court_id: courtId, from_date: fromDate, to_date: toDate, ...summary };
      });
    },

    async updatePrices(rawCourtId, input, adminUserId) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw failure(400, 'INVALID_INPUT', 'Thông tin giá không hợp lệ.');
      }
      const courtId = parseId(rawCourtId);
      const expected = parseUpdatedAt(input.expected_updated_at);
      const normal = parsePrice(input.price_normal, 'Giá thường');
      const peak = parsePrice(input.price_peak, 'Giá giờ vàng');
      if (BigInt(peak) < BigInt(normal)) {
        throw failure(400, 'INVALID_INPUT', 'Giá giờ vàng phải lớn hơn hoặc bằng giá thường.');
      }
      return transaction(async (connection) => {
        const { court } = await lockCourt(connection, courtId);
        if (new Date(court.updated_at).getTime() !== expected.getTime()) {
          throw failure(409, 'ADMIN_STALE_DATA', 'Dữ liệu vừa được người khác thay đổi, hãy tải lại');
        }
        await connection.execute(
          `UPDATE courts
           SET price_normal = ?, price_peak = ?, is_seed = FALSE,
               updated_at = GREATEST(UTC_TIMESTAMP(3), TIMESTAMPADD(MICROSECOND, 1000, updated_at))
           WHERE id = ?`,
          [normal, peak, courtId]
        );
        const today = localDateString();
        const [result] = await connection.execute(
          `UPDATE time_slots
           SET price = CASE
                 WHEN TIME(starts_at) >= '17:00:00' AND TIME(starts_at) < '21:00:00'
                 THEN ? ELSE ? END,
               updated_at = UTC_TIMESTAMP(3)
           WHERE court_id = ? AND service_date >= ? AND status = 'AVAILABLE'
             AND price <> CASE
               WHEN TIME(starts_at) >= '17:00:00' AND TIME(starts_at) < '21:00:00'
               THEN ? ELSE ? END`,
          [peak, normal, courtId, today, peak, normal]
        );
        const affectedSlots = Number(result.affectedRows);
        await writeAudit(connection, {
          adminUserId,
          action: 'COURT_PRICES_UPDATE',
          resourceType: 'court',
          resourceId: courtId,
          details: { price_normal: normal, price_peak: peak, affected_slots: affectedSlots }
        });
        return { court_id: courtId, affected_slots: affectedSlots };
      });
    }
  };
}

module.exports = { createAdminSlotsService };
