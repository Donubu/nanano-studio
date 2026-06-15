-- Deshabilita el chat de tipo TEXTO en TODOS los proyectos.
--
-- Semántica: la app lee project_generation_config y trata la AUSENCIA de fila
-- como deshabilitado (`enabled = enabledMap[type] ?? false` en
-- app/api/projects/[id]/generation-config/route.ts). Por eso basta con poner
-- is_enabled = 0 en las filas 'text' existentes; los proyectos sin fila ya
-- tienen el texto deshabilitado.
--
-- Compatible con MySQL 5.7 (local) y 8.x (prod).
-- Ejecutar contra la BD de la app (no afecta image/video/audio/music).

-- 1) Vista previa: cuántas filas 'text' quedan habilitadas antes del cambio.
SELECT COUNT(*) AS text_habilitados_antes
FROM project_generation_config
WHERE generation_type = 'text' AND is_enabled = 1;

-- 2) Deshabilitar texto en todos los proyectos.
UPDATE project_generation_config
SET is_enabled = 0,
    updated_at = CURRENT_TIMESTAMP
WHERE generation_type = 'text'
  AND is_enabled = 1;

-- 3) Verificación: debe dar 0.
SELECT COUNT(*) AS text_habilitados_despues
FROM project_generation_config
WHERE generation_type = 'text' AND is_enabled = 1;

-- Rollback (si fuese necesario revertir TODO a habilitado):
-- UPDATE project_generation_config SET is_enabled = 1, updated_at = CURRENT_TIMESTAMP
-- WHERE generation_type = 'text';
