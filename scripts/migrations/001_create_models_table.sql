-- Tabla de modelos de IA disponibles
CREATE TABLE IF NOT EXISTS models (
  id INT AUTO_INCREMENT PRIMARY KEY,
  model_id VARCHAR(255) NOT NULL UNIQUE COMMENT 'ID del modelo en Vertex AI (ej: models/gemini-2.5-flash)',
  display_name VARCHAR(255) NOT NULL COMMENT 'Nombre para mostrar (ej: Nano Banana Pro)',
  description TEXT NULL,
  is_active BOOLEAN DEFAULT TRUE,
  supports_images BOOLEAN DEFAULT FALSE,
  supports_audio BOOLEAN DEFAULT FALSE,
  supports_video BOOLEAN DEFAULT FALSE,
  max_tokens INT DEFAULT 8192,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Insertar modelos iniciales
INSERT INTO models (model_id, display_name, description, supports_images) VALUES
('models/gemini-3-pro-image-preview', 'Nano Banana Pro', 'Modelo más potente con soporte de imágenes', TRUE),
('models/gemini-2.5-flash-image', 'Nano Banana', 'Modelo rápido con soporte de imágenes', TRUE),
('models/gemini-2.5-flash', 'Nano Banana Flash', 'Modelo rápido para texto', FALSE),
('models/gemini-2.5-flash-lite', 'Nano Banana Lite', 'Modelo ligero y económico', FALSE),
('models/gemini-3-flash-preview', 'Nano Banana 3 Flash', 'Preview del nuevo modelo flash', FALSE);
