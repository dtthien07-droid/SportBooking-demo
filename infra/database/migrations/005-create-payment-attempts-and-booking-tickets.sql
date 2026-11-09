CREATE TABLE payment_attempts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  payment_id BIGINT UNSIGNED NOT NULL,
  attempt_no INT UNSIGNED NOT NULL,
  method ENUM('BANK_TRANSFER', 'MOMO', 'DOMESTIC_ATM', 'INTERNATIONAL_CARD') NOT NULL,
  amount DECIMAL(12,0) NOT NULL,
  result ENUM('PROCESSING', 'SUCCEEDED', 'FAILED') NOT NULL,
  provider_reference VARCHAR(100) NULL,
  created_at DATETIME(3) NOT NULL,
  completed_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payment_attempts_payment_attempt_no (payment_id, attempt_no),
  KEY idx_payment_attempts_payment_created (payment_id, created_at),
  CONSTRAINT fk_payment_attempts_payment
    FOREIGN KEY (payment_id) REFERENCES payments (id)
    ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE TABLE booking_tickets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id BIGINT UNSIGNED NOT NULL,
  qr_code VARCHAR(80) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_booking_tickets_booking (booking_id),
  UNIQUE KEY uq_booking_tickets_qr_code (qr_code),
  CONSTRAINT fk_booking_tickets_booking
    FOREIGN KEY (booking_id) REFERENCES bookings (id)
    ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
