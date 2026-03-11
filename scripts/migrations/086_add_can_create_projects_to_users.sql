-- Allow specific users to create projects without admin role
ALTER TABLE users ADD COLUMN can_create_projects TINYINT(1) NOT NULL DEFAULT 0 AFTER ai_calculator_access;
