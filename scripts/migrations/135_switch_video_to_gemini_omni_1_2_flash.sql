-- Migration 135: Video de Gemini Omni Flash (Preview) -> Gemini Omni 1.2 Flash
--
-- gemini-omni-flash-preview era el modelo de video por defecto de 92 proyectos
-- (prod, 2026-11-09). gemini-omni-1.2-flash usa la misma interactions API
-- (lib/omni-video.ts sin cambios de request): probado 2026-11-09 con un
-- text-to-video real, 1280x720 a 24 fps, h264 + aac, 6 s pedidos en el prompt
-- -> 6,04 s, 34.752 tokens de video (5.792 tok/seg, igual que el preview).
--
-- Precio: el video baja de $17.50 a $12 por 1M tokens (≈ $0.07/seg a 720p);
-- input $1.50/1M y texto/thinking $9/1M igual. El costo real se calcula desde
-- usage en lib/omni-video.ts; cost_video_per_second es la estimación de la UI.
--
-- Las capacidades se copian del row del preview (mismo backend 'omni').
-- Mismo efecto que "Marcar obsoleto" en /dashboard/models. Match por slug.

INSERT INTO models (
  model_id, display_name, description,
  supports_images, supports_audio, supports_video,
  supports_video_generation, supports_reference_images,
  cost_video_per_second, max_tokens, api_backend, is_active
)
SELECT
  'gemini-omni-1.2-flash',
  'Gemini Omni 1.2 Flash',
  'Video con audio integrado vía interactions API de Gemini. 720p/24fps, 16:9 o 9:16. La duración se pide en el prompt. Sin negative prompt ni seed. ~$0.07/segundo.',
  p.supports_images, p.supports_audio, p.supports_video,
  TRUE, p.supports_reference_images,
  0.070000, p.max_tokens, 'omni', TRUE
FROM models p
WHERE p.model_id = 'gemini-omni-flash-preview'
  AND NOT EXISTS (SELECT 1 FROM models WHERE model_id = 'gemini-omni-1.2-flash');

-- Si el preview no existiera (BD nueva), igual se crea el modelo.
INSERT INTO models (
  model_id, display_name, description,
  supports_video_generation, cost_video_per_second, max_tokens, api_backend, is_active
)
SELECT
  'gemini-omni-1.2-flash',
  'Gemini Omni 1.2 Flash',
  'Video con audio integrado vía interactions API de Gemini. 720p/24fps, 16:9 o 9:16. La duración se pide en el prompt. Sin negative prompt ni seed. ~$0.07/segundo.',
  TRUE, 0.070000, 8192, 'omni', TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM models WHERE model_id = 'gemini-omni-1.2-flash');

SET @new := (SELECT id FROM models WHERE model_id = 'gemini-omni-1.2-flash');
SET @old := (SELECT id FROM models WHERE model_id = 'gemini-omni-flash-preview');

-- 1) Proyectos que ya tuvieran 1.2 además del preview: hereda el default y se
--    borra el row del preview.
UPDATE project_generation_models n
  JOIN project_generation_models o
    ON o.project_id = n.project_id
   AND o.generation_type = n.generation_type
   AND o.model_id = @old
  SET n.is_default = 1
  WHERE n.model_id = @new AND o.is_default = 1;

DELETE o FROM project_generation_models o
  JOIN project_generation_models n
    ON n.project_id = o.project_id
   AND n.generation_type = o.generation_type
   AND n.model_id = @new
  WHERE o.model_id = @old;

-- 2) El resto: cambiar el preview por 1.2 en el mismo row.
UPDATE project_generation_models SET model_id = @new
  WHERE model_id = @old AND @new IS NOT NULL;

-- 3) Conversaciones de video que apuntaban al preview.
UPDATE conversations SET model_id = @new
  WHERE model_id = @old AND @new IS NOT NULL;

-- 4) El preview queda obsoleto e inactivo, reemplazado por 1.2.
UPDATE models
  SET is_obsolete = TRUE, is_active = FALSE, replaced_by_model_id = @new
  WHERE id = @old AND @new IS NOT NULL;
