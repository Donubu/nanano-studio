ALTER TABLE projects ADD COLUMN is_personal TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN owner_user_id INT NULL;
ALTER TABLE projects ADD INDEX idx_owner_user_id (owner_user_id);
ALTER TABLE projects ADD CONSTRAINT fk_projects_owner_user FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL;
