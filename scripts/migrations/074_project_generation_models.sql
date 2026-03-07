-- Nueva tabla: N modelos por tipo de generacion por proyecto (reemplaza columnas fijas normal/hq/chirp)
CREATE TABLE IF NOT EXISTS project_generation_models (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  generation_type ENUM('text','image','video','audio','music') NOT NULL,
  model_id INT NOT NULL,
  label VARCHAR(50) NOT NULL DEFAULT '',
  sort_order INT NOT NULL DEFAULT 0,
  is_default TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (model_id) REFERENCES models(id),
  UNIQUE KEY uq_project_type_model (project_id, generation_type, model_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migrar datos existentes de project_generation_config a project_generation_models
-- Normal models (sort_order=0, is_default=1)
INSERT IGNORE INTO project_generation_models (project_id, generation_type, model_id, label, sort_order, is_default)
SELECT project_id, generation_type, model_normal_id, 'Normal', 0, 1
FROM project_generation_config
WHERE model_normal_id IS NOT NULL;

-- HQ models (sort_order=1, is_default=0)
INSERT IGNORE INTO project_generation_models (project_id, generation_type, model_id, label, sort_order, is_default)
SELECT project_id, generation_type, model_hq_id, 'HQ', 1, 0
FROM project_generation_config
WHERE model_hq_id IS NOT NULL;

-- Chirp models (sort_order=2, is_default=0)
INSERT IGNORE INTO project_generation_models (project_id, generation_type, model_id, label, sort_order, is_default)
SELECT project_id, generation_type, model_chirp_id, 'Chirp HD', 2, 0
FROM project_generation_config
WHERE model_chirp_id IS NOT NULL;
