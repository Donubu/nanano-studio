-- Migration 054: Add ai_summary column to budgets

ALTER TABLE budgets
  ADD COLUMN ai_summary TEXT NULL AFTER detail;
