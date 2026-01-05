-- Tabla de asociación entre proyectos y modelos disponibles
CREATE TABLE IF NOT EXISTS project_models (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  model_id INT NOT NULL,
  is_default BOOLEAN DEFAULT FALSE COMMENT 'Modelo por defecto para el proyecto',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE,
  UNIQUE KEY unique_project_model (project_id, model_id)
);

-- Índice para buscar modelos de un proyecto
CREATE INDEX idx_project_models_project ON project_models(project_id);
