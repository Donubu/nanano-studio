-- Migration 118: Soft delete + historial de snapshots para el canvas.
--
-- Contexto: el PUT /api/conversations/[id]/canvas hacía DELETE FROM
-- canvas_nodes + canvas_edges y reinsertaba lo que llegaba en el body.
-- Un único PUT con estado parcial (otra pestaña, multi-select + Delete,
-- node:remove del socket de colaboración) bastaba para perder todo el
-- trabajo sin recuperación posible. PITR de Cloud SQL está deshabilitado.
--
-- Esta migración prepara:
--   1) Soft delete en canvas_nodes y canvas_edges (deleted_at).
--      El PUT pasa a hacer UPSERT por id + marcar como deleted_at = NOW()
--      los nodos/edges ausentes en el payload. Recuperación con
--      UPDATE deleted_at = NULL (papelera visible al usuario).
--
--   2) Tabla canvas_nodes_history con snapshots JSON completos antes de
--      cada PUT exitoso. Permite restaurar al estado exacto de cualquier
--      save reciente. Retención manejada por job de limpieza (futuro).
--
-- No se elimina nada existente. Migración aditiva, segura para producción.

ALTER TABLE canvas_nodes
  ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL AFTER updated_at,
  ADD COLUMN version INT NOT NULL DEFAULT 1 AFTER deleted_at,
  ADD INDEX idx_canvas_nodes_alive (conversation_id, deleted_at),
  ADD INDEX idx_canvas_nodes_deleted_at (deleted_at);

ALTER TABLE canvas_edges
  ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL AFTER created_at,
  ADD INDEX idx_canvas_edges_alive (conversation_id, deleted_at),
  ADD INDEX idx_canvas_edges_deleted_at (deleted_at);

CREATE TABLE canvas_nodes_history (
  history_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  snapshot_id VARCHAR(36) NOT NULL,
  snapshot_reason ENUM('autosave','manual','pre-restore','pre-wipe') NOT NULL DEFAULT 'autosave',
  saved_by_user_id INT NULL,
  nodes_json LONGTEXT NOT NULL,
  edges_json LONGTEXT NOT NULL,
  nodes_count INT NOT NULL,
  edges_count INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_history_conv_time (conversation_id, created_at),
  INDEX idx_history_snapshot (snapshot_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
