-- Migration 031: Project generation type configuration
-- Adds configuration for enabled generation types and their normal/HQ models per project

-- Nueva tabla para configurar tipos de generacion habilitados por proyecto
CREATE TABLE IF NOT EXISTS project_generation_config (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  generation_type ENUM('text', 'image', 'video', 'audio') NOT NULL,
  is_enabled TINYINT(1) DEFAULT 1 COMMENT 'Si este tipo de generacion esta habilitado',
  model_normal_id INT NULL COMMENT 'Modelo para calidad normal',
  model_hq_id INT NULL COMMENT 'Modelo para calidad HQ',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (model_normal_id) REFERENCES models(id) ON DELETE SET NULL,
  FOREIGN KEY (model_hq_id) REFERENCES models(id) ON DELETE SET NULL,
  UNIQUE KEY unique_project_type (project_id, generation_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Indices para consultas rapidas
CREATE INDEX idx_project_gen_config_project ON project_generation_config(project_id);
CREATE INDEX idx_project_gen_config_type ON project_generation_config(generation_type);
CREATE INDEX idx_project_gen_config_enabled ON project_generation_config(is_enabled);

-- Migrar proyectos existentes: crear configuracion por defecto basada en project_models actuales
-- Para cada proyecto, detectar que tipos de generacion tienen disponibles y asignar un modelo

-- Configuracion de IMAGEN para proyectos que tienen modelos de imagen
INSERT INTO project_generation_config (project_id, generation_type, is_enabled, model_normal_id, model_hq_id)
SELECT DISTINCT
  pm.project_id,
  'image' as generation_type,
  1 as is_enabled,
  (SELECT MIN(m2.id) FROM models m2
   JOIN project_models pm2 ON m2.id = pm2.model_id
   WHERE pm2.project_id = pm.project_id AND m2.supports_image_generation = 1 AND m2.is_active = 1) as model_normal_id,
  NULL as model_hq_id
FROM project_models pm
JOIN models m ON pm.model_id = m.id
WHERE m.supports_image_generation = 1 AND m.is_active = 1
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;

-- Configuracion de VIDEO para proyectos que tienen modelos de video
INSERT INTO project_generation_config (project_id, generation_type, is_enabled, model_normal_id, model_hq_id)
SELECT DISTINCT
  pm.project_id,
  'video' as generation_type,
  1 as is_enabled,
  (SELECT MIN(m2.id) FROM models m2
   JOIN project_models pm2 ON m2.id = pm2.model_id
   WHERE pm2.project_id = pm.project_id AND m2.supports_video_generation = 1 AND m2.is_active = 1) as model_normal_id,
  NULL as model_hq_id
FROM project_models pm
JOIN models m ON pm.model_id = m.id
WHERE m.supports_video_generation = 1 AND m.is_active = 1
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;

-- Configuracion de AUDIO para proyectos que tienen modelos de audio
INSERT INTO project_generation_config (project_id, generation_type, is_enabled, model_normal_id, model_hq_id)
SELECT DISTINCT
  pm.project_id,
  'audio' as generation_type,
  1 as is_enabled,
  (SELECT MIN(m2.id) FROM models m2
   JOIN project_models pm2 ON m2.id = pm2.model_id
   WHERE pm2.project_id = pm.project_id AND m2.supports_audio_generation = 1 AND m2.is_active = 1) as model_normal_id,
  NULL as model_hq_id
FROM project_models pm
JOIN models m ON pm.model_id = m.id
WHERE m.supports_audio_generation = 1 AND m.is_active = 1
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;

-- Configuracion de TEXTO para todos los proyectos (usando modelos que NO son de generacion especifica)
INSERT INTO project_generation_config (project_id, generation_type, is_enabled, model_normal_id, model_hq_id)
SELECT DISTINCT
  pm.project_id,
  'text' as generation_type,
  1 as is_enabled,
  (SELECT MIN(m2.id) FROM models m2
   JOIN project_models pm2 ON m2.id = pm2.model_id
   WHERE pm2.project_id = pm.project_id
   AND m2.is_active = 1
   AND COALESCE(m2.supports_image_generation, 0) = 0
   AND COALESCE(m2.supports_video_generation, 0) = 0
   AND COALESCE(m2.supports_audio_generation, 0) = 0) as model_normal_id,
  NULL as model_hq_id
FROM project_models pm
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;
