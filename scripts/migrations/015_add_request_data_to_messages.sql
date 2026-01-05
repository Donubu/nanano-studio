-- Agregar campo para guardar el request enviado al modelo
ALTER TABLE messages
ADD COLUMN request_data JSON NULL AFTER image_mime_type;

-- Verificar cambios
DESCRIBE messages;
