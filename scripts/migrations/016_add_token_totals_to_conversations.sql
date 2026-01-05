-- Agregar campos para acumular tokens consumidos en la conversación
ALTER TABLE conversations
ADD COLUMN total_tokens_input INT DEFAULT 0 AFTER max_output_tokens,
ADD COLUMN total_tokens_output INT DEFAULT 0 AFTER total_tokens_input;

-- Actualizar totales existentes basándose en mensajes anteriores
UPDATE conversations c
SET
  total_tokens_input = COALESCE((
    SELECT SUM(tokens_input) FROM messages WHERE conversation_id = c.id
  ), 0),
  total_tokens_output = COALESCE((
    SELECT SUM(tokens_output) FROM messages WHERE conversation_id = c.id
  ), 0);

-- Verificar cambios
DESCRIBE conversations;
