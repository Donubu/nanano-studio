-- Migration 121: Migrar project_templates de Gemini 2.5 TTS -> 3.1 Flash TTS
--
-- Complementa a la 120. Los project_templates (migración 082) guardan su config
-- como JSON con el model_id numérico embebido en $.audio.models[*].model_id.
-- applyTemplateToProject() (lib/personal-space.ts) lee ese JSON cada vez que se
-- crea un proyecto/espacio personal, así que sin este parche todo proyecto NUEVO
-- nacería con el 2.5 (el default actual del template es 2.5 Pro = legacy).
--
-- Reemplaza, en cada slot de audio.models cuyo model_id sea un Gemini 2.5 TTS
-- (Flash/Pro y sus duplicados 'models/'), el id por el de 3.1. Deja Chirp intacto.
-- Match por SLUG (portable 8.4/5.7). Idempotente: tras el reemplazo el valor ya no
-- resuelve a un 2.5. Compatible con MySQL 5.7 (sin JSON_TABLE).
--
-- NOTA: asume <=1 slot Gemini 2.5 por template (el caso real: [2.5 Pro, Chirp]).
-- Si un template tuviera dos slots 2.5 quedarían dos 3.1 duplicados; no es el caso.

SET @new := (SELECT id FROM models WHERE model_id = 'gemini-3.1-flash-tts-preview');

UPDATE project_templates SET config = JSON_REPLACE(config, '$.audio.models[0].model_id', @new)
  WHERE @new IS NOT NULL AND CAST(JSON_UNQUOTE(JSON_EXTRACT(config, '$.audio.models[0].model_id')) AS UNSIGNED) IN
    (SELECT id FROM models WHERE model_id IN ('gemini-2.5-flash-preview-tts','gemini-2.5-pro-preview-tts','models/gemini-2.5-flash-preview-tts','models/gemini-2.5-pro-preview-tts'));
UPDATE project_templates SET config = JSON_REPLACE(config, '$.audio.models[1].model_id', @new)
  WHERE @new IS NOT NULL AND CAST(JSON_UNQUOTE(JSON_EXTRACT(config, '$.audio.models[1].model_id')) AS UNSIGNED) IN
    (SELECT id FROM models WHERE model_id IN ('gemini-2.5-flash-preview-tts','gemini-2.5-pro-preview-tts','models/gemini-2.5-flash-preview-tts','models/gemini-2.5-pro-preview-tts'));
UPDATE project_templates SET config = JSON_REPLACE(config, '$.audio.models[2].model_id', @new)
  WHERE @new IS NOT NULL AND CAST(JSON_UNQUOTE(JSON_EXTRACT(config, '$.audio.models[2].model_id')) AS UNSIGNED) IN
    (SELECT id FROM models WHERE model_id IN ('gemini-2.5-flash-preview-tts','gemini-2.5-pro-preview-tts','models/gemini-2.5-flash-preview-tts','models/gemini-2.5-pro-preview-tts'));
UPDATE project_templates SET config = JSON_REPLACE(config, '$.audio.models[3].model_id', @new)
  WHERE @new IS NOT NULL AND CAST(JSON_UNQUOTE(JSON_EXTRACT(config, '$.audio.models[3].model_id')) AS UNSIGNED) IN
    (SELECT id FROM models WHERE model_id IN ('gemini-2.5-flash-preview-tts','gemini-2.5-pro-preview-tts','models/gemini-2.5-flash-preview-tts','models/gemini-2.5-pro-preview-tts'));
UPDATE project_templates SET config = JSON_REPLACE(config, '$.audio.models[4].model_id', @new)
  WHERE @new IS NOT NULL AND CAST(JSON_UNQUOTE(JSON_EXTRACT(config, '$.audio.models[4].model_id')) AS UNSIGNED) IN
    (SELECT id FROM models WHERE model_id IN ('gemini-2.5-flash-preview-tts','gemini-2.5-pro-preview-tts','models/gemini-2.5-flash-preview-tts','models/gemini-2.5-pro-preview-tts'));
UPDATE project_templates SET config = JSON_REPLACE(config, '$.audio.models[5].model_id', @new)
  WHERE @new IS NOT NULL AND CAST(JSON_UNQUOTE(JSON_EXTRACT(config, '$.audio.models[5].model_id')) AS UNSIGNED) IN
    (SELECT id FROM models WHERE model_id IN ('gemini-2.5-flash-preview-tts','gemini-2.5-pro-preview-tts','models/gemini-2.5-flash-preview-tts','models/gemini-2.5-pro-preview-tts'));
