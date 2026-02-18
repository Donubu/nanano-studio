ALTER TABLE users
  ADD COLUMN cargo VARCHAR(100) DEFAULT 'Sin definir' AFTER role,
  ADD COLUMN ai_calculator_access TINYINT(1) DEFAULT 0 AFTER cargo;
