ALTER TABLE bookings
  ADD COLUMN cancelled_by ENUM('USER', 'ADMIN') NULL;

ALTER TABLE bookings
  ADD COLUMN cancellation_reason VARCHAR(500) NULL;

ALTER TABLE bookings
  ADD COLUMN cancelled_at DATETIME(3) NULL;
