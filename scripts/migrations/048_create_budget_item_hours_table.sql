-- Migration 048: Create budget_item_hours for tracking person-hours per budget item

CREATE TABLE IF NOT EXISTS budget_item_hours (
  id INT AUTO_INCREMENT PRIMARY KEY,
  budget_item_id INT NOT NULL,
  user_id INT NOT NULL,
  hours DECIMAL(6, 1) NOT NULL DEFAULT 0 COMMENT 'Hours dedicated by this person',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (budget_item_id) REFERENCES budget_items(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,

  UNIQUE KEY uk_item_user (budget_item_id, user_id),
  INDEX idx_budget_item_hours_item (budget_item_id),
  INDEX idx_budget_item_hours_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
