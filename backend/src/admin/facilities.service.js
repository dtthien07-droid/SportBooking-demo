'use strict';

const { writeAudit } = require('./admin-audit');
const { createFacilitiesExport } = require('./bookings-export');
const {
  insertMissingSlotsForCourt,
  localDateString,
  normalizedHours,
  readSlotDaysAhead
} = require('../facilities/slot-generator');

const SPORTS = new Set(['FOOTBALL_MINI', 'BADMINTON', 'PICKLEBALL']);
const UINT64_MAX = 18446744073709551615n;
const MAX_PAGE_SIZE = 50;

function failure(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

function positiveId(value, resource) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || BigInt(value) > UINT64_MAX) {
    throw failure(404, `${resource.toUpperCase()}_NOT_FOUND`, `Không tìm thấy ${resource === 'court' ? 'sân' : 'cơ sở'}.`);
  }
  return value;
}

function isoUtc(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error('Dữ liệu thời gian cơ sở không hợp lệ.');
  return date.toISOString();
}

function parsePage(value, fallback, field) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw failure(400, 'INVALID_QUERY', `${field} phải là số nguyên dương.`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > Number.MAX_SAFE_INTEGER) {
    throw failure(400, 'INVALID_QUERY', `${field} nằm ngoài phạm vi cho phép.`);
  }
  return number;
}

function text(value, field, min, max) {
  if (typeof value !== 'string') throw failure(400, 'INVALID_INPUT', `${field} là bắt buộc.`);
  const result = value.trim().replace(/\s+/g, ' ');
  if (result.length < min || result.length > max) {
    throw failure(400, 'INVALID_INPUT', `${field} phải có từ ${min} đến ${max} ký tự.`);
  }
  return result;
}

function requireObjectInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw failure(400, 'INVALID_INPUT', 'Thông tin gửi lên không hợp lệ.');
  }
}

function optionalUrl(value, field) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || !(value.startsWith('/assets/') || /^https:\/\//i.test(value))) {
    throw failure(400, 'INVALID_INPUT', `${field} chỉ nhận URL HTTPS hoặc đường dẫn /assets/.`);
  }
  return value.trim();
}

function time(value, field, allowEndOfDay = false) {
  const endOfDay = allowEndOfDay && (value === '24:00' || value === '24:00:00');
  const valid = typeof value === 'string'
    && (/^(?:[01]\d|2[0-3]):00(?::00)?$/.test(value) || endOfDay);
  if (!valid) {
    const fieldName = field === 'Giờ mở cửa' ? 'opening_time' : 'closing_time';
    throw failure(400, 'INVALID_OPENING_HOURS',
      `${field} phải là giờ tròn, phút bằng 00${allowEndOfDay ? ' hoặc 24:00' : ''}.`,
      { field: fieldName });
  }
  return endOfDay ? '24:00' : value.length === 5 ? `${value}:00` : value;
}

function price(value, field) {
  if ((typeof value !== 'number' && typeof value !== 'string')
      || !/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value))
      || BigInt(value) > 999999999999n) {
    throw failure(400, 'INVALID_INPUT', `${field} phải là số nguyên VND.`);
  }
  return String(value);
}

function parseActive(value) {
  if (value === undefined || value === '') return null;
  if (value === 'true' || value === '1') return 1;
  if (value === 'false' || value === '0') return 0;
  throw failure(400, 'INVALID_QUERY', 'is_active phải là true hoặc false.');
}

function parseUpdatedAt(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))
      || !value.endsWith('Z')) {
    throw failure(400, 'INVALID_INPUT', 'expected_updated_at phải là thời gian ISO UTC.');
  }
  return new Date(value);
}

function validateFacility(input, { allowMissingHours = false } = {}) {
  requireObjectInput(input);
  if (input.is_active !== undefined && typeof input.is_active !== 'boolean') {
    throw failure(400, 'INVALID_INPUT', 'is_active phải là giá trị boolean.');
  }
  const missingHours = input.opening_time == null && input.closing_time == null;
  if (missingHours && !allowMissingHours) {
    throw failure(400, 'INVALID_INPUT', 'Giờ mở cửa và giờ đóng cửa là bắt buộc.');
  }
  const opening = missingHours ? null : time(input.opening_time, 'Giờ mở cửa');
  const closing = missingHours ? null : time(input.closing_time, 'Giờ đóng cửa', true);
  if (!missingHours) {
    const openingMinutes = Number(opening.slice(0, 2)) * 60 + Number(opening.slice(3, 5));
    const closingMinutes = closing === '24:00' ? 1440
      : Number(closing.slice(0, 2)) * 60 + Number(closing.slice(3, 5));
    if (openingMinutes >= closingMinutes) {
      throw failure(400, 'INVALID_OPENING_HOURS', 'Giờ mở cửa phải nhỏ hơn giờ đóng cửa.',
        { field: 'closing_time' });
    }
  }
  if (typeof input.amenities !== 'undefined'
      && (!Array.isArray(input.amenities) || input.amenities.length > 20
        || input.amenities.some((value) => typeof value !== 'string' || value.trim().length > 100))) {
    throw failure(400, 'INVALID_INPUT', 'Tiện ích phải là mảng tối đa 20 chuỗi.');
  }
  if (input.hotline !== undefined && input.hotline !== null && input.hotline !== ''
      && (typeof input.hotline !== 'string' || !/^\+?[\d ()-]{8,20}$/.test(input.hotline))) {
    throw failure(400, 'INVALID_INPUT', 'Hotline không đúng định dạng.');
  }
  return {
    name: text(input.name, 'Tên cơ sở', 2, 160),
    address: text(input.address, 'Địa chỉ', 2, 500),
    district: text(input.district, 'Quận/huyện', 2, 120),
    opening_time: opening,
    closing_time: closing,
    hotline: input.hotline ? input.hotline.trim() : null,
    map_url: optionalUrl(input.map_url, 'Bản đồ'),
    image_url: optionalUrl(input.image_url, 'Ảnh'),
    amenities: JSON.stringify(input.amenities || []),
    description: typeof input.description === 'string' ? input.description.trim().slice(0, 5000) : null,
    rules: typeof input.rules === 'string' ? input.rules.trim().slice(0, 5000) : null,
    cancellation_policy: typeof input.cancellation_policy === 'string'
      ? input.cancellation_policy.trim().slice(0, 5000) : null,
    is_active: input.is_active === undefined ? 1 : input.is_active ? 1 : 0
  };
}

function validateCourt(input) {
  requireObjectInput(input);
  if (input.is_active !== undefined && typeof input.is_active !== 'boolean') {
    throw failure(400, 'INVALID_INPUT', 'is_active phải là giá trị boolean.');
  }
  if (!SPORTS.has(input.sport_type)) {
    throw failure(400, 'INVALID_INPUT', 'Môn thể thao không được hỗ trợ.');
  }
  const normal = price(input.price_normal, 'Giá thường');
  const peak = price(input.price_peak, 'Giá giờ vàng');
  if (BigInt(peak) < BigInt(normal)) {
    throw failure(400, 'INVALID_INPUT', 'Giá giờ vàng phải lớn hơn hoặc bằng giá thường.');
  }
  return {
    name: text(input.name, 'Tên sân', 2, 120),
    sport_type: input.sport_type,
    price_normal: normal,
    price_peak: peak,
    description: typeof input.description === 'string' ? input.description.trim().slice(0, 5000) : null,
    is_active: input.is_active === undefined ? 1 : input.is_active ? 1 : 0
  };
}

function createAdminFacilitiesService(pool) {
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

  async function activeBookingCount(connection, { facilityId, courtId }) {
    const [rows] = await connection.execute(
      `SELECT COUNT(DISTINCT b.id) AS total
       FROM bookings AS b
       INNER JOIN booking_slots AS bs ON bs.booking_id = b.id
       INNER JOIN time_slots AS ts ON ts.id = bs.time_slot_id
       INNER JOIN courts AS c ON c.id = bs.court_id
       WHERE ${facilityId ? 'c.facility_id = ?' : 'c.id = ?'}
         AND (
           (b.status = 'PENDING' AND b.lock_expires_at > UTC_TIMESTAMP(3))
           OR (b.status = 'CONFIRMED'
             AND TIMESTAMP(ts.service_date, ts.ends_at) - INTERVAL 7 HOUR > UTC_TIMESTAMP(3))
         )`,
      [facilityId || courtId]
    );
    return Number(rows[0].total);
  }

  async function lockAndCheckUpdatedAt(connection, table, id, expectedValue) {
    const allowed = table === 'facilities' ? 'facilities' : 'courts';
    const [rows] = await connection.execute(
      `SELECT * FROM ${allowed} WHERE id = ? FOR UPDATE`,
      [id]
    );
    if (!rows.length) {
      throw failure(404, `${table === 'facilities' ? 'FACILITY' : 'COURT'}_NOT_FOUND`,
        `Không tìm thấy ${table === 'facilities' ? 'cơ sở' : 'sân'}.`);
    }
    if (new Date(rows[0].updated_at).getTime() !== expectedValue.getTime()) {
      throw failure(409, 'ADMIN_STALE_DATA', 'Dữ liệu vừa được người khác thay đổi, hãy tải lại');
    }
    return rows[0];
  }

  async function checkCourtName(connection, facilityId, courtName, exceptId) {
    const [rows] = await connection.execute(
      `SELECT id FROM courts WHERE facility_id = ? AND LOWER(name) = LOWER(?)
       AND (? IS NULL OR id <> ?) LIMIT 1`,
      [facilityId, courtName, exceptId || null, exceptId || null]
    );
    if (rows.length) throw failure(409, 'COURT_NAME_CONFLICT', 'Tên sân đã tồn tại trong cơ sở này.');
  }

  async function synchronizeFacilityHours(connection, facilityId, values) {
    const hours = normalizedHours(values.opening_time, values.closing_time);
    if (!hours) throw failure(409, 'INVALID_OPENING_HOURS', 'Giờ hoạt động của cơ sở chưa hợp lệ.');
    const [courts] = await connection.execute(
      `SELECT id, price_normal, price_peak
       FROM courts
       WHERE facility_id = ?
       ORDER BY id
       FOR UPDATE`,
      [facilityId]
    );
    if (!courts.length) return;

    const today = localDateString();
    const courtIds = courts.map((court) => String(court.id));
    const placeholders = courtIds.map(() => '?').join(', ');
    await connection.execute(
      `SELECT id
       FROM time_slots
       WHERE court_id IN (${placeholders}) AND service_date >= ?
       ORDER BY court_id, service_date, starts_at, id
       FOR UPDATE`,
      [...courtIds, today]
    );

    const [bookingRows] = await connection.execute(
      `SELECT COUNT(DISTINCT b.id) AS total
       FROM bookings AS b
       INNER JOIN booking_slots AS bs ON bs.booking_id = b.id
       INNER JOIN time_slots AS ts ON ts.id = bs.time_slot_id
       INNER JOIN courts AS c ON c.id = bs.court_id
       WHERE c.facility_id = ?
         AND ((b.status = 'PENDING' AND b.lock_expires_at > UTC_TIMESTAMP(3))
           OR (b.status = 'CONFIRMED'
             AND TIMESTAMP(ts.service_date, ts.ends_at) - INTERVAL 7 HOUR > UTC_TIMESTAMP(3)))
         AND (TIME_TO_SEC(ts.starts_at) < ? OR TIME_TO_SEC(ts.ends_at) > ?)`,
      [facilityId, hours.openingMinutes * 60, hours.closingMinutes * 60]
    );
    const activeBookings = Number(bookingRows[0].total);
    if (activeBookings > 0) {
      throw failure(
        409,
        'FACILITY_HAS_ACTIVE_BOOKINGS',
        `Không thể đổi giờ hoạt động vì còn ${activeBookings} đơn hiệu lực ngoài khung giờ mới.`,
        { active_bookings: activeBookings }
      );
          await insertMissingSlotsForCourt(connection, {
      courtId: courtResult.insertId,
      firstDate: localDateString(),
      daysAhead: readSlotDaysAhead(),
      ...hours,
      priceNormal: Number(court.price_normal),
      pricePeak: Number(court.price_peak)
          });
    }

    await connection.execute(
      `DELETE ts
       FROM time_slots AS ts
       WHERE ts.court_id IN (${placeholders})
         AND ts.service_date >= ?
         AND ts.status = 'AVAILABLE'
         AND (TIME_TO_SEC(ts.starts_at) < ? OR TIME_TO_SEC(ts.ends_at) > ?)
         AND NOT EXISTS (
           SELECT 1 FROM booking_slots AS bs WHERE bs.time_slot_id = ts.id
         )`,
      [
        ...courtIds,
        today,
        hours.openingMinutes * 60,
        hours.closingMinutes * 60
      ]
    );

    const daysAhead = readSlotDaysAhead();
    for (const court of courts) {
      await insertMissingSlotsForCourt(connection, {
        courtId: court.id,
        firstDate: today,
        daysAhead,
        ...hours,
        priceNormal: Number(court.price_normal),
        pricePeak: Number(court.price_peak)
      });
    }
  }

  return {
    async listFacilities(query) {
      const search = query.q === undefined ? '' : query.q;
      if (typeof search !== 'string' || search.length > 120) {
        throw failure(400, 'INVALID_QUERY', 'q không được vượt quá 120 ký tự.');
      }
      const district = query.district || '';
      const active = parseActive(query.is_active);
      if (typeof query.district !== 'undefined'
          && (typeof query.district !== 'string' || query.district.length > 120)) {
        throw failure(400, 'INVALID_QUERY', 'district không hợp lệ.');
      }
      const page = parsePage(query.page, 1, 'page');
      const pageSize = parsePage(query.page_size, 20, 'page_size');
      if (pageSize > MAX_PAGE_SIZE) throw failure(400, 'INVALID_QUERY', 'page_size tối đa là 50.');
      const parsedLimit = Number.parseInt(pageSize, 10);
      const safeLimit = Number.isSafeInteger(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 100)
        : 20;
      const parsedPage = Number.parseInt(page, 10);
      const safePage = Number.isSafeInteger(parsedPage) && parsedPage > 0 ? parsedPage : 1;
      const parsedOffset = Number.parseInt((safePage - 1) * safeLimit, 10);
      const safeOffset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0
        ? parsedOffset
        : 0;
      const conditions = [];
      const parameters = [];
      if (search.trim()) {
        const escaped = search.trim().replace(/[!%_]/g, '!$&');
        conditions.push("(f.name LIKE ? ESCAPE '!' OR f.address LIKE ? ESCAPE '!')");
        parameters.push(`%${escaped}%`, `%${escaped}%`);
      }
      if (district) { conditions.push('f.district = ?'); parameters.push(district); }
      if (active !== null) { conditions.push('f.is_active = ?'); parameters.push(active); }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const [counts] = await pool.execute(
        `SELECT COUNT(*) AS total FROM facilities AS f ${where}`,
        parameters
      );
      const [summaryRows] = await pool.execute(
        `SELECT
           (SELECT COUNT(*) FROM facilities) AS total_facilities,
           (SELECT COUNT(*) FROM facilities WHERE is_active = TRUE) AS active_facilities,
           (SELECT COUNT(*) FROM facilities WHERE is_active = FALSE) AS inactive_facilities,
           (SELECT COUNT(*)
            FROM courts AS c
            INNER JOIN facilities AS f ON f.id = c.facility_id
            WHERE c.is_active = TRUE AND f.is_active = TRUE) AS active_courts,
           (SELECT COUNT(*)
            FROM courts AS c
            INNER JOIN facilities AS f ON f.id = c.facility_id
            WHERE c.is_active = FALSE OR f.is_active = FALSE) AS inactive_courts,
           (SELECT COALESCE(ROUND(
              100 * SUM(CASE WHEN ts.status = 'BOOKED' THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0),
              1
            ), 0)
            FROM time_slots AS ts
            INNER JOIN courts AS c ON c.id = ts.court_id
            INNER JOIN facilities AS f ON f.id = c.facility_id
            WHERE f.is_active = TRUE AND c.is_active = TRUE
              AND ts.service_date BETWEEN
                DATE_SUB(DATE(DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 HOUR)), INTERVAL 6 DAY)
                AND DATE(DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 HOUR))
              AND ts.status IN ('AVAILABLE', 'LOCKED', 'BOOKED')
              AND (ts.status <> 'LOCKED' OR ts.lock_expires_at > UTC_TIMESTAMP(3))
           ) AS avg_fill_rate_percent`
      );
      const [rows] = await pool.execute(
        `SELECT f.id, f.name, f.address, f.district, f.hotline, f.opening_time,
                f.closing_time, f.is_active, f.updated_at,
                COUNT(DISTINCT c.id) AS court_count,
                COUNT(DISTINCT CASE
                  WHEN c.is_active = TRUE AND f.is_active = TRUE THEN c.id
                END) AS active_court_count,
                COUNT(DISTINCT CASE WHEN b.id IS NOT NULL THEN b.id END) AS active_booking_count
         FROM facilities AS f
         LEFT JOIN courts AS c ON c.facility_id = f.id
         LEFT JOIN booking_slots AS bs ON bs.court_id = c.id
         LEFT JOIN time_slots AS ts ON ts.id = bs.time_slot_id
         LEFT JOIN bookings AS b ON b.id = bs.booking_id
           AND ((b.status = 'PENDING' AND b.lock_expires_at > UTC_TIMESTAMP(3))
             OR (b.status = 'CONFIRMED'
               AND TIMESTAMP(ts.service_date, ts.ends_at) - INTERVAL 7 HOUR > UTC_TIMESTAMP(3)))
         ${where}
         GROUP BY f.id
         ORDER BY f.id DESC LIMIT ${safeLimit} OFFSET ${safeOffset}`,
        parameters
      );
      return {
        facilities: rows.map((row) => ({
          ...row,
          id: String(row.id),
          is_active: Boolean(row.is_active),
          court_count: Number(row.court_count),
          active_court_count: Number(row.active_court_count),
          active_booking_count: Number(row.active_booking_count),
          updated_at: isoUtc(row.updated_at)
        })),
        pagination: {
          page, page_size: pageSize, total: Number(counts[0].total),
          total_pages: Math.ceil(Number(counts[0].total) / pageSize)
        },
        summary: {
          total_facilities: Number(summaryRows[0].total_facilities),
          active_facilities: Number(summaryRows[0].active_facilities),
          inactive_facilities: Number(summaryRows[0].inactive_facilities),
          active_courts: Number(summaryRows[0].active_courts),
          inactive_courts: Number(summaryRows[0].inactive_courts),
          avg_fill_rate_percent: Number(summaryRows[0].avg_fill_rate_percent)
        },
        server_time: new Date().toISOString()
      };
    },

    async exportFacilities(query = {}, adminUserId) {
      const parsedLimit = Number.parseInt(5001, 10);
      const safeLimit = Number.isSafeInteger(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 5001)
        : 5001;
      const search = query.q === undefined ? '' : query.q;
      if (typeof search !== 'string' || search.length > 120) {
        throw failure(400, 'INVALID_QUERY', 'q không được vượt quá 120 ký tự.');
      }
      const district = query.district || '';
      const active = parseActive(query.is_active);
      if (typeof query.district !== 'undefined'
          && (typeof query.district !== 'string' || query.district.length > 120)) {
        throw failure(400, 'INVALID_QUERY', 'district không hợp lệ.');
      }
      const conditions = [];
      const parameters = [];
      if (search.trim()) {
        const escaped = search.trim().replace(/[!%_]/g, '!$&');
        conditions.push("(f.name LIKE ? ESCAPE '!' OR f.address LIKE ? ESCAPE '!')");
        parameters.push(`%${escaped}%`, `%${escaped}%`);
      }
      if (district) {
        conditions.push('f.district = ?');
        parameters.push(district);
      }
      if (active !== null) {
        conditions.push('f.is_active = ?');
        parameters.push(active);
      }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
      const [countRows] = await pool.execute(
        `SELECT COUNT(*) AS total FROM facilities AS f ${where}`,
        parameters
      );
      const total = Number(countRows[0].total);
      if (!Number.isSafeInteger(total)) throw new RangeError('Facility count exceeds the supported range.');
      if (total > 5000) {
        throw failure(400, 'EXPORT_TOO_MANY_ROWS', 'Quá nhiều dòng, hãy lọc thu hẹp');
      }

      const [summaryRows] = await pool.execute(
        `SELECT COUNT(*) AS total_facilities,
                COALESCE(SUM(CASE WHEN is_active = TRUE THEN 1 ELSE 0 END), 0) AS active_facilities,
                COALESCE(SUM(CASE WHEN is_active = FALSE THEN 1 ELSE 0 END), 0) AS inactive_facilities,
                (SELECT COALESCE(ROUND(
                   100 * SUM(CASE WHEN ts.status = 'BOOKED' THEN 1 ELSE 0 END)
                     / NULLIF(COUNT(*), 0),
                   1
                 ), 0)
                 FROM time_slots AS ts
                 INNER JOIN courts AS c ON c.id = ts.court_id
                 INNER JOIN facilities AS f ON f.id = c.facility_id
                 WHERE f.is_active = TRUE AND c.is_active = TRUE
                   AND ts.service_date BETWEEN
                     DATE_SUB(DATE(DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 HOUR)), INTERVAL 6 DAY)
                     AND DATE(DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 HOUR))
                   AND ts.status IN ('AVAILABLE', 'LOCKED', 'BOOKED')
                   AND (ts.status <> 'LOCKED' OR ts.lock_expires_at > UTC_TIMESTAMP(3))
                ) AS avg_fill_rate_percent
         FROM facilities`
      );
      const summary = {
        total_facilities: Number(summaryRows[0].total_facilities),
        active_facilities: Number(summaryRows[0].active_facilities),
        inactive_facilities: Number(summaryRows[0].inactive_facilities),
        avg_fill_rate_percent: Number(summaryRows[0].avg_fill_rate_percent)
      };
      const [facilityRows] = await pool.execute(
        `SELECT f.id, f.name, f.address, f.district, f.hotline,
                f.opening_time, f.closing_time, f.is_active,
                COUNT(DISTINCT c.id) AS court_count,
                COUNT(DISTINCT CASE
                  WHEN c.is_active = TRUE AND f.is_active = TRUE THEN c.id
                END) AS active_court_count
         FROM facilities AS f
         LEFT JOIN courts AS c ON c.facility_id = f.id
         ${where}
         GROUP BY f.id
         ORDER BY f.id DESC
         LIMIT ${safeLimit}`,
        parameters
      );
      const facilityIds = facilityRows.map((facility) => String(facility.id));
      const courts = [];
      if (facilityIds.length) {
        const placeholders = facilityIds.map(() => '?').join(', ');
        const [courtRows] = await pool.execute(
          `SELECT c.id, c.facility_id, c.name, c.price_normal, c.price_peak,
                  f.name AS facility_name
           FROM courts AS c
           INNER JOIN facilities AS f ON f.id = c.facility_id
           WHERE c.facility_id IN (${placeholders})
           ORDER BY c.facility_id ASC, c.id ASC
           LIMIT ${safeLimit}`,
          facilityIds
        );
        if (courtRows.length > 5000) {
          throw failure(400, 'EXPORT_TOO_MANY_ROWS', 'Quá nhiều dòng, hãy lọc thu hẹp');
        }
        courts.push(...courtRows);
      }
      const exported = await createFacilitiesExport({
        facilities: facilityRows.map((row) => ({
          ...row,
          id: String(row.id),
          is_active: Boolean(row.is_active),
          court_count: Number(row.court_count),
          active_court_count: Number(row.active_court_count)
        })),
        courts,
        summary
      });
      await transaction((connection) => writeAudit(connection, {
        adminUserId,
        action: 'EXPORT_FACILITIES',
        resourceType: 'facilities_export',
        resourceId: String(adminUserId),
        details: {
          filters: {
            district: district || null,
            is_active: active === null ? null : Boolean(active),
            query_applied: Boolean(search.trim())
          },
          row_count: total,
          court_row_count: courts.length
        }
      }));
      return exported;
    },

    async getFacility(rawId) {
      const id = positiveId(rawId, 'facility');
      const [rows] = await pool.execute(
        `SELECT id, name, address, district, opening_time, closing_time, hotline,
                map_url, image_url, amenities, description, rules, cancellation_policy,
                is_active, is_seed, created_at, updated_at
         FROM facilities WHERE id = ?`,
        [id]
      );
      if (!rows.length) throw failure(404, 'FACILITY_NOT_FOUND', 'Không tìm thấy cơ sở.');
      const [courts] = await pool.execute(
        `SELECT c.id, c.facility_id, c.name, c.sport_type, c.price_normal, c.price_peak,
                c.description, c.is_active, c.is_seed, c.updated_at,
                (SELECT COUNT(DISTINCT b.id)
                 FROM booking_slots AS bs
                 INNER JOIN bookings AS b ON b.id = bs.booking_id
                 INNER JOIN time_slots AS ts ON ts.id = bs.time_slot_id
                 WHERE bs.court_id = c.id
                   AND ((b.status = 'PENDING' AND b.lock_expires_at > UTC_TIMESTAMP(3))
                     OR (b.status = 'CONFIRMED'
                       AND TIMESTAMP(ts.service_date, ts.ends_at) - INTERVAL 7 HOUR > UTC_TIMESTAMP(3)))
                ) AS active_booking_count
         FROM courts AS c WHERE c.facility_id = ? ORDER BY c.id ASC`,
        [id]
      );
      return {
        facility: {
          ...rows[0],
          id: String(rows[0].id),
          amenities: JSON.parse(rows[0].amenities),
          is_active: Boolean(rows[0].is_active),
          updated_at: isoUtc(rows[0].updated_at)
        },
        courts: courts.map((court) => ({
          ...court,
          id: String(court.id),
          facility_id: String(court.facility_id),
          is_active: Boolean(court.is_active),
          active_booking_count: Number(court.active_booking_count),
          updated_at: isoUtc(court.updated_at)
        })),
        server_time: new Date().toISOString()
      };
    },

    async createFacility(input, adminUserId) {
      requireObjectInput(input);
      const facility = validateFacility(input);
      const courtsInput = input.courts;
      if (courtsInput !== undefined && !Array.isArray(courtsInput)) {
        throw failure(400, 'INVALID_INPUT', 'Danh sách sân không hợp lệ.');
      }
      const courts = (courtsInput || []).map(validateCourt);
      if (courts.length === 0) {
        throw failure(400, 'INVALID_INPUT', 'Cần có ít nhất một sân và thông tin giá để tạo khung giờ.');
      }
      return transaction(async (connection) => {
        const [result] = await connection.execute(
          `INSERT INTO facilities
             (name, address, district, opening_time, closing_time, hotline, map_url, image_url,
              amenities, description, rules, cancellation_policy, is_active, is_seed,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [facility.name, facility.address, facility.district, facility.opening_time,
            facility.closing_time, facility.hotline, facility.map_url, facility.image_url,
            facility.amenities, facility.description, facility.rules,
            facility.cancellation_policy, facility.is_active]
        );
        const facilityId = String(result.insertId);
        const hours = normalizedHours(facility.opening_time, facility.closing_time);
        for (const court of courts) {
          await checkCourtName(connection, facilityId, court.name);
          const [courtResult] = await connection.execute(
            `INSERT INTO courts
               (facility_id, name, sport_type, price_normal, price_peak, description,
                is_active, is_seed, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
            [facilityId, court.name, court.sport_type, court.price_normal, court.price_peak,
              court.description, court.is_active]
          );
            await insertMissingSlotsForCourt(connection, {
              courtId: courtResult.insertId,
              firstDate: localDateString(),
              daysAhead: readSlotDaysAhead(),
              ...hours,
              priceNormal: Number(court.price_normal),
              pricePeak: Number(court.price_peak)
            });
        }
        await writeAudit(connection, {
          adminUserId, action: 'FACILITY_CREATE', resourceType: 'facility',
          resourceId: facilityId, details: { court_count: courts.length }
        });
        return { id: facilityId };
      });
    },

    async updateFacility(rawId, input, adminUserId) {
      requireObjectInput(input);
      const id = positiveId(rawId, 'facility');
      const expected = parseUpdatedAt(input.expected_updated_at);
      return transaction(async (connection) => {
        const current = await lockAndCheckUpdatedAt(connection, 'facilities', id, expected);
        const values = validateFacility({
          ...current,
          amenities: JSON.parse(current.amenities),
          is_active: Boolean(current.is_active),
          ...input
        }, { allowMissingHours: true });
        const hoursChanged = String(current.opening_time).slice(0, 8) !== values.opening_time
          || String(current.closing_time).slice(0, 8) !== values.closing_time;
        if (current.is_active && !values.is_active) {
          const count = await activeBookingCount(connection, { facilityId: id });
          if (count > 0) throw failure(409, 'FACILITY_HAS_ACTIVE_BOOKINGS',
            `Không thể ngừng cơ sở vì còn ${count} đơn hiệu lực.`, { active_bookings: count });
        }
        if (hoursChanged) await synchronizeFacilityHours(connection, id, values);
        await connection.execute(
          `UPDATE facilities SET name = ?, address = ?, district = ?, opening_time = ?,
             closing_time = ?, hotline = ?, map_url = ?, image_url = ?, amenities = ?,
             description = ?, rules = ?, cancellation_policy = ?, is_active = ?, is_seed = FALSE,
             updated_at = GREATEST(UTC_TIMESTAMP(3), TIMESTAMPADD(MICROSECOND, 1000, updated_at))
           WHERE id = ?`,
          [values.name, values.address, values.district, values.opening_time,
            values.closing_time, values.hotline, values.map_url, values.image_url,
            values.amenities, values.description, values.rules, values.cancellation_policy,
            values.is_active, id]
        );
        await writeAudit(connection, {
          adminUserId, action: 'FACILITY_UPDATE', resourceType: 'facility',
          resourceId: id, details: { is_active: Boolean(values.is_active) }
        });
        return { id };
      });
    },

    async deleteFacility(rawId, input, adminUserId) {
      const id = positiveId(rawId, 'facility');
      requireObjectInput(input);
      const expected = parseUpdatedAt(input.expected_updated_at);
      return transaction(async (connection) => {
        const current = await lockAndCheckUpdatedAt(connection, 'facilities', id, expected);
        const [courtRows] = await connection.execute(
          `SELECT id FROM courts WHERE facility_id = ? ORDER BY id ASC`,
          [id]
        );
        const courtIds = courtRows.map((court) => String(court.id));
        if (courtIds.length) {
          const placeholders = courtIds.map(() => '?').join(', ');
          await connection.execute(
            `SELECT id FROM time_slots
             WHERE court_id IN (${placeholders})
             ORDER BY id ASC FOR UPDATE`,
            courtIds
          );
          await connection.execute(
            `SELECT id FROM courts
             WHERE id IN (${placeholders})
             ORDER BY id ASC FOR UPDATE`,
            courtIds
          );
        }

        const [bookingRows] = await connection.execute(
          `SELECT COUNT(DISTINCT b.id) AS total
           FROM bookings AS b
           INNER JOIN booking_slots AS bs ON bs.booking_id = b.id
           INNER JOIN courts AS c ON c.id = bs.court_id
           WHERE c.facility_id = ?`,
          [id]
        );
        const bookingCount = Number(bookingRows[0].total);
        if (bookingCount > 0) {
          throw failure(
            409,
            'FACILITY_HAS_BOOKING_HISTORY',
            `Cơ sở đã có lịch sử đặt sân (${bookingCount} đơn) nên không thể xóa. Hãy tạm khóa cơ sở thay vì xóa.`,
            { booking_count: bookingCount }
          );
        }

        if (courtIds.length) {
          const placeholders = courtIds.map(() => '?').join(', ');
          await connection.execute(
            `DELETE FROM booking_slots WHERE court_id IN (${placeholders})`,
            courtIds
          );
          await connection.execute(
            `DELETE FROM time_slots WHERE court_id IN (${placeholders})`,
            courtIds
          );
          await connection.execute(
            `DELETE FROM courts WHERE id IN (${placeholders})`,
            courtIds
          );
        }
        await connection.execute('DELETE FROM facilities WHERE id = ?', [id]);
        await writeAudit(connection, {
          adminUserId,
          action: 'DELETE_FACILITY',
          resourceType: 'facility',
          resourceId: id,
          details: { facility_name: current.name }
        });
        return { id, name: current.name };
      });
    },

    async createCourt(input, adminUserId) {
      requireObjectInput(input);
      const facilityId = positiveId(String(input.facility_id), 'facility');
      const values = validateCourt(input);
      return transaction(async (connection) => {
        const [facilities] = await connection.execute(
          'SELECT id, is_active, opening_time, closing_time FROM facilities WHERE id = ? FOR UPDATE',
          [facilityId]
        );
        if (!facilities.length) throw failure(404, 'FACILITY_NOT_FOUND', 'Không tìm thấy cơ sở.');
        if (!facilities[0].is_active) throw failure(409, 'FACILITY_INACTIVE', 'Cơ sở đang ngừng hoạt động.');
        await checkCourtName(connection, facilityId, values.name);
        const [result] = await connection.execute(
          `INSERT INTO courts
             (facility_id, name, sport_type, price_normal, price_peak, description,
              is_active, is_seed, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
          [facilityId, values.name, values.sport_type, values.price_normal,
            values.price_peak, values.description, values.is_active]
        );
        const id = String(result.insertId);
        const hours = normalizedHours(facilities[0].opening_time, facilities[0].closing_time);
        if (!hours) {
          throw failure(409, 'INVALID_OPENING_HOURS', 'Giờ hoạt động của cơ sở chưa hợp lệ.');
        }
        await insertMissingSlotsForCourt(connection, {
          courtId: id,
          firstDate: localDateString(),
          daysAhead: readSlotDaysAhead(),
          ...hours,
          priceNormal: Number(values.price_normal),
          pricePeak: Number(values.price_peak)
        });
        await writeAudit(connection, {
          adminUserId, action: 'COURT_CREATE', resourceType: 'court', resourceId: id,
          details: { facility_id: facilityId, sport_type: values.sport_type }
        });
        return { id };
      });
    },

    async updateCourt(rawId, input, adminUserId) {
      requireObjectInput(input);
      const id = positiveId(rawId, 'court');
      const expected = parseUpdatedAt(input.expected_updated_at);
      return transaction(async (connection) => {
        const [courtRows] = await connection.execute('SELECT facility_id FROM courts WHERE id = ?', [id]);
        if (!courtRows.length) throw failure(404, 'COURT_NOT_FOUND', 'Không tìm thấy sân.');
        await connection.execute('SELECT id FROM facilities WHERE id = ? FOR UPDATE', [courtRows[0].facility_id]);
        const current = await lockAndCheckUpdatedAt(connection, 'courts', id, expected);
        const values = validateCourt({
          ...current,
          is_active: Boolean(current.is_active),
          ...input
        });
        const restrictedChange = (current.is_active && !values.is_active)
          || values.sport_type !== current.sport_type;
        if (restrictedChange) {
          const count = await activeBookingCount(connection, { courtId: id });
          if (count > 0) {
            throw failure(409, 'COURT_HAS_ACTIVE_BOOKINGS',
              `Không thể ngừng sân hoặc đổi môn vì còn ${count} đơn hiệu lực.`,
              { active_bookings: count });
          }
        }
        await checkCourtName(connection, current.facility_id, values.name, id);
        await connection.execute(
          `UPDATE courts SET name = ?, sport_type = ?, price_normal = ?, price_peak = ?,
             description = ?, is_active = ?, is_seed = FALSE,
             updated_at = GREATEST(UTC_TIMESTAMP(3), TIMESTAMPADD(MICROSECOND, 1000, updated_at))
           WHERE id = ?`,
          [values.name, values.sport_type, values.price_normal, values.price_peak,
            values.description, values.is_active, id]
        );
        await writeAudit(connection, {
          adminUserId, action: 'COURT_UPDATE', resourceType: 'court', resourceId: id,
          details: { sport_type: values.sport_type, is_active: Boolean(values.is_active) }
        });
        return { id };
      });
    }
  };
}

module.exports = { createAdminFacilitiesService };
