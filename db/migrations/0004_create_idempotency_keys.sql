CREATE TABLE idempotency_keys (
  idempotency_key VARCHAR(255) NOT NULL,
  method VARCHAR(10) NOT NULL,
  path VARCHAR(500) NOT NULL,
  request_hash CHAR(64) NOT NULL,
  status ENUM('in_progress', 'completed') NOT NULL DEFAULT 'in_progress',
  response_status SMALLINT UNSIGNED NULL,
  response_body LONGTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  PRIMARY KEY (idempotency_key, method, path)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
