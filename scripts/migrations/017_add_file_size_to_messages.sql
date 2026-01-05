-- Agregar columna para el tamaño del archivo de imagen
ALTER TABLE messages
ADD COLUMN image_file_size INT UNSIGNED NULL AFTER image_mime_type;
