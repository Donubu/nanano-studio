-- Gemini Omni como modelo de video en TODOS los proyectos, y por defecto.
-- No quita los modelos existentes: solo agrega Omni (si falta) y traspasa el
-- flag is_default. Idempotente: correrla de nuevo no duplica ni cambia nada.

SET @omni_model_id = (
  SELECT id FROM models
  WHERE model_id = 'gemini-omni-flash-preview' AND api_backend = 'omni'
  LIMIT 1
);

-- 1) Agregar Omni a cada proyecto que no lo tenga, al final de la lista de
--    modelos de video del proyecto (sort_order = max + 1).
INSERT IGNORE INTO project_generation_models
  (project_id, generation_type, model_id, label, sort_order, is_default)
SELECT
  p.id,
  'video',
  @omni_model_id,
  'Omni',
  COALESCE((
    SELECT MAX(pgm.sort_order) + 1
    FROM project_generation_models pgm
    WHERE pgm.project_id = p.id AND pgm.generation_type = 'video'
  ), 0),
  0
FROM projects p
WHERE @omni_model_id IS NOT NULL;

-- 2) Quitar el default de los demás modelos de video...
UPDATE project_generation_models
SET is_default = 0
WHERE generation_type = 'video'
  AND model_id != @omni_model_id
  AND is_default = 1
  AND @omni_model_id IS NOT NULL;

-- 3) ...y dejar Omni como default en todos los proyectos.
UPDATE project_generation_models
SET is_default = 1
WHERE generation_type = 'video'
  AND model_id = @omni_model_id
  AND @omni_model_id IS NOT NULL;
