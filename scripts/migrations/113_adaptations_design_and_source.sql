-- Migration 113: Adaptaciones por design (no por orientación) + source_template_id.
--
-- Cambio conceptual: una adaptación pertenece a un DESIGN, no a una orientación
-- específica. Al renderear, el "source" se elige así:
--   1. Si overrides_json.manual_layout existe, ese gana (override absoluto).
--   2. Si source_template_id está set: esa orientación es la fuente.
--   3. Si NULL: auto-pick por aspect ratio más cercano dentro del design.
--
-- Pasos:
--  a) Para cada template sin design_id, creamos un design y lo asociamos. Usamos
--     una columna temporal _backfill_tpl_id en production_designs para mantener
--     la relación 1:1 durante el backfill, después la dropeamos.
--  b) Agregamos design_id y source_template_id a production_template_adaptations.
--  c) Backfill: design_id viene del template referenciado. source_template_id
--     queda en NULL (= auto-pick), preservando el comportamiento del renderer
--     que ya elegía dinámicamente por aspect.
--  d) FK constraints + drop del template_id viejo. Usamos prepared statements
--     para resolver el FK_NAME auto-generado por MySQL.

-- (a) Auto-design para templates standalone, con mapeo 1:1 vía columna temp.
ALTER TABLE production_designs ADD COLUMN _backfill_tpl_id INT NULL;

INSERT INTO production_designs
  (production_project_id, name, description, created_by, _backfill_tpl_id)
SELECT production_project_id, name, NULL, created_by, id
  FROM production_templates
 WHERE design_id IS NULL AND deleted_at IS NULL;

UPDATE production_templates t
  JOIN production_designs d ON d._backfill_tpl_id = t.id
   SET t.design_id = d.id
 WHERE t.design_id IS NULL;

ALTER TABLE production_designs DROP COLUMN _backfill_tpl_id;

-- (b) Nuevas columnas en adaptations.
ALTER TABLE production_template_adaptations
ADD COLUMN design_id INT NULL AFTER template_id,
ADD COLUMN source_template_id INT NULL AFTER design_id;

-- (c) Backfill design_id desde el template original.
UPDATE production_template_adaptations a
  JOIN production_templates t ON t.id = a.template_id
   SET a.design_id = t.design_id;

-- (d) Constraints definitivas + drop del template_id viejo.
ALTER TABLE production_template_adaptations
MODIFY COLUMN design_id INT NOT NULL;

ALTER TABLE production_template_adaptations
ADD CONSTRAINT fk_prodadp_design
  FOREIGN KEY (design_id) REFERENCES production_designs(id) ON DELETE CASCADE,
ADD CONSTRAINT fk_prodadp_source_template
  FOREIGN KEY (source_template_id) REFERENCES production_templates(id) ON DELETE SET NULL,
ADD INDEX idx_prodadp_design (design_id),
ADD INDEX idx_prodadp_source (source_template_id);

-- Resolvemos el nombre auto-generado del FK template_id (MySQL lo crea como
-- ${table}_ibfk_${n} por defecto pero no podemos asumirlo). Lo dropeamos y
-- después dropeamos la columna template_id.
SET @fk_name = (
  SELECT CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE
   WHERE TABLE_SCHEMA = DATABASE()
     AND TABLE_NAME = 'production_template_adaptations'
     AND COLUMN_NAME = 'template_id'
     AND REFERENCED_TABLE_NAME = 'production_templates'
   LIMIT 1
);
SET @sql = CONCAT('ALTER TABLE production_template_adaptations DROP FOREIGN KEY ', @fk_name);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

ALTER TABLE production_template_adaptations
DROP INDEX idx_prodadp_template,
DROP COLUMN template_id;
