-- Migration 112: Template variant linking.
-- Un master ahora puede tener varias variantes de orientación. Una variante
-- está "linked" a otra (su layout se deriva por reflow) o es "distinct" (con
-- su propio definition_json independiente).
--
-- Cuando linked_to_template_id está set, este template hereda del referenciado.
-- Cuando NULL, es un master independiente (base o marcado como distinto).
--
-- ON DELETE SET NULL: si se borra el base, las variantes vinculadas quedan
-- como distintas en lugar de propagarse el delete.

ALTER TABLE production_templates
ADD COLUMN linked_to_template_id INT NULL AFTER design_id,
ADD CONSTRAINT fk_prodtpl_linked
  FOREIGN KEY (linked_to_template_id) REFERENCES production_templates(id) ON DELETE SET NULL,
ADD INDEX idx_prodtpl_linked (linked_to_template_id);
