-- Agregar soporte de generación de imágenes a modelos
ALTER TABLE models
ADD COLUMN supports_image_generation TINYINT(1) DEFAULT 0 AFTER supports_video;

-- Actualizar modelos que soportan generación de imágenes
-- gemini-2.0-flash-exp soporta generación de imágenes
UPDATE models SET supports_image_generation = 1 WHERE model_id LIKE '%gemini-2.0-flash-exp%';
UPDATE models SET supports_image_generation = 1 WHERE model_id LIKE '%imagen%';

-- Verificar cambios
SELECT model_id, display_name, supports_image_generation FROM models;
