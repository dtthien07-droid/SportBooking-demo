'use strict';

function escapeLike(value) {
  return value.replace(/[!%_]/g, (character) => `!${character}`);
}

function createFacilitiesRepository(pool) {
  if (!pool || typeof pool.execute !== 'function') {
    throw new TypeError('A MySQL-compatible pool is required.');
  }

  function buildListQuery(filters) {
    const conditions = ['f.is_active = TRUE', 'c.is_active = TRUE'];
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

    return {
      from: `FROM facilities f
             INNER JOIN courts c ON c.facility_id = f.id`,
      where: `WHERE ${conditions.join(' AND ')}`,
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
      const offset = (filters.page - 1) * filters.pageSize;
      const [rows] = await pool.execute(
        `SELECT f.id, f.name, f.address, f.district, f.opening_time, f.closing_time,
                f.hotline, f.latitude, f.longitude, f.map_url, f.description,
                f.amenities, f.image_url,
                MIN(LEAST(c.price_normal, c.price_peak)) AS price_min,
                MAX(GREATEST(c.price_normal, c.price_peak)) AS price_max,
                AVG(c.initial_rating) AS rating,
                GROUP_CONCAT(DISTINCT c.sport_type ORDER BY c.sport_type SEPARATOR ',') AS sport_types
         ${query.from}
         ${query.where}
         GROUP BY f.id
         ORDER BY f.name ASC, f.id ASC
         LIMIT ? OFFSET ?`,
        [...query.parameters, filters.pageSize, offset]
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
                cancellation_policy, image_url
         FROM facilities
         WHERE id = ? AND is_active = TRUE
         LIMIT 1`,
        [id]
      );
      if (facilityRows.length === 0) {
        return null;
      }

      const [courtRows] = await pool.execute(
        `SELECT id, name, sport_type, price_normal, price_peak,
                survey_price_min, survey_price_max, initial_rating, description
         FROM courts
         WHERE facility_id = ? AND is_active = TRUE
         ORDER BY id ASC`,
        [id]
      );
      return { facility: facilityRows[0], courts: courtRows };
    },

    async findCourtTimeSlots(id, serviceDate) {
      const [rows] = await pool.execute(
        `SELECT c.id AS court_id,
                ts.id, DATE_FORMAT(ts.service_date, '%Y-%m-%d') AS service_date,
                TIME_FORMAT(ts.starts_at, '%H:%i:%s') AS starts_at,
                TIME_FORMAT(ts.ends_at, '%H:%i:%s') AS ends_at, ts.price,
                ts.status, ts.lock_expires_at,
                UTC_TIMESTAMP(3) AS now_utc,
                CASE
                  WHEN ts.status = 'LOCKED'
                       AND ts.lock_expires_at IS NOT NULL
                       AND ts.lock_expires_at <= UTC_TIMESTAMP(3)
                  THEN 1 ELSE 0
                END AS lock_expired
         FROM courts c
         INNER JOIN facilities f ON f.id = c.facility_id
         LEFT JOIN time_slots ts
           ON ts.court_id = c.id AND ts.service_date = ?
         WHERE c.id = ? AND c.is_active = TRUE AND f.is_active = TRUE
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
