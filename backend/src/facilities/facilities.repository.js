'use strict';

const { TIME_BANDS, selectableSlotPredicate } = require('./slot-availability');

function escapeLike(value) {
  return value.replace(/[!%_]/g, (character) => `!${character}`);
}

function createFacilitiesRepository(pool) {
  if (!pool || typeof pool.execute !== 'function') {
    throw new TypeError('A MySQL-compatible pool is required.');
  }

  function buildListQuery(filters) {
    const conditions = ['f.is_active = TRUE'];
    const parameters = [];

    if (filters.sport) {
      conditions.push('c.sport_type = ?');
      parameters.push(filters.sport);
    }
    if (filters.district) {
      conditions.push('f.district = ?');
      parameters.push(filters.district);
    }
    if (filters.q) {
      const search = `%${escapeLike(filters.q)}%`;
      conditions.push("(f.name LIKE ? ESCAPE '!' OR f.address LIKE ? ESCAPE '!')");
      parameters.push(search, search);
    }
    if (filters.date || filters.timeBands.length > 0) {
      const slotConditions = [
        'availability_c.facility_id = f.id',
        selectableSlotPredicate('availability_ts', 'availability_c', 'f')
      ];
      if (filters.sport) {
        slotConditions.push('availability_c.sport_type = ?');
        parameters.push(filters.sport);
      }
      if (filters.date) {
        slotConditions.push('availability_ts.service_date = ?');
        parameters.push(filters.date);
      } else {
        slotConditions.push(`availability_ts.service_date >=
          DATE(DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 HOUR))`);
        slotConditions.push(`availability_ts.service_date <
          DATE_ADD(DATE(DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 HOUR)), INTERVAL 14 DAY)`);
      }
      if (filters.timeBands.length > 0) {
        const timeBandConditions = filters.timeBands.map(() => (
          '(availability_ts.starts_at >= ? AND availability_ts.starts_at < ?)'
        ));
        slotConditions.push(`(${timeBandConditions.join(' OR ')})`);
        for (const timeBand of filters.timeBands) {
          parameters.push(...TIME_BANDS[timeBand]);
        }
      }
      conditions.push(`EXISTS (
        SELECT 1
        FROM courts availability_c
        INNER JOIN time_slots availability_ts
          ON availability_ts.court_id = availability_c.id
        WHERE ${slotConditions.join(' AND ')}
      )`);
    }

    return {
      from: `FROM facilities f
             INNER JOIN courts c ON c.facility_id = f.id AND c.is_active = TRUE`,
      where: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '',
      parameters
    };
  }

  return {
    async listFacilities(filters) {
      const query = buildListQuery(filters);
      const [countRows] = await pool.execute(
        `SELECT COUNT(DISTINCT f.id) AS total
         ${query.from}
         ${query.where}`,
        query.parameters
      );
      const parsedLimit = Number.parseInt(filters.pageSize, 10);
      const safeLimit = Number.isSafeInteger(parsedLimit) && parsedLimit > 0
        ? Math.min(parsedLimit, 100)
        : 20;
      const parsedPage = Number.parseInt(filters.page, 10);
      const parsedOffset = Number.parseInt((parsedPage - 1) * safeLimit, 10);
      const safeOffset = Number.isSafeInteger(parsedOffset) && parsedOffset >= 0
        ? parsedOffset
        : 0;
      const [rows] = await pool.execute(
        `SELECT f.id, f.name, f.address, f.district, f.opening_time, f.closing_time,
                f.hotline, f.latitude, f.longitude, f.map_url, f.description,
                f.amenities, f.image_url, f.is_active,
               (SELECT COUNT(*) FROM courts all_c WHERE all_c.facility_id = f.id) AS court_count,
               COUNT(DISTINCT c.id) AS active_court_count,
                MIN(LEAST(c.price_normal, c.price_peak)) AS price_min,
                MAX(GREATEST(c.price_normal, c.price_peak)) AS price_max,
                AVG(c.initial_rating) AS rating,
                GROUP_CONCAT(DISTINCT c.sport_type ORDER BY c.sport_type SEPARATOR ',') AS sport_types
         ${query.from}
         ${query.where}
         GROUP BY f.id
         ORDER BY f.is_active DESC, f.name ASC, f.id ASC
         LIMIT ${safeLimit} OFFSET ${safeOffset}`,
        query.parameters
      );
      return {
        rows,
        total: Number(countRows[0].total)
      };
    },

    async findFacility(id) {
      const [facilityRows] = await pool.execute(
        `SELECT id, name, address, district, opening_time, closing_time, hotline,
                latitude, longitude, map_url, description, amenities, rules,
                cancellation_policy, image_url, is_active
         FROM facilities
        WHERE id = ?
          AND is_active = TRUE
          AND EXISTS (
            SELECT 1 FROM courts active_c
            WHERE active_c.facility_id = facilities.id AND active_c.is_active = TRUE
          )
         LIMIT 1`,
        [id]
      );
      if (facilityRows.length === 0) {
        return null;
      }

      const [courtRows] = await pool.execute(
        `SELECT id, name, sport_type, price_normal, price_peak,
                survey_price_min, survey_price_max, initial_rating, description, is_active
         FROM courts
         WHERE facility_id = ?
         ORDER BY id ASC`,
        [id]
      );
      return { facility: facilityRows[0], courts: courtRows };
    },

    async findCourtTimeSlots(id, serviceDate) {
      const [rows] = await pool.execute(
        `SELECT c.id AS court_id, c.is_active AS court_is_active,
                f.is_active AS facility_is_active,
                f.opening_time, f.closing_time,
                ts.id, DATE_FORMAT(ts.service_date, '%Y-%m-%d') AS service_date,
                TIME_FORMAT(ts.starts_at, '%H:%i:%s') AS starts_at,
                TIME_FORMAT(ts.ends_at, '%H:%i:%s') AS ends_at, ts.price,
                ts.status, ts.lock_expires_at,
                CASE
                  WHEN ts.status = 'LOCKED'
                       AND ts.lock_expires_at IS NOT NULL
                       AND ts.lock_expires_at <= UTC_TIMESTAMP(3)
                  THEN 1 ELSE 0
                END AS lock_expired,
                CASE WHEN ${selectableSlotPredicate('ts', 'c', 'f')}
                     THEN 1 ELSE 0
                END AS is_selectable
         FROM courts c
         INNER JOIN facilities f ON f.id = c.facility_id
         LEFT JOIN time_slots ts
           ON ts.court_id = c.id AND ts.service_date = ?
         WHERE c.id = ?
         ORDER BY ts.starts_at ASC`,
        [serviceDate, id]
      );
      if (rows.length === 0) {
        return null;
      }
      return rows;
    }
  };
}

module.exports = createFacilitiesRepository;
