-- Migration 138: tipo de nodo 'linked' (nodo vinculado a otro canvas).
--
-- Un nodo 'linked' muestra un Personaje (más adelante, una Escena) que vive
-- en otro canvas del mismo proyecto: solo lectura, con una vista resuelta
-- guardada en config (linkSnapshot) que se actualiza al abrir el canvas y
-- antes de ejecutar. El origen va en config (sourceConversationId,
-- sourceNodeId). canvas_nodes.type es ENUM: sin esto el upsert falla con 500.

ALTER TABLE canvas_nodes
  MODIFY COLUMN type ENUM('text','text-practicante','image','video','note','static-text','static-image','static-image-group','params-text','params-image','params-video','params-scene','script','scene','character','linked') NOT NULL;
