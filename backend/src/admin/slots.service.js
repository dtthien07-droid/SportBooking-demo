'use strict';

const { writeAudit } = require('./admin-audit');
const { createTimeSlotsExport } = require('./bookings-export');
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
      || Number(value) < 1000 || Number(value) > 10000000) {
    throw failure(400, 'INVALID_INPUT', `${field} phải là số nguyên từ 1.000 đến 10.000.000 VND.`);
  }
  return String(value);
}

function getDateRange(fromValue, toValue) {
  const from = parseDate(fromValue, 'from');
  const to = parseDate(toValue, 'to');
  const days = Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`))
    / (24 * 60 * 60 * 1000)
  ) + 1;
  if (days < 1 || days > MAX_DATE_RANGE_DAYS) {
    throw failure(400, 'INVALID_DATE_RANGE', 'Khoảng xem khung giờ tối đa 31 ngày.');
  }
  return { from, to };
}

function formatTime(value) {
  return value == null ? '' : String(value).slice(0, 8);
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
    async listTimeSlots(rawCourtId, rawDate, rawFromDate, rawFrom, rawTo) {
      const courtId = parseId(rawCourtId);
      let from;
      let to;
      let fromDate;
      if (rawFrom !== undefined || rawTo !== undefined) {
        if (rawFrom === undefined || rawTo === undefined) {
          throw failure(400, 'INVALID_DATE_RANGE', 'Cần truyền đủ from và to.');
        }
        const range = getDateRange(rawFrom, rawTo);
        from = range.from;
        to = range.to;
        fromDate = localDateString();
      } else {
        const serviceDate = parseDate(rawDate, 'date');
        from = serviceDate;
        to = serviceDate;
        fromDate = rawFromDate === undefined
          ? localDateString()
          : parseDate(rawFromDate, 'from_date');
      }
      const [courtRows] = await pool.execute(
        `SELECT c.id, f.opening_time, f.closing_time
         FROM courts AS c
         INNER JOIN facilities AS f ON f.id = c.facility_id
         WHERE c.id = ?`,
        [courtId]
      );
      if (!courtRows.length) throw failure(404, 'COURT_NOT_FOUND', 'Không tìm thấy sân.');
      const [rows] = await pool.execute(
        `SELECT ts.id, ts.court_id, ts.service_date, ts.starts_at, ts.ends_at,
                ts.price, ts.status, ts.lock_expires_at, b.booking_code,
                DATE_FORMAT(ts.service_date, '%Y-%m-%d') AS slot_date,
                CASE
                  WHEN ts.status = 'LOCKED'
                    AND (ts.lock_expires_at IS NULL OR ts.lock_expires_at <= UTC_TIMESTAMP(3))
                  THEN 'AVAILABLE'
                  ELSE ts.status
                END AS effective_status
         FROM time_slots AS ts
         LEFT JOIN bookings AS b ON b.id = ts.current_booking_id
         WHERE ts.court_id = ? AND ts.service_date >= ? AND ts.service_date <= ?
         ORDER BY ts.service_date ASC, ts.starts_at ASC, ts.id ASC`,
        [courtId, from, to]
      );
      const [previewRows] = await pool.execute(
        `SELECT COUNT(*) AS available_count
         FROM time_slots
         WHERE court_id = ? AND service_date >= ? AND status = 'AVAILABLE'`,
        [courtId, fromDate]
      );
      const openingTime = formatTime(courtRows[0].opening_time);
      const closingTime = formatTime(courtRows[0].closing_time);
      return {
        court_id: courtId,
        ...(from === to ? { service_date: from } : {}),
        from_date: from,
        to_date: to,
        opening_time: openingTime,
        closing_time: closingTime,
        price_preview: {
          from_date: fromDate,
          available_slots: Number(previewRows[0].available_count)
        },
        time_slots: rows.filter((row) => (
          formatTime(row.starts_at) >= openingTime && formatTime(row.ends_at) <= closingTime
        )).map((row) => ({
          id: String(row.id),
          court_id: String(row.court_id),
          service_date: row.slot_date,
          starts_at: formatTime(row.starts_at),
          ends_at: formatTime(row.ends_at),
          price: String(row.price),
          status: row.effective_status,
          booking_code: row.effective_status === 'AVAILABLE' ? null : row.booking_code
        })),
        server_time: new Date().toISOString()
      };
    },

    async exportTimeSlots(rawCourtId, rawFrom, rawTo, adminUserId) {
      const courtId = parseId(rawCourtId);
      const { from, to } = getDateRange(rawFrom, rawTo);
      const parsedLimit = Number.parseInt(5001, 10);
      const safeLimit = Number.isSafeInteger(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 5001)
        : 5001;
      const [courtRows] = await pool.execute(
        `SELECT c.id, c.name, c.price_normal, c.price_peak, f.name AS facility_name
         FROM courts AS c
         INNER JOIN facilities AS f ON f.id = c.facility_id
         WHERE c.id = ?`,
        [courtId]
      );
      if (!courtRows.length) throw failure(404, 'COURT_NOT_FOUND', 'Không tìm thấy sân.');
      const [rows] = await pool.execute(
        `SELECT DATE_FORMAT(ts.service_date, '%Y-%m-%d') AS service_date,
                TIME_FORMAT(ts.starts_at, '%H:%i:%s') AS starts_at,
                TIME_FORMAT(ts.ends_at, '%H:%i:%s') AS ends_at,
                ts.price,
                CASE
                  WHEN ts.status = 'LOCKED'
                    AND (ts.lock_expires_at IS NULL OR ts.lock_expires_at <= UTC_TIMESTAMP(3))
                  THEN 'AVAILABLE'
                  ELSE ts.status
                END AS effective_status
         FROM time_slots AS ts
         WHERE ts.court_id = ? AND ts.service_date >= ? AND ts.service_date <= ?
         ORDER BY ts.service_date ASC, ts.starts_at ASC, ts.id ASC
         LIMIT ${safeLimit}`,
        [courtId, from, to]
      );
      if (rows.length > 5000) {
        throw failure(400, 'EXPORT_TOO_MANY_ROWS', 'Quá nhiều dòng, hãy lọc thu hẹp');
      }
      const exported = await createTimeSlotsExport({
        court: courtRows[0],
        slots: rows.map((row) => ({ ...row, status: row.effective_status })),
        from,
        to
      });
      await transaction((connection) => writeAudit(connection, {
        adminUserId,
        action: 'EXPORT_TIME_SLOTS',
        resourceType: 'time_slots_export',
        resourceId: courtId,
        details: {
          filters: { court_id: courtId, from, to },
          row_count: rows.length
        }
      }));
      return exported;
    },

    async getMonthlySummary(rawCourtId, rawMonth) {
      const courtId = parseId(rawCourtId);
      if (typeof rawMonth !== 'string' || !/^\d{4}-\d{2}$/.test(rawMonth)) {
        throw failure(400, 'INVALID_MONTH', 'month phải theo định dạng YYYY-MM.');
      }
      const monthStart = new Date(`${rawMonth}-01T00:00:00.000Z`);
      if (!Number.isFinite(monthStart.getTime())
          || monthStart.toISOString().slice(0, 7) !== rawMonth) {
        throw failure(400, 'INVALID_MONTH', 'month không phải tháng hợp lệ.');
      }
      const nextMonth = new Date(Date.UTC(
        monthStart.getUTCFullYear(),
        monthStart.getUTCMonth() + 1,
        1
      ));
      const from = `${rawMonth}-01`;
      const to = new Date(nextMonth.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const [courtRows] = await pool.execute(
        `SELECT c.id, f.opening_time, f.closing_time
         FROM courts AS c
         INNER JOIN facilities AS f ON f.id = c.facility_id
         WHERE c.id = ?`,
        [courtId]
      );
      if (!courtRows.length) throw failure(404, 'COURT_NOT_FOUND', 'Không tìm thấy sân.');
      const [rows] = await pool.execute(
        `SELECT DATE_FORMAT(ts.service_date, '%Y-%m-%d') AS service_date,
                COUNT(*) AS total,
                COALESCE(SUM(CASE WHEN ts.status = 'BOOKED' THEN 1 ELSE 0 END), 0) AS booked,
                COALESCE(SUM(CASE
                  WHEN ts.status = 'LOCKED' AND ts.lock_expires_at > UTC_TIMESTAMP(3)
                  THEN 1 ELSE 0 END), 0) AS held,
                COALESCE(SUM(CASE
                  WHEN ts.status = 'AVAILABLE'
                    OR ts.status = 'LOCKED'
                      AND (ts.lock_expires_at IS NULL OR ts.lock_expires_at <= UTC_TIMESTAMP(3))
                  THEN 1 ELSE 0 END), 0) AS available,
                COALESCE(SUM(CASE
                  WHEN TIME(ts.starts_at) < '17:00:00' OR TIME(ts.starts_at) >= '21:00:00'
                  THEN 1 ELSE 0 END), 0) AS normal_total,
                COALESCE(SUM(CASE
                  WHEN TIME(ts.starts_at) >= '17:00:00' AND TIME(ts.starts_at) < '21:00:00'
                  THEN 1 ELSE 0 END), 0) AS peak_total,
                COALESCE(SUM(CASE
                  WHEN (ts.status = 'BOOKED'
                    OR ts.status = 'LOCKED' AND ts.lock_expires_at > UTC_TIMESTAMP(3))
                    AND (TIME(ts.starts_at) < '17:00:00' OR TIME(ts.starts_at) >= '21:00:00')
                  THEN 1 ELSE 0 END), 0) AS normal_occupied,
                COALESCE(SUM(CASE
                  WHEN (ts.status = 'BOOKED'
                    OR ts.status = 'LOCKED' AND ts.lock_expires_at > UTC_TIMESTAMP(3))
                    AND TIME(ts.starts_at) >= '17:00:00' AND TIME(ts.starts_at) < '21:00:00'
                  THEN 1 ELSE 0 END), 0) AS peak_occupied,
                COALESCE(SUM(ts.price), 0) AS expected_revenue
         FROM time_slots AS ts
         INNER JOIN courts AS c ON c.id = ts.court_id
         INNER JOIN facilities AS f ON f.id = c.facility_id
         WHERE ts.court_id = ? AND ts.service_date >= ? AND ts.service_date <= ?
           AND TIME_TO_SEC(ts.starts_at) >= TIME_TO_SEC(f.opening_time)
           AND TIME_TO_SEC(ts.ends_at) <= TIME_TO_SEC(f.closing_time)
         GROUP BY ts.service_date
         ORDER BY ts.service_date ASC`,
        [courtId, from, to]
      );
      const summaries = new Map(rows.map((row) => [row.service_date, {
        total: Number(row.total),
        booked: Number(row.booked),
        held: Number(row.held),
        available: Number(row.available),
        normal_total: Number(row.normal_total),
        peak_total: Number(row.peak_total),
        normal_occupied: Number(row.normal_occupied),
        peak_occupied: Number(row.peak_occupied),
        expected_revenue: String(row.expected_revenue)
      }]));
      const days = [];
      for (let day = new Date(`${from}T00:00:00.000Z`);
        day.toISOString().slice(0, 10) <= to;
        day.setUTCDate(day.getUTCDate() + 1)) {
        const date = day.toISOString().slice(0, 10);
        days.push({
          date,
          ...(summaries.get(date) || {
            total: 0,
            booked: 0,
            held: 0,
            available: 0,
            normal_total: 0,
            peak_total: 0,
            normal_occupied: 0,
            peak_occupied: 0,
            expected_revenue: '0'
          })
        });
      }
      return { court_id: courtId, month: rawMonth, days, server_time: new Date().toISOString() };
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

    async updatePrices(rawCourtId, input, adminUserId, { dryRun = false } = {}) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw failure(400, 'INVALID_INPUT', 'Thông tin giá không hợp lệ.');
      }
      const allowedKeys = new Set([
        'price_normal',
        'price_peak',
        'expected_updated_at',
        'dry_run'
      ]);
      if (Object.keys(input).some((key) => !allowedKeys.has(key))
          || input.dry_run !== undefined && typeof input.dry_run !== 'boolean') {
        throw failure(400, 'INVALID_INPUT', 'Thông tin giá không hợp lệ.');
      }
      const courtId = parseId(rawCourtId);
      const expected = parseUpdatedAt(input.expected_updated_at);
      const hasNormal = Object.hasOwn(input, 'price_normal');
      const hasPeak = Object.hasOwn(input, 'price_peak');
      if (!hasNormal && !hasPeak) {
        throw failure(400, 'INVALID_INPUT', 'Cần nhập ít nhất một đơn giá.');
      }
      const nextNormal = hasNormal ? parsePrice(input.price_normal, 'Giá thường') : null;
      const nextPeak = hasPeak ? parsePrice(input.price_peak, 'Giá giờ vàng') : null;
      const previewOnly = dryRun || input.dry_run === true;
      return transaction(async (connection) => {
        const { court, facility } = await lockCourt(connection, courtId);
        if (new Date(court.updated_at).getTime() !== expected.getTime()) {
          throw failure(409, 'ADMIN_STALE_DATA', 'Dữ liệu vừa được người khác thay đổi, hãy tải lại');
        }
        const normal = nextNormal || String(court.price_normal);
        const peak = nextPeak || String(court.price_peak);
        if (BigInt(peak) < BigInt(normal)) {
          throw failure(400, 'INVALID_INPUT', 'Giá giờ cao điểm phải lớn hơn hoặc bằng giá thường.');
        }
        const today = localDateString();
        const [previewRows] = await connection.execute(
          `SELECT COUNT(*) AS affected_slots
           FROM time_slots
           WHERE court_id = ? AND service_date >= ? AND status = 'AVAILABLE'
             AND TIME_TO_SEC(starts_at) >= TIME_TO_SEC(?)
             AND TIME_TO_SEC(ends_at) <= TIME_TO_SEC(?)
             AND price <> CASE
               WHEN TIME(starts_at) >= '17:00:00' AND TIME(starts_at) < '21:00:00'
               THEN ? ELSE ? END`,
          [courtId, today, facility.opening_time, facility.closing_time, peak, normal]
        );
        const affectedSlots = Number(previewRows[0].affected_slots);
        if (previewOnly) {
          return {
            court_id: courtId,
            dry_run: true,
            affected_slots: affectedSlots
          };
        }
        await connection.execute(
          `UPDATE courts
           SET price_normal = ?, price_peak = ?, is_seed = FALSE,
               updated_at = GREATEST(UTC_TIMESTAMP(3), TIMESTAMPADD(MICROSECOND, 1000, updated_at))
           WHERE id = ?`,
          [normal, peak, courtId]
        );
        const [result] = await connection.execute(
          `UPDATE time_slots
           SET price = CASE
                 WHEN TIME(starts_at) >= '17:00:00' AND TIME(starts_at) < '21:00:00'
                 THEN ? ELSE ? END,
               updated_at = UTC_TIMESTAMP(3)
           WHERE court_id = ? AND service_date >= ? AND status = 'AVAILABLE'
             AND TIME_TO_SEC(starts_at) >= TIME_TO_SEC(?)
             AND TIME_TO_SEC(ends_at) <= TIME_TO_SEC(?)
             AND price <> CASE
               WHEN TIME(starts_at) >= '17:00:00' AND TIME(starts_at) < '21:00:00'
               THEN ? ELSE ? END`,
          [
            peak,
            normal,
            courtId,
            today,
            facility.opening_time,
            facility.closing_time,
            peak,
            normal
          ]
        );
        await writeAudit(connection, {
          adminUserId,
          action: 'COURT_PRICES_UPDATE',
          resourceType: 'court',
          resourceId: courtId,
          details: {
            price_normal: normal,
            price_peak: peak,
            affected_slots: Number(result.affectedRows)
          }
        });
        return {
          court_id: courtId,
          price_normal: normal,
          price_peak: peak,
          dry_run: false,
          affected_slots: Number(result.affectedRows)
        };
      });
    }
  };
}

module.exports = { createAdminSlotsService };
