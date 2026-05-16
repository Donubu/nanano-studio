-- Migration 109: Allow project-scoped brand kits.
-- Brand kits are still owned by a client (client_id is required), but can
-- optionally be scoped to a single production_project so that "custom tokens
-- for this project" added from the editor don't leak to other projects of
-- the same client. NULL project_id = client-wide kit (default).

ALTER TABLE production_brand_kits
  ADD COLUMN production_project_id INT NULL AFTER client_id,
  ADD CONSTRAINT fk_prodbk_project
    FOREIGN KEY (production_project_id)
    REFERENCES production_projects(id)
    ON DELETE CASCADE,
  ADD INDEX idx_prodbk_project (production_project_id);
