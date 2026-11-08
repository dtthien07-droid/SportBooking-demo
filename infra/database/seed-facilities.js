'use strict';

const path = require('node:path');
const { createRequire } = require('node:module');
const { getAllowedPool, readDatabaseTarget } = require('./facilities-db');

const backendRequire = createRequire(path.resolve(__dirname, '..', '..', 'backend', 'package.json'));
const ExcelJS = backendRequire('exceljs');
const WORKBOOK_PATH = path.resolve(__dirname, '..', 'data', 'khao-sat-san.xlsx');
const EXPECTED_SPORT_COUNTS = {
  BADMINTON: 10,
  FOOTBALL_MINI: 8,
  PICKLEBALL: 11
};
const DISTRICTS = ['Ba Đình', 'Cầu Giấy', 'Đống Đa', 'Nam Từ Liêm', 'Tây Hồ', 'Thanh Xuân'];

function normalizeText(value) {
  return String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
  return normalizeText(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/giu, 'd')
    .toLowerCase();
}

function cellValue(cell) {
  const value = cell.value;
  if (value === null || value === undefined) {
    return '';
  }
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'object') {
    if (typeof value.hyperlink === 'string') {
      return value.hyperlink;
    }
    if (typeof value.text === 'string') {
      return value.text;
    }
    if (value.text && Array.isArray(value.text.richText)) {
      return value.text.richText.map((item) => item.text).join('');
    }
    if (Array.isArray(value.richText)) {
      return value.richText.map((item) => item.text).join('');
    }
    return '';
  }
  return value;
}

function mapSport(value, rowNumber) {
  const key = normalizeKey(value);
  if (key.includes('pickleball')) {
    return 'PICKLEBALL';
  }
  if (key.includes('cau long') || key.includes('badminton')) {
    return 'BADMINTON';
  }
  if (key.includes('san bong') || key.includes('bong da') || key.includes('football')) {
    return 'FOOTBALL_MINI';
  }
  throw new Error(`Excel row ${rowNumber}: unknown sport "${value}".`);
}

function normalizePhone(value, rowNumber, warnings) {
  if (value instanceof Date) {
    warnings.push({ row: rowNumber, field: 'phone', message: 'phone cell is a date value; stored as NULL' });
    return null;
  }
  let digits = normalizeText(value).replace(/[.\s]/g, '');
  if (!digits) {
    return null;
  }
  if (!/^\d+$/.test(digits)) {
    warnings.push({ row: rowNumber, field: 'phone', message: 'phone is not digits-only after normalization; stored as NULL' });
    return null;
  }
  if ((digits.length === 9 || digits.length === 10) && !digits.startsWith('0')) {
    digits = `0${digits}`;
  }
  if (digits.length < 10 || digits.length > 11) {
    warnings.push({ row: rowNumber, field: 'phone', message: `phone has ${digits.length} digits after normalization` });
  }
  return digits;
}

function parseMapUrl(value, rowNumber, warnings) {
  if (value instanceof Date) {
    warnings.push({ row: rowNumber, field: 'map_url', message: 'map cell is a date value; stored as NULL' });
    return null;
  }
  const candidate = normalizeText(value);
  if (!candidate) {
    return null;
  }
  try {
    const url = new URL(candidate);
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      return url.toString();
    }
  } catch {
    warnings.push({ row: rowNumber, field: 'map_url', message: 'map value is not a URL; stored as NULL' });
    return null;
  }
  warnings.push({ row: rowNumber, field: 'map_url', message: 'map URL must use HTTP or HTTPS; stored as NULL' });
  return null;
}

function parseRating(value, rowNumber, warnings) {
  if (value instanceof Date) {
    warnings.push({ row: rowNumber, field: 'initial_rating', message: 'rating cell is a date value; stored as NULL' });
    return null;
  }
  if (value === '' || value === null || value === undefined) {
    return null;
  }
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
    warnings.push({ row: rowNumber, field: 'initial_rating', message: `rating "${value}" is outside 1.0–5.0; stored as NULL` });
    return null;
  }
  return Math.round(rating * 10) / 10;
}

function parseMoneyAmount(token) {
  const match = token.match(/^\s*(\d+(?:[.,]\d+)*)(.*)$/);
  if (!match) {
    return null;
  }
  const numberText = match[1];
  const unit = match[2].toLowerCase();
  const groups = numberText.split(/[.,]/);
  let amount;
  if (groups.length > 1 && groups.slice(1).every((group) => group.length === 3)) {
    amount = Number(groups.join(''));
  } else {
    amount = Number(numberText.replace(',', '.'));
  }
  if (!Number.isFinite(amount)) {
    return null;
  }
  if (/\b(?:k|nghìn|ngàn)\b/i.test(unit) || /^\s*k/i.test(unit)) {
    amount *= 1000;
  } else if (/\btriệu\b/i.test(unit)) {
    amount *= 1000000;
  }
  return Math.round(amount);
}

function parsePrice(value, rowNumber, warnings) {
  if (value instanceof Date) {
    warnings.push({ row: rowNumber, field: 'price', message: 'price cell is a date value; not seeded' });
    return null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const amount = Math.round(value);
    return { minimum: amount, maximum: amount, normal: amount, peak: Math.round(amount * 1.3) };
  }
  const text = normalizeText(value);
  const tokens = text.match(/\d+(?:[.,]\d+)*(?:\s*(?:k|nghìn|ngàn|triệu))?/giu) || [];
  const amounts = tokens.map(parseMoneyAmount).filter((amount) => Number.isSafeInteger(amount) && amount > 0);
  if (amounts.length === 0) {
    warnings.push({ row: rowNumber, field: 'price', message: `cannot parse survey price "${text}"` });
    return null;
  }
  const minimum = Math.min(...amounts);
  const maximum = Math.max(...amounts);
  return {
    minimum,
    maximum,
    normal: minimum,
    peak: amounts.length === 1 ? Math.round(minimum * 1.3) : maximum
  };
}

function parseClock(hourText, minuteText, rowNumber, field) {
  const hour = Number(hourText);
  const minute = Number(minuteText || 0);
  const maxHour = field === 'closing' ? 24 : 23;
  if (!Number.isInteger(hour) || hour < 0 || hour > maxHour || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error(`Excel row ${rowNumber}: invalid ${field} time "${hourText}:${minuteText}".`);
  }
  if (hour === 24 && minute !== 0) {
    throw new Error(`Excel row ${rowNumber}: ${field} time cannot be later than 24:00.`);
  }
  return hour * 60 + minute;
}

function formatTime(minutes) {
  if (minutes === 1440) {
    return '24:00:00';
  }
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(remainder).padStart(2, '0')}:00`;
}

function parseOpeningHours(value, rowNumber) {
  if (value instanceof Date) {
    throw new Error(`Excel row ${rowNumber}: opening-hours cell is a date value.`);
  }
  const text = normalizeText(value);
  if (/cả\s*ngày/i.test(text)) {
    return { openingMinutes: 0, closingMinutes: 1440, allDay: true };
  }
  const matches = [...text.matchAll(/(\d{1,2})\s*(?::|h)\s*(\d{1,2})?/giu)];
  if (matches.length < 2) {
    throw new Error(`Excel row ${rowNumber}: cannot parse opening hours "${text}".`);
  }
  let openingMinutes = parseClock(matches[0][1], matches[0][2], rowNumber, 'opening');
  let closingMinutes = parseClock(matches[1][1], matches[1][2], rowNumber, 'closing');
  if (closingMinutes === 0) {
    closingMinutes = 1440;
  }
  openingMinutes = Math.ceil(openingMinutes / 60) * 60;
  closingMinutes = Math.floor(closingMinutes / 60) * 60;
  if (openingMinutes >= closingMinutes) {
    throw new Error(`Excel row ${rowNumber}: no complete one-hour slot after rounding "${text}".`);
  }
  return { openingMinutes, closingMinutes, allDay: false };
}

function parseAmenities(value) {
  if (value instanceof Date) {
    return [];
  }
  return [...new Set(
    normalizeText(value)
      .split(/[\/,;]+/u)
      .map((item) => normalizeText(item))
      .filter(Boolean)
  )];
}

function findAddressDistrictMismatch(address, district) {
  const addressKey = normalizeKey(address);
  const districtKey = normalizeKey(district);
  return DISTRICTS.find((candidate) => {
    const candidateKey = normalizeKey(candidate);
    return candidateKey !== districtKey && addressKey.includes(candidateKey);
  });
}

function getLocalDateParts(date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  return Object.fromEntries(parts.map(({ type, value }) => [type, value]));
}

function dateOffset(dateString, offset) {
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + offset));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function databaseDate(value) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function validateHeaders(sheet) {
  const expected = [
    'cum san / khu vuc',
    'ten mon',
    'ten san',
    'dia chi chi tiet',
    'link map',
    'so dien thoai lien he',
    'gio mo cua / dong cua',
    'tien ich',
    'rate dgia'
  ];
  for (let column = 1; column <= expected.length; column += 1) {
    const actual = normalizeKey(cellValue(sheet.getRow(1).getCell(column)));
    if (actual !== expected[column - 1]) {
      throw new Error(`Workbook column ${column} header mismatch: "${actual}".`);
    }
  }
}

async function loadSurvey() {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(WORKBOOK_PATH);
  const sheet = workbook.worksheets[0];
  if (!sheet) {
    throw new Error('Survey workbook contains no worksheet.');
  }
  validateHeaders(sheet);

  const facilities = [];
  const warnings = [];
  let currentDistrict = '';
  let currentSport = '';
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const values = Array.from({ length: 10 }, (_, index) => cellValue(row.getCell(index + 1)));
    if (values.slice(2).every((value) => value === '' || value === null)) {
      continue;
    }
    if (normalizeText(values[0])) {
      currentDistrict = normalizeText(values[0]);
    }
    if (normalizeText(values[1])) {
      currentSport = normalizeText(values[1]);
    }
    const name = normalizeText(values[2]);
    const address = normalizeText(values[3]);
    if (!name || !address || !currentDistrict || !currentSport) {
      throw new Error(`Excel row ${rowNumber}: missing district, sport, facility name, or address.`);
    }

    const district = DISTRICTS.find((candidate) => normalizeKey(candidate) === normalizeKey(currentDistrict));
    if (!district) {
      throw new Error(`Excel row ${rowNumber}: unknown district "${currentDistrict}".`);
    }
    const sportType = mapSport(currentSport, rowNumber);
    const mismatchedDistrict = findAddressDistrictMismatch(address, district);
    if (mismatchedDistrict) {
      warnings.push({
        row: rowNumber,
        field: 'district',
        message: `column A is "${district}" but address contains "${mismatchedDistrict}"; column A retained`
      });
    }
    const mapValue = cellValue(row.getCell(5));
    const ratingValue = cellValue(row.getCell(9));
    const priceValue = cellValue(row.getCell(10));
    facilities.push({
      rowNumber,
      name,
      address,
      district,
      sportType,
      mapUrl: parseMapUrl(mapValue, rowNumber, warnings),
      phone: normalizePhone(cellValue(row.getCell(6)), rowNumber, warnings),
      hours: parseOpeningHours(cellValue(row.getCell(7)), rowNumber),
      amenities: parseAmenities(cellValue(row.getCell(8))),
      rating: parseRating(ratingValue, rowNumber, warnings),
      price: parsePrice(priceValue, rowNumber, warnings)
    });
  }

  if (facilities.length !== 29) {
    throw new Error(`Expected 29 survey facilities; found ${facilities.length}.`);
  }
  const districts = new Set(facilities.map(({ district }) => district));
  if (districts.size !== 6) {
    throw new Error(`Expected 6 districts; found ${districts.size}.`);
  }
  const sportCounts = facilities.reduce((counts, facility) => {
    counts[facility.sportType] += 1;
    return counts;
  }, { BADMINTON: 0, FOOTBALL_MINI: 0, PICKLEBALL: 0 });
  for (const [sportType, expectedCount] of Object.entries(EXPECTED_SPORT_COUNTS)) {
    if (sportCounts[sportType] !== expectedCount) {
      throw new Error(`Expected ${expectedCount} ${sportType} facilities; found ${sportCounts[sportType]}.`);
    }
  }
  const invalidPrices = facilities.filter((facility) => facility.price === null);
  if (invalidPrices.length > 0) {
    throw new Error(`Cannot seed ${invalidPrices.length} facility prices; resolve the row warnings first.`);
  }
  return { facilities, warnings, sportCounts };
}

async function findFacility(connection, facility) {
  const identities = [
    ['district = ? AND name = ? AND address = ?', [facility.district, facility.name, facility.address]],
    ['district = ? AND name = ?', [facility.district, facility.name]],
    ['name = ? AND address = ?', [facility.name, facility.address]]
  ];
  for (const [condition, values] of identities) {
    const [rows] = await connection.execute(
      `SELECT id, is_seed
       FROM facilities
       WHERE ${condition}
       LIMIT 2`,
      values
    );
    if (rows.length > 1) {
      throw new Error(`Excel row ${facility.rowNumber}: facility identity matches multiple database rows.`);
    }
    if (rows.length === 1) {
      return rows[0];
    }
  }
  return null;
}

async function insertFacility(connection, facility) {
  const [result] = await connection.execute(
    `INSERT INTO facilities
       (name, address, district, opening_time, closing_time, hotline, map_url,
        amenities, image_url, is_active, is_seed, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, TRUE, FALSE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [
      facility.name,
      facility.address,
      facility.district,
      formatTime(facility.hours.openingMinutes),
      formatTime(facility.hours.closingMinutes),
      facility.phone,
      facility.mapUrl,
      JSON.stringify(facility.amenities)
    ]
  );
  return result.insertId;
}

async function updateFacility(connection, facilityRow, facility) {
  if (!facilityRow.is_seed) {
    return 0;
  }
  const [result] = await connection.execute(
    `UPDATE facilities
     SET name = ?, address = ?, district = ?, opening_time = ?, closing_time = ?,
         hotline = ?, map_url = ?, amenities = ?, updated_at = UTC_TIMESTAMP(3)
     WHERE id = ?
       AND is_seed = TRUE
       AND NOT (
         name <=> ? AND address <=> ? AND district <=> ?
         AND opening_time <=> ? AND closing_time <=> ?
         AND hotline <=> ? AND map_url <=> ? AND amenities <=> ?
       )`,
    [
      facility.name,
      facility.address,
      facility.district,
      formatTime(facility.hours.openingMinutes),
      formatTime(facility.hours.closingMinutes),
      facility.phone,
      facility.mapUrl,
      JSON.stringify(facility.amenities),
      facilityRow.id,
      facility.name,
      facility.address,
      facility.district,
      formatTime(facility.hours.openingMinutes),
      formatTime(facility.hours.closingMinutes),
      facility.phone,
      facility.mapUrl,
      JSON.stringify(facility.amenities)
    ]
  );
  return result.affectedRows;
}

async function findCourt(connection, facilityId, name) {
  const [rows] = await connection.execute(
    `SELECT id, is_seed
     FROM courts
     WHERE facility_id = ?
       AND (name = ? OR is_seed = TRUE)
     LIMIT 3`,
    [facilityId, name]
  );
  if (rows.length > 1) {
    throw new Error(`Facility ${facilityId}: multiple default courts match the survey seed.`);
  }
  if (rows.length === 1) {
    return rows[0];
  }
  const [existing] = await connection.execute(
    'SELECT id, is_seed FROM courts WHERE facility_id = ? LIMIT 2',
    [facilityId]
  );
  if (existing.length > 1) {
    throw new Error(`Facility ${facilityId}: cannot identify a default court without risking a duplicate.`);
  }
  return existing[0] || null;
}

async function updateCourt(connection, courtRow, facility) {
  if (!courtRow.is_seed) {
    return 0;
  }
  const [result] = await connection.execute(
    `UPDATE courts
     SET name = ?, sport_type = ?, price_normal = ?, price_peak = ?,
         survey_price_min = ?, survey_price_max = ?, initial_rating = ?,
         updated_at = UTC_TIMESTAMP(3)
     WHERE id = ?
       AND is_seed = TRUE
       AND NOT (
         name <=> ? AND sport_type <=> ? AND price_normal <=> ?
         AND price_peak <=> ? AND survey_price_min <=> ?
         AND survey_price_max <=> ? AND initial_rating <=> ?
       )`,
    [
      facility.name,
      facility.sportType,
      facility.price.normal,
      facility.price.peak,
      facility.price.minimum,
      facility.price.maximum,
      facility.rating,
      courtRow.id,
      facility.name,
      facility.sportType,
      facility.price.normal,
      facility.price.peak,
      facility.price.minimum,
      facility.price.maximum,
      facility.rating
    ]
  );
  return result.affectedRows;
}

async function insertCourt(connection, facility) {
  const [result] = await connection.execute(
    `INSERT INTO courts
       (facility_id, name, sport_type, price_normal, price_peak,
        survey_price_min, survey_price_max, initial_rating, is_active, is_seed,
        created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, TRUE, TRUE, UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))`,
    [
      facility.databaseId,
      facility.name,
      facility.sportType,
      facility.price.normal,
      facility.price.peak,
      facility.price.minimum,
      facility.price.maximum,
      facility.rating
    ]
  );
  return result.insertId;
}

async function seedTimeSlots(connection, courtId, facility, firstDate, updateExisting) {
  let inserted = 0;
  let existing = 0;
  let updated = 0;
  const lastDate = dateOffset(firstDate, 13);
  const [existingRows] = await connection.execute(
    `SELECT service_date, starts_at
     FROM time_slots
     WHERE court_id = ?
       AND service_date BETWEEN ? AND ?`,
    [courtId, firstDate, lastDate]
  );
  const existingSlots = new Set(
    existingRows.map((row) => `${databaseDate(row.service_date)}|${String(row.starts_at).slice(0, 8)}`)
  );
  for (let day = 0; day < 14; day += 1) {
    const serviceDate = dateOffset(firstDate, day);
    for (let start = facility.hours.openingMinutes; start < facility.hours.closingMinutes; start += 60) {
      const end = start + 60;
      const price = start >= 17 * 60 && start < 21 * 60
        ? facility.price.peak
        : facility.price.normal;
      const key = `${serviceDate}|${formatTime(start).slice(0, 8)}`;
      const alreadyExists = existingSlots.has(key);
      const onDuplicate = updateExisting
        ? `ON DUPLICATE KEY UPDATE
           updated_at = IF(status = 'AVAILABLE' AND NOT (price <=> VALUES(price)), UTC_TIMESTAMP(3), updated_at),
           price = IF(status = 'AVAILABLE' AND NOT (price <=> VALUES(price)), VALUES(price), price)`
        : 'ON DUPLICATE KEY UPDATE id = id';
      const [result] = await connection.execute(
        `INSERT INTO time_slots
           (court_id, service_date, starts_at, ends_at, price, status,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'AVAILABLE', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3))
         ${onDuplicate}`,
        [courtId, serviceDate, formatTime(start), formatTime(end), price]
      );
      if (alreadyExists) {
        if (result.affectedRows === 2) {
          updated += 1;
        } else {
          existing += 1;
        }
      } else {
        inserted += 1;
      }
    }
  }
  return { inserted, existing, updated };
}

async function seedFacilities(databaseName, survey) {
  const pool = getAllowedPool(databaseName);
  const connection = await pool.getConnection();
  const summary = {
    database: databaseName,
    facilitiesInserted: 0,
    facilitiesUpdated: 0,
    facilitiesMatched: 0,
    courtsInserted: 0,
    courtsUpdated: 0,
    courtsMatched: 0,
    slotsInserted: 0,
    slotsExisting: 0,
    slotsUpdated: 0
  };
  const localDate = getLocalDateParts(new Date());
  const firstDate = `${localDate.year}-${localDate.month}-${localDate.day}`;
  const lockName = `sportbooking_facilities_seed_${databaseName}`;
  let lockAcquired = false;

  try {
    const [lockRows] = await connection.execute('SELECT GET_LOCK(?, 10) AS acquired', [lockName]);
    if (Number(lockRows[0].acquired) !== 1) {
      throw new Error(`${databaseName}: could not acquire the facility seed lock.`);
    }
    lockAcquired = true;
    await connection.beginTransaction();
    for (const facility of survey.facilities) {
      let facilityRow = await findFacility(connection, facility);
      if (!facilityRow) {
        const facilityId = await insertFacility(connection, facility);
        facilityRow = { id: facilityId };
        summary.facilitiesInserted += 1;
      } else {
        summary.facilitiesMatched += 1;
        summary.facilitiesUpdated += await updateFacility(connection, facilityRow, facility);
      }
      facility.databaseId = facilityRow.id;

      let courtRow = await findCourt(connection, facility.databaseId, facility.name);
      if (!courtRow) {
        courtRow = { id: await insertCourt(connection, facility) };
        summary.courtsInserted += 1;
      } else {
        summary.courtsMatched += 1;
        summary.courtsUpdated += await updateCourt(connection, courtRow, facility);
      }

      const slots = await seedTimeSlots(connection, courtRow.id, facility, firstDate, Boolean(courtRow.is_seed));
      summary.slotsInserted += slots.inserted;
      summary.slotsExisting += slots.existing;
      summary.slotsUpdated += slots.updated;
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    if (lockAcquired) {
      await connection.execute('SELECT RELEASE_LOCK(?)', [lockName]);
    }
    connection.release();
    await pool.end();
  }
  return summary;
}

async function main() {
  const databaseName = readDatabaseTarget();
  const survey = await loadSurvey();
  const summary = await seedFacilities(databaseName, survey);
  console.log(`Seed summary: ${JSON.stringify(summary)}`);
  console.log(`Sport counts: ${JSON.stringify(survey.sportCounts)}`);
  if (survey.warnings.length === 0) {
    console.log('Data warnings: 0.');
  } else {
    console.log(`Data warnings: ${survey.warnings.length}.`);
    for (const warning of survey.warnings) {
      console.warn(`[WARN] Excel row ${warning.row}, ${warning.field}: ${warning.message}`);
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(`Facilities seed failed: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = {
  loadSurvey,
  parseOpeningHours,
  parsePrice,
  parseRating,
  parseMapUrl,
  normalizePhone,
  seedFacilities
};
