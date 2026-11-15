'use strict';

const MINIMUM_LEAD_TIME_MINUTES = 15;
const TIME_BANDS = Object.freeze({
  morning: Object.freeze(['05:00:00', '12:00:00']),
  afternoon: Object.freeze(['12:00:00', '17:00:00']),
  evening: Object.freeze(['17:00:00', '22:00:00']),
  night: Object.freeze(['22:00:00', '24:00:00'])
});

function selectableSlotPredicate(slotAlias, courtAlias, facilityAlias) {
  for (const alias of [slotAlias, courtAlias, facilityAlias]) {
    if (typeof alias !== 'string' || !/^[a-z][a-z0-9_]*$/.test(alias)) {
      throw new TypeError('Invalid SQL alias for slot availability.');
    }
  }

  return `(
    (${slotAlias}.status = 'AVAILABLE'
      OR (${slotAlias}.status = 'LOCKED'
        AND ${slotAlias}.lock_expires_at IS NOT NULL
        AND ${slotAlias}.lock_expires_at <= UTC_TIMESTAMP(3)))
    AND ${courtAlias}.is_active = TRUE
    AND ${facilityAlias}.is_active = TRUE
    AND (${facilityAlias}.opening_time IS NULL
      OR ${slotAlias}.starts_at >= ${facilityAlias}.opening_time)
    AND (${facilityAlias}.closing_time IS NULL
      OR ${slotAlias}.ends_at <= ${facilityAlias}.closing_time)
    AND TIMESTAMP(${slotAlias}.service_date, ${slotAlias}.starts_at)
      >= DATE_ADD(DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 7 HOUR),
        INTERVAL ${MINIMUM_LEAD_TIME_MINUTES} MINUTE)
  )`;
}

module.exports = { MINIMUM_LEAD_TIME_MINUTES, TIME_BANDS, selectableSlotPredicate };
