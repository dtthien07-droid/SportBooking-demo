'use strict';

const SPORTS = new Set(['BADMINTON', 'FOOTBALL_MINI', 'PICKLEBALL']);
const SPORT_NAMES = new Map([
  ['BADMINTON', 'Cầu lông'],
  ['FOOTBALL_MINI', 'Bóng đá mini'],
  ['PICKLEBALL', 'Pickleball']
]);
const MAX_UNSIGNED_BIGINT = 18446744073709551615n;
const MAX_PAGE_SIZE = 50;
const { localDateString } = require('./slot-generator');
const { TIME_BANDS } = require('./slot-availability');

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
    rating: row.rating,
    is_active: Number(row.is_active) === 1,
    court_count: Number(row.court_count),
    active_court_count: Number(row.active_court_count)
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
    description: row.description,
    is_active: Number(row.is_active) === 1
  };
}

function getAvailability(row) {
  const courtInactive = row.court_is_active === false || Number(row.court_is_active) === 0;
  const facilityInactive = row.facility_is_active === false || Number(row.facility_is_active) === 0;
  const status = row.status === 'LOCKED' && Number(row.lock_expired) === 1
    ? 'AVAILABLE'
    : row.status;
  if (courtInactive || facilityInactive) {
    return {
      status,
      is_selectable: false,
      unavailable_reason: 'COURT_INACTIVE'
    };
  }
  if (status !== 'AVAILABLE') {
    return { status, is_selectable: false, unavailable_reason: status };
  }
  if (Number(row.is_selectable) !== 1) {
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
      const date = parseFacilityDate(query.date);
      const timeBands = parseTimeBands(query.time_band);
      const page = parsePagination(query.page, 1, 'page');
      const pageSize = parsePagination(query.page_size, 10, 'page_size', MAX_PAGE_SIZE);
      const result = await repository.listFacilities({
        sport: normalizedSport,
        district,
        q,
        date,
        timeBands,
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
        throw requestError(404, 'FACILITY_NOT_FOUND',
          'Cơ sở không tồn tại hoặc không còn được công khai.');
      }
      return {
        facility: {
          ...result.facility,
          opening_time: formatTime(result.facility.opening_time),
          closing_time: formatTime(result.facility.closing_time),
          amenities: JSON.parse(result.facility.amenities),
          is_active: Number(result.facility.is_active) === 1
        },
        courts: result.courts.map((court) => formatCourt({
          ...court,
          is_active: Number(court.is_active) === 1
            && Number(result.facility.is_active) === 1
        }))
      };
    },

    async getCourtTimeSlots(value, dateValue) {
      const id = parseId(value);
      const serviceDate = parseServiceDate(dateValue);
      const rows = await repository.findCourtTimeSlots(id, serviceDate);
      if (!rows) {
        throw requestError(404, 'COURT_NOT_FOUND', 'The court was not found.');
      }
      const openingTime = formatTime(rows[0].opening_time);
      const closingTime = formatTime(rows[0].closing_time);
      const timeSlots = rows
        .filter((row) => row.id !== null
          && (openingTime === null || formatTime(row.starts_at) >= openingTime)
          && (closingTime === null || formatTime(row.ends_at) <= closingTime))
        .map((row) => ({
          id: row.id,
          court_id: row.court_id,
          service_date: serviceDate,
          starts_at: formatTime(row.starts_at),
          ends_at: formatTime(row.ends_at),
          price: row.price,
          ...getAvailability(row)
        }));
      return {
        court_id: rows[0].court_id,
        service_date: serviceDate,
        time_slots: timeSlots
      };
    }
  };
}

function addDateOffset(value, days) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function parseFacilityDate(value) {
  if (value === undefined || value === '') {
    return null;
  }
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw invalidInput('date phải theo định dạng YYYY-MM-DD.');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw invalidInput('Ngày chơi không hợp lệ.');
  }
  const today = localDateString();
  if (value < today || value > addDateOffset(today, 13)) {
    throw invalidInput('Chỉ xem được lịch trong 14 ngày tới.');
  }
  return value;
}

function parseTimeBands(value) {
  if (value === undefined || value === '') {
    return [];
  }
  if (typeof value !== 'string') {
    throw invalidInput('time_band phải là danh sách khung giờ.');
  }
  const selected = value.split(',').map((band) => band.trim());
  if (selected.some((band) => !Object.prototype.hasOwnProperty.call(TIME_BANDS, band))) {
    throw invalidInput('time_band chỉ nhận morning, afternoon, evening hoặc night.');
  }
  return [...new Set(selected)];
}

module.exports = { createFacilitiesService };
