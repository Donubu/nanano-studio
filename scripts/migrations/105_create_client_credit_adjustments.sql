-- Migration 105: Top-ups / ajustes mensuales de cuota por cliente
-- Permite sumar (o restar) generaciones a la cuota base de un cliente para un mes específico.
-- delta > 0 = créditos adicionales; delta < 0 = corrección negativa.

CREATE TABLE client_credit_adjustments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  period_year SMALLINT NOT NULL,
  period_month TINYINT NOT NULL COMMENT '1-12',
  generation_type ENUM('image','video') NOT NULL,
  delta INT NOT NULL COMMENT 'Positivo = agregar, negativo = quitar',
  reason VARCHAR(255) NULL,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_period (client_id, period_year, period_month, generation_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
