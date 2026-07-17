-- Migration 123: Templates de canvas (flows reutilizables).
--
-- Un template es un snapshot inmutable de nodos + edges de un canvas,
-- guardado con nombre. Al crear un canvas nuevo el usuario puede instanciar
-- un template: se copian nodos y edges a la conversación nueva (los IDs de
-- nodos son locales a cada conversación, así que la copia es literal y las
-- referencias internas como scene.scriptNodeId siguen siendo válidas).
-- El template nunca se modifica desde el canvas instanciado.
--
-- Alcance global: los templates no pertenecen a ningún proyecto/cliente.
-- Los snapshots se guardan en el mismo formato JSON que devuelve
-- GET /api/conversations/[id]/canvas (shape cliente), sanitizados:
-- se conservan outputs de referencia (outputUrl/outputText) pero se limpian
-- las referencias a la conversación origen (outputMessageId, outputHistory,
-- conversationId de practicante, etc.).

CREATE TABLE canvas_templates (
  id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  nodes_json LONGTEXT NOT NULL,
  edges_json LONGTEXT NOT NULL,
  node_count INT NOT NULL DEFAULT 0,
  edge_count INT NOT NULL DEFAULT 0,
  -- Conteo por tipo de nodo, ej. {"image": 3, "text": 2}. Para pintar el
  -- picker sin parsear el snapshot completo.
  node_types_json TEXT NULL,
  source_conversation_id INT NULL,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  INDEX idx_canvas_templates_alive (deleted_at, created_at),
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
