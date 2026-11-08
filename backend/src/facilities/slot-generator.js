'use strict';

const SLOT_DAYS_AHEAD_DEFAULT = 14;
const SLOT_DAYS_AHEAD_MIN = 1;
const SLOT_DAYS_AHEAD_MAX = 60;
const HOUR_MINUTES = 60;
const PEAK_START_MINUTES = 17 * HOUR_MINUTES;
const PEAK_END_MINUTES = 21 * HOUR_MINUTES;

function readSlotDaysAhead(env = process.env, warn = console.warn) {
  const rawValue = env.SLOT_DAYS_AHEAD;
  if (rawValue === undefined || String(rawValue).trim() === '') {
    return SLOT_DAYS_AHEAD_DEFAULT;
  }
  const value = String(rawValue).trim();
  const daysAhead = /^\d+$/.test(value) ? Number(value) : NaN;
  if (!Number.isInteger(daysAhead)
      || daysAhead < SLOT_DAYS_AHEAD_MIN
      || daysAhead > SLOT_DAYS_AHEAD_MAX) {
    warn(`[Slot Generator] SLOT_DAYS_AHEAD must be ${SLOT_DAYS_AHEAD_MIN}-${SLOT_DAYS_AHEAD_MAX}; using ${SLOT_DAYS_AHEAD_DEFAULT}.`);
    return SLOT_DAYS_AHEAD_DEFAULT;
  }
  return daysAhead;
}

function readSlotGeneratorEnabled(env = process.env, warn = console.warn) {
  const defaultEnabled = env.APP_ENV === 'development';
  const rawValue = env.SLOT_GENERATOR_ENABLED;
  if (rawValue === undefined || String(rawValue).trim() === '') return defaultEnabled;
  const normalized = String(rawValue).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  warn('[Slot Generator] SLOT_GENERATOR_ENABLED must be true or false; using the APP_ENV default.');
  return defaultEnabled;
}

function formatTime(minutes) {
  if (minutes === 1440) return '24:00:00';
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}:00`;
}

function dateOffset(dateString, offset) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function localDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function buildServiceDates(now = new Date(), daysAhead = SLOT_DAYS_AHEAD_DEFAULT) {
  if (!Number.isInteger(daysAhead)
      || daysAhead < SLOT_DAYS_AHEAD_MIN
      || daysAhead > SLOT_DAYS_AHEAD_MAX) {
    throw new RangeError(`daysAhead must be ${SLOT_DAYS_AHEAD_MIN}-${SLOT_DAYS_AHEAD_MAX}.`);
  }
  const firstDate = localDateString(now);
  return Array.from({ length: daysAhead }, (_, index) => dateOffset(firstDate, index));
}

function timeToMinutes(value, closing = false) {
  const normalized = String(value ?? '').trim().slice(0, 8);
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(normalized);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || hour > 24 || (hour === 24 && minute !== 0)) return null;
  if (closing && hour === 0 && minute === 0) return 1440;
  return hour * HOUR_MINUTES + minute;
}

function normalizedHours(openingTime, closingTime) {
  const opening = timeToMinutes(openingTime);
  const closing = timeToMinutes(closingTime, true);
  if (opening === null || closing === null) return null;
  const openingMinutes = Math.ceil(opening / HOUR_MINUTES) * HOUR_MINUTES;
  const closingMinutes = Math.floor(closing / HOUR_MINUTES) * HOUR_MINUTES;
  if (openingMinutes >= closingMinutes || closingMinutes > 1440) return null;
  return { openingMinutes, closingMinutes };
}

function databaseDate(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function slotPrice(startMinutes, priceNormal, pricePeak) {
  return startMinutes >= PEAK_START_MINUTES && startMinutes < PEAK_END_MINUTES
    ? pricePeak
    : priceNormal;
}

async function insertMissingSlotsForCourt(connection, {
  courtId,
  firstDate,
  daysAhead,
  openingMinutes,
  closingMinutes,
  priceNormal,
  pricePeak,
  updateAvailablePrices = false
}) {
  if (!Number.isInteger(daysAhead)
      || daysAhead < SLOT_DAYS_AHEAD_MIN
      || daysAhead > SLOT_DAYS_AHEAD_MAX) {
    throw new RangeError(`daysAhead must be ${SLOT_DAYS_AHEAD_MIN}-${SLOT_DAYS_AHEAD_MAX}.`);
  }
  if (!Number.isInteger(openingMinutes) || !Number.isInteger(closingMinutes)
      || openingMinutes < 0 || openingMinutes >= closingMinutes || closingMinutes > 1440
      || openingMinutes % HOUR_MINUTES !== 0 || closingMinutes % HOUR_MINUTES !== 0) {
    throw new RangeError('Court opening and closing times must define full-hour slots within one day.');
  }

  const lastDate = dateOffset(firstDate, daysAhead - 1);
  const [existingRows] = await connection.execute(
    `SELECT service_date, starts_at
     FROM time_slots
     WHERE court_id = ?
       AND service_date BETWEEN ? AND ?`,
    [courtId, firstDate, lastDate]
  );
  const existingSlots = new Set(existingRows.map((row) => (
    `${databaseDate(row.service_date)}|${String(row.starts_at).slice(0, 8)}`
  )));
  const summary = { inserted: 0, existing: 0, updated: 0 };

  for (let day = 0; day < daysAhead; day += 1) {
    const serviceDate = dateOffset(firstDate, day);
    for (let start = openingMinutes; start < closingMinutes; start += HOUR_MINUTES) {
      const end = start + HOUR_MINUTES;
      const startsAt = formatTime(start);
      const endsAt = formatTime(end);
      const price = slotPrice(start, priceNormal, pricePeak);
      const key = `${serviceDate}|${startsAt.slice(0, 8)}`;
      const alreadyExists = existingSlots.has(key);

      if (alreadyExists && !updateAvailablePrices) {
        summary.existing += 1;
        continue;
      }

      if (updateAvailablePrices) {
        const [result] = await connection.execute(
          `INSERT INTO time_slots
             (court_id, service_date, starts_at, ends_at, price, status,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, 'AVAILABLE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
           ON DUPLICATE KEY UPDATE
             updated_at = IF(status = 'AVAILABLE' AND NOT (price <=> VALUES(price)), UTC_TIMESTAMP(3), updated_at),
             price = IF(status = 'AVAILABLE' AND NOT (price <=> VALUES(price)), VALUES(price), price)`,
          [courtId, serviceDate, startsAt, endsAt, price]
        );
        if (alreadyExists) {
          if (result.affectedRows === 2) summary.updated += 1;
          else summary.existing += 1;
        } else {
          summary.inserted += 1;
          existingSlots.add(key);
        }
        continue;
      }

      const [result] = await connection.execute(
        `INSERT IGNORE INTO time_slots
           (court_id, service_date, starts_at, ends_at, price, status,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'AVAILABLE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
        [courtId, serviceDate, startsAt, endsAt, price]
      );
      if (result.affectedRows === 1) {
        summary.inserted += 1;
        existingSlots.add(key);
      } else {
        summary.existing += 1;
      }
    }
  }
  return summary;
}

async function runSlotGenerator(pool, options = {}) {
  const {
    daysAhead = readSlotDaysAhead(),
    now = new Date(),
    courtIds,
    warn = console.warn,
    logger
  } = options;
  const serviceDates = buildServiceDates(now, daysAhead);
  const log = (method, message) => {
    if (typeof logger?.[method] === 'function') logger[method](message);
  };
  const startedAt = Date.now();
  log('info', `[Slot Generator] Started: days=${daysAhead}, dates=${serviceDates[0]}..${serviceDates.at(-1)}.`);
  let connection;
  try {
    if (courtIds !== undefined && (!Array.isArray(courtIds)
        || courtIds.some((id) => !/^[1-9]\d*$/.test(String(id))))) {
      throw new TypeError('courtIds must be an array of positive integer IDs.');
    }
    if (Array.isArray(courtIds) && courtIds.length === 0) {
      const summary = { dates: serviceDates, courtsProcessed: 0, slotsInserted: 0, slotsExisting: 0 };
      log('info', `[Slot Generator] Finished: days=${daysAhead}, courts=0, slots_added=0, duration_ms=${Date.now() - startedAt}.`);
      return summary;
    }

    connection = await pool.getConnection();
    const idFilter = Array.isArray(courtIds)
      ? ` AND c.id IN (${courtIds.map(() => '?').join(', ')})`
      : '';
    const [courts] = await connection.execute(
      `SELECT c.id AS court_id, f.opening_time, f.closing_time,
              c.price_normal, c.price_peak
       FROM facilities AS f
       INNER JOIN courts AS c ON c.facility_id = f.id
       WHERE f.is_active = TRUE
         AND c.is_active = TRUE${idFilter}
       ORDER BY c.id`,
      courtIds || []
    );
    const summary = {
      dates: serviceDates,
      courtsProcessed: 0,
      slotsInserted: 0,
      slotsExisting: 0
    };

    for (const court of courts) {
      const hours = normalizedHours(court.opening_time, court.closing_time);
      if (!hours) {
        warn(`[Slot Generator] Skipping court ${court.court_id}: invalid opening/closing hours.`);
        continue;
      }
      const slots = await insertMissingSlotsForCourt(connection, {
        courtId: court.court_id,
        firstDate: serviceDates[0],
        daysAhead,
        ...hours,
        priceNormal: Number(court.price_normal),
        pricePeak: Number(court.price_peak)
      });
      summary.courtsProcessed += 1;
      summary.slotsInserted += slots.inserted;
      summary.slotsExisting += slots.existing;
    }
    log('info', `[Slot Generator] Finished: days=${daysAhead}, dates=${serviceDates[0]}..${serviceDates.at(-1)}, courts=${summary.courtsProcessed}, slots_added=${summary.slotsInserted}, duration_ms=${Date.now() - startedAt}.`);
    return summary;
  } catch (error) {
    log('error', `[Slot Generator] Finished: days=${daysAhead}, status=error, duration_ms=${Date.now() - startedAt}, error=${error.message}.`);
    throw error;
  } finally {
    connection?.release();
  }
}

module.exports = {
  SLOT_DAYS_AHEAD_DEFAULT,
  buildServiceDates,
  dateOffset,
  insertMissingSlotsForCourt,
  localDateString,
  normalizedHours,
  readSlotDaysAhead,
  readSlotGeneratorEnabled,
  runSlotGenerator
};
