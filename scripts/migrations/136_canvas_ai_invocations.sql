-- Migration 136: canvas_ai_invocations.
--
-- Registro de cada pedido al asistente del canvas ("Pídele a la IA" en el
-- canvas, POST /api/conversations/[id]/canvas/ai/assist): tokens, costo
-- estimado en USD, duración y resultado. Sirve para sumar el costo del
-- asistente (no genera mensajes en la conversación, así que no entra en
-- messages.estimated_cost) y para el límite de pedidos por usuario y hora.

CREATE TABLE IF NOT EXISTS canvas_ai_invocations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  project_id INT NULL,
  user_id INT NOT NULL,
  model VARCHAR(128) NOT NULL,
  instruction TEXT NULL,
  input_tokens INT NULL,
  output_tokens INT NULL,
  estimated_cost DECIMAL(10, 6) NULL,
  duration_ms INT NULL,
  -- Resumen de lo que propuso la IA (ya validado), para auditar.
  nodes_added INT NOT NULL DEFAULT 0,
  nodes_updated INT NOT NULL DEFAULT 0,
  nodes_removed INT NOT NULL DEFAULT 0,
  edges_added INT NOT NULL DEFAULT 0,
  edges_removed INT NOT NULL DEFAULT 0,
  success BOOLEAN NOT NULL DEFAULT FALSE,
  error_msg TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_canvas_ai_user_created (user_id, created_at),
  INDEX idx_canvas_ai_conversation (conversation_id),
  INDEX idx_canvas_ai_project_created (project_id, created_at)
);
