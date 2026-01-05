-- Agregar configuración de generación de imágenes a las conversaciones
ALTER TABLE conversations
ADD COLUMN image_aspect_ratio VARCHAR(10) DEFAULT '1:1' AFTER max_output_tokens,
ADD COLUMN image_size VARCHAR(5) DEFAULT '1K' AFTER image_aspect_ratio;

-- Verificar cambios
DESCRIBE conversations;
