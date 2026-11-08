CREATE TABLE facilities (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(160) NOT NULL,
  address VARCHAR(500) NOT NULL,
  district VARCHAR(120) NOT NULL,
  opening_time TIME NULL,
  closing_time TIME NULL,
  hotline VARCHAR(30) NULL,
  latitude DECIMAL(10,7) NULL,
  longitude DECIMAL(10,7) NULL,
  map_url VARCHAR(1000) NULL,
  description TEXT NULL,
  amenities LONGTEXT NOT NULL,
  rules TEXT NULL,
  cancellation_policy TEXT NULL,
  image_url VARCHAR(1000) NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_facilities_district_active (district, is_active),
  KEY idx_facilities_active_name (is_active, name),
  CONSTRAINT chk_facilities_amenities_json CHECK (JSON_VALID(amenities))
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE TABLE courts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  facility_id BIGINT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  sport_type ENUM('FOOTBALL_MINI', 'BADMINTON', 'PICKLEBALL') NOT NULL,
  price_normal DECIMAL(12,0) NOT NULL,
  price_peak DECIMAL(12,0) NOT NULL,
  survey_price_min DECIMAL(12,0) NULL,
  survey_price_max DECIMAL(12,0) NULL,
  initial_rating DECIMAL(2,1) NULL,
  description TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_seed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_courts_sport_active (sport_type, is_active),
  KEY idx_courts_facility_active (facility_id, is_active),
  CONSTRAINT fk_courts_facility
    FOREIGN KEY (facility_id) REFERENCES facilities (id)
    ON DELETE CASCADE,
  CONSTRAINT chk_courts_initial_rating
    CHECK (initial_rating IS NULL OR initial_rating BETWEEN 1.0 AND 5.0)
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE TABLE time_slots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  court_id BIGINT UNSIGNED NOT NULL,
  service_date DATE NOT NULL,
  starts_at TIME NOT NULL,
  ends_at TIME NOT NULL,
  price DECIMAL(12,0) NOT NULL,
  status ENUM('AVAILABLE', 'LOCKED', 'BOOKED') NOT NULL DEFAULT 'AVAILABLE',
  current_booking_id BIGINT UNSIGNED NULL,
  lock_expires_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_time_slots_court_date_start (court_id, service_date, starts_at),
  KEY idx_time_slots_date_status_court (service_date, status, court_id),
  KEY idx_time_slots_current_booking (current_booking_id),
  CONSTRAINT fk_time_slots_court
    FOREIGN KEY (court_id) REFERENCES courts (id)
    ON DELETE CASCADE
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
