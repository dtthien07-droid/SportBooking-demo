CREATE TABLE bookings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_code VARCHAR(40) NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  status ENUM('PENDING', 'CONFIRMED', 'CANCELLED', 'EXPIRED', 'COMPLETED') NOT NULL,
  total_amount DECIMAL(12,0) NOT NULL,
  lock_expires_at DATETIME(3) NULL,
  cancelled_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bookings_booking_code (booking_code),
  KEY idx_bookings_user_status_created (user_id, status, created_at),
  KEY idx_bookings_status_lock_expires (status, lock_expires_at),
  CONSTRAINT fk_bookings_user
    FOREIGN KEY (user_id) REFERENCES users (id)
    ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE TABLE booking_slots (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id BIGINT UNSIGNED NOT NULL,
  time_slot_id BIGINT UNSIGNED NOT NULL,
  court_id BIGINT UNSIGNED NOT NULL,
  price_at_booking DECIMAL(12,0) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_booking_slots_booking_time_slot (booking_id, time_slot_id),
  KEY idx_booking_slots_time_slot_booking (time_slot_id, booking_id),
  KEY idx_booking_slots_court_time_slot (court_id, time_slot_id),
  CONSTRAINT fk_booking_slots_booking
    FOREIGN KEY (booking_id) REFERENCES bookings (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_booking_slots_time_slot
    FOREIGN KEY (time_slot_id) REFERENCES time_slots (id)
    ON DELETE RESTRICT,
  CONSTRAINT fk_booking_slots_court
    FOREIGN KEY (court_id) REFERENCES courts (id)
    ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

ALTER TABLE time_slots
  ADD CONSTRAINT fk_time_slots_current_booking
  FOREIGN KEY (current_booking_id) REFERENCES bookings (id)
  ON DELETE RESTRICT;
