-- Migration 052: Add cost_breakdown JSON to budget_items and clear existing budgets

-- Clear existing budget data (config values may have changed)
DELETE FROM budget_item_hours;
DELETE FROM budget_item_externals;
DELETE FROM budget_externals;
DELETE FROM budget_items;
DELETE FROM budgets;

-- Add cost breakdown column
ALTER TABLE budget_items
  ADD COLUMN cost_breakdown JSON NULL AFTER subtotal;
