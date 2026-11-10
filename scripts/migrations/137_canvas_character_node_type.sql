-- Migration 137: tipo de nodo 'character' (Personaje por etapas).
--
-- canvas_nodes.type es ENUM: sin esto el upsert del nodo Personaje falla con
-- 500 (las imágenes que crea sí se guardan, el Personaje no). Mismo patrón que
-- la 099 (text-practicante). canvas_nodes_history guarda el tipo como texto.

ALTER TABLE canvas_nodes
  MODIFY COLUMN type ENUM('text','text-practicante','image','video','note','static-text','static-image','static-image-group','params-text','params-image','params-video','params-scene','script','scene','character') NOT NULL;
