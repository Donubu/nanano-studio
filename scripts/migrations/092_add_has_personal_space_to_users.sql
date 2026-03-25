ALTER TABLE users ADD COLUMN has_personal_space TINYINT(1) NOT NULL DEFAULT 0 AFTER can_create_projects;
