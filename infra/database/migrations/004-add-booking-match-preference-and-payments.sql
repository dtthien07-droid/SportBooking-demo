ALTER TABLE bookings
  ADD COLUMN match_preference JSON NULL;

CREATE TABLE payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  booking_id BIGINT UNSIGNED NOT NULL,
  status ENUM('PENDING', 'PAID', 'REFUNDED') NOT NULL,
  amount_due DECIMAL(12,0) NOT NULL,
  paid_amount DECIMAL(12,0) NOT NULL DEFAULT 0,
  refunded_amount DECIMAL(12,0) NOT NULL DEFAULT 0,
  payment_option ENUM('DEPOSIT_50', 'FULL') NOT NULL,
  paid_at DATETIME(3) NULL,
  refunded_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_payments_booking (booking_id),
  KEY idx_payments_status_updated (status, updated_at),
  CONSTRAINT fk_payments_booking
    FOREIGN KEY (booking_id) REFERENCES bookings (id)
    ON DELETE RESTRICT
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
