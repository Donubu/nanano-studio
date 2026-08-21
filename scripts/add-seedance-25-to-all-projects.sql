-- Agrega Seedance 2.5 (OpenRouter) como modelo de video a TODOS los proyectos
-- que no lo tengan, al final de la lista y sin cambiar el default. Idempotente
-- y compatible con la migración 127 (mismo INSERT IGNORE del modelo; la 127
-- luego solo desactiva 2.0 y limpia sus asignaciones).
-- Recordar: solo lo ven admins y usuarios con users.can_use_openrouter = 1.
-- Uso: mysql ... < scripts/add-seedance-25-to-all-projects.sql

INSERT IGNORE INTO models (
  model_id, display_name, description,
  supports_video_generation, is_active,
  cost_video_per_second, api_backend
) VALUES (
  'bytedance/seedance-2.5', 'Seedance 2.5',
  'ByteDance Seedance 2.5 via OpenRouter. Text-to-video, image-to-video (first/last frame), reference-to-video (@ref1, @ref2… en el prompt). 4-30s, 480p/720p, audio nativo opcional, seed. Pricing por tokens (w*h*d*24/1024 * $0.0000107).',
  1, 1, 0.000000, 'openrouter'
);

SET @s25 = (SELECT id FROM models WHERE model_id = 'bytedance/seedance-2.5' AND api_backend = 'openrouter' LIMIT 1);

INSERT IGNORE INTO project_generation_models
  (project_id, generation_type, model_id, label, sort_order, is_default)
SELECT
  p.id, 'video', @s25, 'Seedance 2.5',
  COALESCE((
    SELECT MAX(pgm.sort_order) + 1
    FROM project_generation_models pgm
    WHERE pgm.project_id = p.id AND pgm.generation_type = 'video'
  ), 0),
  0
FROM projects p
WHERE @s25 IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM project_generation_models x
    WHERE x.project_id = p.id AND x.generation_type = 'video' AND x.model_id = @s25
  );

SELECT
  (SELECT COUNT(*) FROM projects) AS proyectos,
  (SELECT COUNT(*) FROM project_generation_models WHERE generation_type = 'video' AND model_id = @s25) AS con_seedance_25;
