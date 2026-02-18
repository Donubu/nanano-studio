-- Migration 051: Add detail field and discount_type to budgets

ALTER TABLE budgets
  ADD COLUMN detail TEXT NULL AFTER project_name,
  ADD COLUMN discount_type ENUM('amount', 'percent') DEFAULT 'amount' AFTER discount_amount;
