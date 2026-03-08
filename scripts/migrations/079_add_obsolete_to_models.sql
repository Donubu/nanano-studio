-- Add obsolete flag to models
ALTER TABLE models ADD COLUMN is_obsolete BOOLEAN NOT NULL DEFAULT FALSE AFTER is_active;
ALTER TABLE models ADD COLUMN replaced_by_model_id INT NULL AFTER is_obsolete;
ALTER TABLE models ADD CONSTRAINT fk_models_replaced_by FOREIGN KEY (replaced_by_model_id) REFERENCES models(id) ON DELETE SET NULL;
