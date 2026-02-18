-- Migration 047: Create budget_items table for individual line items in a budget

CREATE TABLE IF NOT EXISTS budget_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  budget_id INT NOT NULL,
  type ENUM('video', 'photo') NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  mode ENUM('dias_habiles', 'horas_hombre') NOT NULL DEFAULT 'dias_habiles',
  dias_habiles INT NULL DEFAULT 1 COMMENT 'Used when mode = dias_habiles',
  item_data JSON NOT NULL COMMENT 'Type-specific config (planos, lip-sync, imagenes, retoque, etc.)',
  subtotal DECIMAL(12, 0) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE,

  INDEX idx_budget_items_budget (budget_id),
  INDEX idx_budget_items_sort (budget_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
