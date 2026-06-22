-- Migration 120: Migrar proyectos de los TTS 2.5 (Gemini) -> Gemini 3.1 Flash TTS
--
-- Cubre las 4 filas legacy de Gemini 2.5 TTS (Flash, Pro y sus duplicados con
-- prefijo 'models/'). NO toca Chirp (otro motor). Decisión: colapsar TODO 2.5
-- Gemini a 3.1.
--
-- PROBLEMA: muchos proyectos tienen DOS modelos 2.5 a la vez (Flash=normal +
-- Pro=hq). Migrar ambos a 3.1 violaría la UNIQUE KEY (project_id, generation_type,
-- model_id). Solución: por proyecto se conserva UN solo row (el default/normal,
-- preferencia is_default DESC, sort_order ASC, id ASC) y se convierte a 3.1; los
-- demás 2.5 Gemini de audio se eliminan. Resultado típico: [3.1, Chirp].
--
-- Match por SLUG (no por id hardcodeado) para ser portable entre prod (8.4) y el
-- dev local (5.7). El set de ids 2.5 se inlinea como subquery sobre `models`
-- (tabla base) en cada uso: una TEMPORARY TABLE no puede referenciarse dos veces
-- en un mismo statement (error "Can't reopen table" en MySQL).

SET @new := (SELECT id FROM models WHERE model_id = 'gemini-3.1-flash-tts-preview');

-- Un row "ganador" por proyecto (el que se conserva y se convierte a 3.1).
DROP TEMPORARY TABLE IF EXISTS _tts25_keep;
CREATE TEMPORARY TABLE _tts25_keep AS
  SELECT (
    SELECT p2.id
    FROM project_generation_models p2
    WHERE p2.project_id = grp.project_id
      AND p2.generation_type = 'audio'
      AND p2.model_id IN (
        SELECT id FROM models WHERE model_id IN (
          'gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts',
          'models/gemini-2.5-flash-preview-tts', 'models/gemini-2.5-pro-preview-tts'
        )
      )
    ORDER BY p2.is_default DESC, p2.sort_order ASC, p2.id ASC
    LIMIT 1
  ) AS keep_id
  FROM (
    SELECT DISTINCT project_id
    FROM project_generation_models
    WHERE generation_type = 'audio'
      AND model_id IN (
        SELECT id FROM models WHERE model_id IN (
          'gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts',
          'models/gemini-2.5-flash-preview-tts', 'models/gemini-2.5-pro-preview-tts'
        )
      )
  ) grp;

-- 1) Convertir el row ganador de cada proyecto a 3.1.
UPDATE project_generation_models
  SET model_id = @new
  WHERE id IN (SELECT keep_id FROM _tts25_keep);

-- 2) Eliminar los 2.5 Gemini de audio restantes (los no-ganadores). Los ganadores
--    ya son 3.1, así que no caen en este DELETE.
DELETE FROM project_generation_models
  WHERE generation_type = 'audio'
    AND model_id IN (
      SELECT id FROM models WHERE model_id IN (
        'gemini-2.5-flash-preview-tts', 'gemini-2.5-pro-preview-tts',
        'models/gemini-2.5-flash-preview-tts', 'models/gemini-2.5-pro-preview-tts'
      )
    );

DROP TEMPORARY TABLE IF EXISTS _tts25_keep;
