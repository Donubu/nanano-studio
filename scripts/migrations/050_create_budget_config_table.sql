-- Migration 050: Create budget_config table for calculator default values (replaces localStorage)

CREATE TABLE IF NOT EXISTS budget_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  config_key VARCHAR(100) NOT NULL UNIQUE,
  config_value JSON NOT NULL,
  updated_by INT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,

  INDEX idx_budget_config_key (config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Insert default configuration values
INSERT INTO budget_config (config_key, config_value) VALUES
  ('tech_fee', '0.05'),
  ('video', '{"basePlano": 300000, "lipSync": 0.20, "training": 0.15, "complejo": 0.10, "adaptacion": 0.10, "reduccion": 0.10}'),
  ('foto', '{"baseImagen": 100000, "training": 1.0, "capas": 0.50, "upscale": 100000, "retouch": {"b": 50000, "m": 100000, "c": 200000}}');
