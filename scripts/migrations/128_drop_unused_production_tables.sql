-- Migration 128: elimina dos tablas de producción que nunca tuvieron código
-- detrás (creadas en la 107, revisadas el 2026-09-08 con 0 filas en local y
-- en producción):
--
--   * production_renders — pensada para un export batch server-side con
--     progreso. El export vive en el navegador (JSZip). Si algún día se
--     construye el job en servidor, se vuelve a crear con el diseño que
--     corresponda a ese momento.
--   * production_template_variables — variables tipadas por template
--     (label, tipo, default). Las variables {{var}} se detectan en runtime
--     desde definition_json (lib/production/variables.ts) y los valores
--     vienen del dataset CSV. Los tokens de MARCA viven en
--     production_brand_kits, no acá.
--
-- Reversible: el CREATE de ambas está en 107_create_production_tables.sql.

DROP TABLE IF EXISTS production_renders;
DROP TABLE IF EXISTS production_template_variables;
