-- Agregar soporte para imágenes en mensajes
ALTER TABLE messages
ADD COLUMN content_type ENUM('text', 'image', 'mixed') DEFAULT 'text' AFTER role,
ADD COLUMN image_url TEXT NULL AFTER content,
ADD COLUMN image_mime_type VARCHAR(50) NULL AFTER image_url;

-- Índice para filtrar por tipo de contenido si es necesario
CREATE INDEX idx_messages_content_type ON messages(content_type);
