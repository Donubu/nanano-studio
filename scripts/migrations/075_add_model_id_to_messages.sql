-- Agregar model_id a messages para registrar que modelo se uso en cada generacion
ALTER TABLE messages ADD COLUMN model_id INT NULL AFTER quality_tier;
ALTER TABLE messages ADD CONSTRAINT fk_messages_model_id FOREIGN KEY (model_id) REFERENCES models(id);

-- Backfill model_id en mensajes existentes usando quality_tier + project_generation_config
-- Imágenes
UPDATE messages m
JOIN conversations c ON m.conversation_id = c.id
JOIN project_generation_config pgc ON pgc.project_id = c.project_id AND pgc.generation_type = 'image'
SET m.model_id = CASE
  WHEN m.quality_tier = 'hq' AND pgc.model_hq_id IS NOT NULL THEN pgc.model_hq_id
  ELSE pgc.model_normal_id
END
WHERE m.role = 'model' AND m.model_id IS NULL
  AND m.image_url IS NOT NULL AND m.image_url != '';

-- Videos
UPDATE messages m
JOIN conversations c ON m.conversation_id = c.id
JOIN project_generation_config pgc ON pgc.project_id = c.project_id AND pgc.generation_type = 'video'
SET m.model_id = CASE
  WHEN m.quality_tier = 'hq' AND pgc.model_hq_id IS NOT NULL THEN pgc.model_hq_id
  ELSE pgc.model_normal_id
END
WHERE m.role = 'model' AND m.model_id IS NULL
  AND m.video_url IS NOT NULL AND m.video_url != '';

-- Audio (chirp es un quality_tier especial)
UPDATE messages m
JOIN conversations c ON m.conversation_id = c.id
JOIN project_generation_config pgc ON pgc.project_id = c.project_id AND pgc.generation_type = 'audio'
SET m.model_id = CASE
  WHEN m.quality_tier = 'chirp' AND pgc.model_chirp_id IS NOT NULL THEN pgc.model_chirp_id
  WHEN m.quality_tier = 'hq' AND pgc.model_hq_id IS NOT NULL THEN pgc.model_hq_id
  ELSE pgc.model_normal_id
END
WHERE m.role = 'model' AND m.model_id IS NULL
  AND m.audio_url IS NOT NULL AND m.audio_url != '';

-- Música
UPDATE messages m
JOIN conversations c ON m.conversation_id = c.id
JOIN project_generation_config pgc ON pgc.project_id = c.project_id AND pgc.generation_type = 'music'
SET m.model_id = CASE
  WHEN m.quality_tier = 'hq' AND pgc.model_hq_id IS NOT NULL THEN pgc.model_hq_id
  ELSE pgc.model_normal_id
END
WHERE m.role = 'model' AND m.model_id IS NULL
  AND m.music_url IS NOT NULL AND m.music_url != '';

-- Texto (streaming)
UPDATE messages m
JOIN conversations c ON m.conversation_id = c.id
JOIN project_generation_config pgc ON pgc.project_id = c.project_id AND pgc.generation_type = 'text'
SET m.model_id = CASE
  WHEN m.quality_tier = 'hq' AND pgc.model_hq_id IS NOT NULL THEN pgc.model_hq_id
  ELSE pgc.model_normal_id
END
WHERE m.role = 'model' AND m.model_id IS NULL
  AND (m.image_url IS NULL OR m.image_url = '')
  AND (m.video_url IS NULL OR m.video_url = '')
  AND (m.audio_url IS NULL OR m.audio_url = '')
  AND (m.music_url IS NULL OR m.music_url = '')
  AND m.content_type != 'error';
