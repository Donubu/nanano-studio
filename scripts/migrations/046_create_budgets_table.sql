-- Migration 046: Create budgets table for Calculadora IA module

CREATE TABLE IF NOT EXISTS budgets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NULL,
  project_name VARCHAR(255) NOT NULL,
  created_by INT NOT NULL,
  status ENUM('draft', 'accepted', 'rejected') NOT NULL DEFAULT 'draft',
  status_note TEXT NULL,
  status_date DATETIME NULL,
  discount_amount DECIMAL(12, 0) NULL DEFAULT 0,
  discount_reason TEXT NULL,
  tech_fee_percent DECIMAL(5, 2) NOT NULL DEFAULT 0.05,
  subtotal DECIMAL(12, 0) NOT NULL DEFAULT 0,
  total DECIMAL(12, 0) NOT NULL DEFAULT 0,
  deleted_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,

  INDEX idx_budgets_client (client_id),
  INDEX idx_budgets_created_by (created_by),
  INDEX idx_budgets_status (status),
  INDEX idx_budgets_deleted_at (deleted_at),
  INDEX idx_budgets_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
