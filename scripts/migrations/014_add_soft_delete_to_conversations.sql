-- Agregar soft delete a conversaciones
ALTER TABLE conversations
ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL;

-- Índice para mejorar rendimiento de consultas que filtran por deleted_at
CREATE INDEX idx_conversations_deleted_at ON conversations(deleted_at);

-- Verificar cambios
DESCRIBE conversations;
