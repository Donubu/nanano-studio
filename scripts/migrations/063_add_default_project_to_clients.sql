ALTER TABLE clients ADD COLUMN default_project_id INT NULL,
  ADD CONSTRAINT fk_clients_default_project FOREIGN KEY (default_project_id) REFERENCES projects(id) ON DELETE SET NULL;
