'use strict';

const SPORTS = new Set(['BADMINTON', 'FOOTBALL_MINI', 'PICKLEBALL']);
const SPORT_NAMES = new Map([
  ['BADMINTON', 'Cầu lông'],
  ['FOOTBALL_MINI', 'Bóng đá mini'],
  ['PICKLEBALL', 'Pickleball']
]);
const MAX_UNSIGNED_BIGINT = 18446744073709551615n;
const MAX_PAGE_SIZE = 50;
const MINIMUM_LEAD_TIME_MS = 15 * 60 * 1000;

function requestError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function invalidInput(message) {
  return requestError(400, 'INVALID_REQUEST', message);
}

function parseId(value) {
  if (typeof value !== 'string' || !/^\d{1,20}$/.test(value)) {
    throw invalidInput('ID must be a positive integer.');
  }
  const id = BigInt(value);
  if (id < 1n || id > MAX_UNSIGNED_BIGINT) {
    throw invalidInput('ID must be a positive integer.');
  }
  return id.toString();
}

function parseOptionalText(value, field, maxLength) {
  if (value === undefined || value === '') {
    return null;
  }
  if (typeof value !== 'string') {
    throw invalidInput(`${field} must be text.`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw invalidInput(`${field} is too long.`);
  }
  return normalized || null;
}

function parsePagination(value, fallback, field, maximum = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw invalidInput(`${field} must be a positive integer.`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number > maximum) {
    throw invalidInput(`${field} is outside the allowed range.`);
  }
  return number;
}

function parseServiceDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalidInput('date must use YYYY-MM-DD format.');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw invalidInput('date must be a valid calendar date.');
  }
  return value;
}

function formatTime(value) {
  if (value === null || value === undefined) {
    return null;
  }
  const match = String(value).match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/);
  if (!match) {
    throw new TypeError('The database returned an invalid time value.');
  }
  return `${match[1].padStart(2, '0')}:${match[2]}:${match[3] || '00'}`;
}

function getUtcTimestamp(value) {
  const timestamp = value instanceof Date
    ? value.getTime()
    : Date.parse(`${String(value).replace(' ', 'T')}Z`);
  if (!Number.isFinite(timestamp)) {
    throw new TypeError('The database returned an invalid UTC timestamp.');
  }
  return timestamp;
}

function formatFacility(row) {
  const sports = row.sport_types ? row.sport_types.split(',') : [];
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    district: row.district,
    opening_time: formatTime(row.opening_time),
    closing_time: formatTime(row.closing_time),
    hotline: row.hotline,
    latitude: row.latitude,
    longitude: row.longitude,
    map_url: row.map_url,
    description: row.description,
    amenities: JSON.parse(row.amenities),
    image_url: row.image_url,
    sports,
    sport: sports[0] || null,
    sport_name: sports.map((sport) => SPORT_NAMES.get(sport) || sport).join(', '),
    price_min: row.price_min,
    price_max: row.price_max,
    rating: row.rating
  };
}

function formatCourt(row) {
  return {
    id: row.id,
    name: row.name,
    sport_type: row.sport_type,
    sport: row.sport_type,
    sport_name: SPORT_NAMES.get(row.sport_type) || row.sport_type,
    price_normal: row.price_normal,
    price_peak: row.price_peak,
    survey_price_min: row.survey_price_min,
    survey_price_max: row.survey_price_max,
    rating: row.initial_rating,
    description: row.description
  };
}

function getAvailability(row, nowMs) {
  const status = row.status === 'LOCKED' && Number(row.lock_expired) === 1
    ? 'AVAILABLE'
    : row.status;
  if (status !== 'AVAILABLE') {
    return { status, is_selectable: false, unavailable_reason: status };
  }

  const start = formatTime(row.starts_at);
  const startsAtMs = Date.parse(`${row.service_date}T${start}+07:00`);
  if (!Number.isFinite(startsAtMs)) {
    throw new TypeError('The database returned an invalid service date or start time.');
  }
  if (startsAtMs - nowMs < MINIMUM_LEAD_TIME_MS) {
    return {
      status,
      is_selectable: false,
      unavailable_reason: 'PAST_OR_TOO_SOON'
    };
  }
  return { status, is_selectable: true, unavailable_reason: null };
}

function createFacilitiesService(repository) {
  return {
    async listFacilities(query) {
      const sport = parseOptionalText(query.sport, 'sport', 40);
      const normalizedSport = sport ? sport.toUpperCase() : null;
      if (normalizedSport && !SPORTS.has(normalizedSport)) {
        throw invalidInput('sport is not supported.');
      }
      const district = parseOptionalText(query.district, 'district', 120);
      const q = parseOptionalText(query.q, 'q', 120);
      const page = parsePagination(query.page, 1, 'page');
      const pageSize = parsePagination(query.page_size, 10, 'page_size', MAX_PAGE_SIZE);
      const result = await repository.listFacilities({
        sport: normalizedSport,
        district,
        q,
        page,
        pageSize
      });
      return {
        facilities: result.rows.map(formatFacility),
        pagination: {
          page,
          page_size: pageSize,
          total: result.total,
          total_pages: Math.ceil(result.total / pageSize)
        }
      };
    },

    async getFacility(value) {
      const id = parseId(value);
      const result = await repository.findFacility(id);
      if (!result) {
        throw requestError(404, 'FACILITY_NOT_FOUND', 'The facility was not found.');
      }
      return {
        facility: {
          ...result.facility,
          opening_time: formatTime(result.facility.opening_time),
          closing_time: formatTime(result.facility.closing_time),
          amenities: JSON.parse(result.facility.amenities)
        },
        courts: result.courts.map(formatCourt)
      };
    },

    async getCourtTimeSlots(value, dateValue) {
      const id = parseId(value);
      const serviceDate = parseServiceDate(dateValue);
      const rows = await repository.findCourtTimeSlots(id, serviceDate);
      if (!rows) {
        throw requestError(404, 'COURT_NOT_FOUND', 'The court was not found.');
      }
      const nowMs = getUtcTimestamp(rows[0].now_utc);
      const timeSlots = rows
        .filter((row) => row.id !== null)
        .map((row) => ({
          id: row.id,
          court_id: row.court_id,
          service_date: serviceDate,
          starts_at: formatTime(row.starts_at),
          ends_at: formatTime(row.ends_at),
          price: row.price,
          ...getAvailability(row, nowMs)
        }));
      return {
        court_id: rows[0].court_id,
        service_date: serviceDate,
        time_slots: timeSlots
      };
    }
  };
}

module.exports = { createFacilitiesService };
