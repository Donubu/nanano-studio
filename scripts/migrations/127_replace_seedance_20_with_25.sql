-- Seedance 2.5 (OpenRouter) reemplaza a Seedance 2.0. Seedance 2.0 Fast sigue
-- activo (no existe un 2.5-fast en OpenRouter).
--
-- Diferencias 2.0 → 2.5 (GET /api/v1/videos/models, 2026-08-21):
--   duración 4-30s (antes 4-15), solo 480p/720p (sin 1080p/4K), sin 9:21,
--   grilla de tamaños distinta (1:1=960x960, 4:3=1112x834, 21:9=1470x630…),
--   $0.0000107/token (antes $0.000007). Pricing por tokens en
--   lib/openrouter-video.ts (OPENROUTER_MODEL_CAPS); cost_video_per_second=0.
--
-- La fila de 2.0 NO se borra (messages.model_id la referencia para historial y
-- recálculo de costos): solo se desactiva y se traspasan sus asignaciones de
-- proyecto a 2.5 conservando label/sort_order/is_default. Idempotente.

INSERT IGNORE INTO models (
  model_id, display_name, description,
  supports_video_generation, is_active,
  cost_video_per_second, api_backend
) VALUES (
  'bytedance/seedance-2.5', 'Seedance 2.5',
  'ByteDance Seedance 2.5 via OpenRouter. Text-to-video, image-to-video (first/last frame), reference-to-video (@ref1, @ref2… en el prompt). 4-30s, 480p/720p, audio nativo opcional, seed. Pricing por tokens (w*h*d*24/1024 * $0.0000107).',
  1, 1, 0.000000, 'openrouter'
);

UPDATE models SET api_backend = 'openrouter', supports_video_generation = 1
WHERE model_id = 'bytedance/seedance-2.5'
  AND (api_backend IS NULL OR api_backend != 'openrouter');

SET @s20 = (SELECT id FROM models WHERE model_id = 'bytedance/seedance-2.0' LIMIT 1);
SET @s25 = (SELECT id FROM models WHERE model_id = 'bytedance/seedance-2.5' LIMIT 1);

-- Proyectos que tenían 2.0 pero NO 2.5: mover la fila (conserva label/orden/default).
UPDATE project_generation_models pgm
SET pgm.model_id = @s25
WHERE pgm.model_id = @s20
  AND @s20 IS NOT NULL AND @s25 IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM (SELECT project_id, generation_type FROM project_generation_models WHERE model_id = @s25) x
    WHERE x.project_id = pgm.project_id AND x.generation_type = pgm.generation_type
  );

-- Proyectos que ya tenían ambos: quitar el 2.0 duplicado.
DELETE FROM project_generation_models
WHERE model_id = @s20 AND @s20 IS NOT NULL;

UPDATE models SET is_active = 0 WHERE model_id = 'bytedance/seedance-2.0';
