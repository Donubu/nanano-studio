-- Migration 114: production_ai_invocations.
--
-- Registra cada llamada al Banner Designer (o futuros agentes especialistas
-- de producción) para auditoría y cost tracking. Cada fila representa una
-- invocación discreta — no agrupa retries dentro de la misma conversación
-- (esos se distinguen por created_at consecutivo + mismo conversation_id).
--
-- Pensada para:
--   * Sumar costos por proyecto / período en el dashboard de billing.
--   * Auditar qué propuso la IA antes de que el productor aceptara o rechazara.
--   * Detectar agentes con tasa de error alta (success = FALSE consistente).

CREATE TABLE production_ai_invocations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  production_project_id INT NOT NULL,
  -- Master template del que parte la invocación. Para ADAPT, también
  -- guardamos target_template_id; para GENERATE, queda NULL (la operación
  -- crea el master).
  template_id INT NULL,
  target_template_id INT NULL,
  -- Banner Designer expone dos operaciones; otros agentes futuros pueden
  -- agregar valores. ENUM en lugar de FK porque las operaciones viven en
  -- código (BANNERS.md), no en tabla.
  operation VARCHAR(64) NOT NULL,
  agent_name VARCHAR(128) NOT NULL,
  -- Tokens reportados por practicante. NULL si no llegaron (fallo de red,
  -- timeout antes del usage).
  input_tokens INT NULL,
  output_tokens INT NULL,
  -- Estimated cost en USD según practicante (Anthropic pricing).
  estimated_cost DECIMAL(10, 6) NULL,
  -- success = TRUE si el agente devolvió JSON válido tras los retries y el
  -- productor recibió el preview. NO refleja si lo aceptó (eso es otro evento
  -- del lado del editor).
  success BOOLEAN NOT NULL DEFAULT FALSE,
  -- Si success = FALSE, el motivo (error de parseo, retry agotado, timeout, etc.).
  error_msg TEXT NULL,
  -- conversation_id que practicante devuelve. Permite agrupar retries y
  -- también seguir la cadena si el productor hace varias rondas seguidas.
  conversation_id VARCHAR(128) NULL,
  -- rationale corto que el agente devuelve junto con la definition. Útil para
  -- mostrar al productor "qué decidió" sin abrir el JSON. TEXT por si crece.
  rationale TEXT NULL,
  -- created_by = quien disparó la acción (NextAuth user id).
  created_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (production_project_id) REFERENCES production_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES production_templates(id) ON DELETE SET NULL,
  FOREIGN KEY (target_template_id) REFERENCES production_templates(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_prodai_project_date (production_project_id, created_at),
  INDEX idx_prodai_template (template_id),
  INDEX idx_prodai_target (target_template_id),
  INDEX idx_prodai_conversation (conversation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
