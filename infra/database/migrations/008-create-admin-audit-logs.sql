CREATE TABLE admin_audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  admin_user_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(80) NOT NULL,
  resource_type VARCHAR(40) NOT NULL,
  resource_id BIGINT UNSIGNED NOT NULL,
  details LONGTEXT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY idx_admin_audit_resource (resource_type, resource_id),
  KEY idx_admin_audit_admin_created (admin_user_id, created_at),
  CONSTRAINT fk_admin_audit_logs_user
    FOREIGN KEY (admin_user_id) REFERENCES users (id)
) ENGINE=InnoDB
  DEFAULT CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;
