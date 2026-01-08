-- Migration 032: Add generation type to conversations
-- Each conversation is locked to a specific generation type (text, image, video, audio)

-- Agregar tipo de generacion a conversaciones
ALTER TABLE conversations
ADD COLUMN generation_type ENUM('text', 'image', 'video', 'audio') DEFAULT 'text'
  COMMENT 'Tipo de generacion fijo para esta conversacion'
  AFTER model_id;

-- Migrar conversaciones existentes basandose en el modelo asociado
-- Se detecta el tipo segun las capacidades del modelo
UPDATE conversations c
JOIN models m ON c.model_id = m.id
SET c.generation_type = CASE
  WHEN COALESCE(m.supports_audio_generation, 0) = 1 THEN 'audio'
  WHEN COALESCE(m.supports_video_generation, 0) = 1 THEN 'video'
  WHEN COALESCE(m.supports_image_generation, 0) = 1 THEN 'image'
  ELSE 'text'
END;

-- Indice para filtrar conversaciones por tipo
CREATE INDEX idx_conversations_generation_type ON conversations(generation_type);

-- Indice compuesto para busquedas por proyecto y tipo
CREATE INDEX idx_conversations_project_type ON conversations(project_id, generation_type);
