-- Migration 104: Users exempt from credit limits within a client
-- Un usuario en client_credit_exceptions con unlimited=1 se salta los límites del cliente.
-- No es lo mismo que ser admin: el usuario sigue teniendo sus permisos normales,
-- solo está exento del sistema de cuotas mensuales para este cliente específico.

CREATE TABLE client_credit_exceptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  user_id INT NOT NULL,
  unlimited TINYINT(1) NOT NULL DEFAULT 1
    COMMENT '1 = salta los límites del cliente',
  reason VARCHAR(255) NULL,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uniq_client_user (client_id, user_id),
  INDEX idx_client (client_id),
  INDEX idx_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
