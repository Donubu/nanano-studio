-- Migration 041: Fix usage_amount column range in gcp_daily_costs
-- The original DECIMAL(18, 6) is not sufficient for large usage values from GCP
-- (e.g., bytes, request counts, etc.)

ALTER TABLE gcp_daily_costs
  MODIFY COLUMN usage_amount DOUBLE NULL
  COMMENT 'Usage amount (can be very large for bytes/requests)';
