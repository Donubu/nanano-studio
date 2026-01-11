-- Migration: Create GCP daily costs table for storing billing data from BigQuery
-- This table stores aggregated daily costs by service/SKU from Google Cloud Platform

CREATE TABLE IF NOT EXISTS gcp_daily_costs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  cost_date DATE NOT NULL,
  service_id VARCHAR(100) NOT NULL,
  service_description VARCHAR(255) NOT NULL,
  sku_id VARCHAR(100),
  sku_description VARCHAR(500),
  project_id VARCHAR(100),
  location VARCHAR(100),
  cost DECIMAL(12, 6) NOT NULL DEFAULT 0,
  credits DECIMAL(12, 6) NOT NULL DEFAULT 0,
  net_cost DECIMAL(12, 6) NOT NULL DEFAULT 0,
  usage_amount DECIMAL(18, 6),
  usage_unit VARCHAR(50),
  currency VARCHAR(10) DEFAULT 'USD',
  synced_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Unique constraint to allow UPSERT (replace on duplicate)
  UNIQUE KEY uk_date_service_sku (cost_date, service_id, sku_id),

  -- Indexes for common queries
  INDEX idx_cost_date (cost_date),
  INDEX idx_service (service_id),
  INDEX idx_net_cost (net_cost),
  INDEX idx_synced_at (synced_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Table to track sync status
CREATE TABLE IF NOT EXISTS gcp_sync_log (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sync_date DATE NOT NULL,
  records_synced INT NOT NULL DEFAULT 0,
  total_cost DECIMAL(12, 6) NOT NULL DEFAULT 0,
  status ENUM('success', 'error', 'partial') NOT NULL DEFAULT 'success',
  error_message TEXT,
  started_at TIMESTAMP NOT NULL,
  completed_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_sync_date (sync_date),
  INDEX idx_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
