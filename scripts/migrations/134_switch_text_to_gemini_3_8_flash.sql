-- Migration 134: Texto de Gemini 3.1 Pro preview -> Gemini 3.8 Flash
--
-- Gemini 3.1 Pro preview era el modelo de texto por defecto de todos los
-- proyectos (91 en prod al 2026-11-09, todos con 3.1 Pro como único modelo de
-- texto). Se reemplaza por gemini-3.8-flash, el mismo que usa la IA de
-- Producción (lib/production/gemini-json.ts).
--
-- Precio Gemini API (igual a la tabla de gemini-json.ts): $0.75 input /
-- $3.75 output por 1M tokens. Probado en vivo 2026-11-09: thinkingBudget +
-- includeThoughts y googleSearch funcionan; 1M de contexto, 64K de output.
--
-- api_backend = 'gemini' explícito (igual que 230): NULL heredaría el default
-- de env y podría enrutar a Vertex.
--
-- Mismo efecto que "Marcar obsoleto" en /dashboard/models
-- (app/api/models/[id]/obsolete/route.ts): se cambia el model_id del row de
-- cada proyecto conservando label/sort_order/is_default, y 3.1 Pro queda
-- obsoleto con replaced_by apuntando al nuevo. Match por slug, no por id.

INSERT INTO models (
  model_id, display_name, description,
  supports_images, supports_audio, supports_video,
  supports_image_generation, supports_google_search,
  cost_input_per_million, cost_output_per_million,
  max_tokens, api_backend, is_active
)
SELECT
  'gemini-3.8-flash',
  'Gemini 3.8 Flash',
  'Modelo de texto de Google con razonamiento (thinking), 1M de contexto y 64K de output. Entrada de texto, imágenes, audio, video y PDF. Soporta búsqueda en Google.',
  TRUE, TRUE, TRUE,
  FALSE, TRUE,
  0.750000, 3.750000,
  65536, 'gemini', TRUE
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM models WHERE model_id = 'gemini-3.8-flash');

SET @new := (SELECT id FROM models WHERE model_id = 'gemini-3.8-flash');
SET @old := (SELECT id FROM models WHERE model_id = 'gemini-3.1-pro-preview');

-- 1) Proyectos que ya tuvieran 3.8 Flash además de 3.1 Pro: si 3.1 Pro era el
--    default, el default pasa a 3.8 Flash; luego se borra el row de 3.1 Pro.
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

-- 2) El resto: cambiar 3.1 Pro por 3.8 Flash en el mismo row.
UPDATE project_generation_models SET model_id = @new
  WHERE model_id = @old AND @new IS NOT NULL;

-- 3) Conversaciones (fallback cuando no hay proyecto o el proyecto no tiene
--    modelo de texto configurado). En prod son todas text/canvas.
UPDATE conversations SET model_id = @new
  WHERE model_id = @old AND @new IS NOT NULL;

-- 4) 3.1 Pro queda obsoleto e inactivo, reemplazado por 3.8 Flash.
UPDATE models
  SET is_obsolete = TRUE, is_active = FALSE, replaced_by_model_id = @new
  WHERE id = @old AND @new IS NOT NULL;
