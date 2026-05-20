-- Migration 115: Soft delete en production_brand_kits.
--
-- Antes el DELETE era hard delete + ON DELETE SET NULL en templates: si el
-- admin borraba un kit, los templates perdían la referencia silenciosamente
-- y no había forma de recuperar nada. Pasamos a soft delete:
--   - DELETE pone deleted_at = NOW().
--   - El listado normal filtra deleted_at IS NULL.
--   - El admin desde el dashboard puede ver los eliminados (filtro opt-in)
--     y reactivarlos (deleted_at = NULL), recuperando referencias rotas.
--
-- Por qué soft en lugar de hard:
--   * Brand kits suelen tener mucho trabajo encima (colores, tipografías,
--     logos). Una restauración rápida vale la pena.
--   * Templates project-scoped pueden depender de un fork específico; borrar
--     hard sin querer rompía el template silenciosamente.
--   * El admin puede igualmente purgar hard desde DB si necesita liberar
--     espacio — esto es para el flujo cotidiano.

ALTER TABLE production_brand_kits
ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL AFTER updated_at,
ADD INDEX idx_prodbk_deleted (deleted_at);
