-- Migration 049: Create external cost tables for budget items and budgets

-- External costs per budget item
CREATE TABLE IF NOT EXISTS budget_item_externals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  budget_item_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  amount DECIMAL(12, 0) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (budget_item_id) REFERENCES budget_items(id) ON DELETE CASCADE,

  INDEX idx_bie_item (budget_item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Global external costs per budget
CREATE TABLE IF NOT EXISTS budget_externals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  budget_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  amount DECIMAL(12, 0) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (budget_id) REFERENCES budgets(id) ON DELETE CASCADE,

  INDEX idx_be_budget (budget_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
