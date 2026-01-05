-- Tabla de conversaciones/chats
CREATE TABLE IF NOT EXISTS conversations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  project_id INT NULL COMMENT 'Proyecto asociado (opcional)',
  model_id INT NOT NULL,
  title VARCHAR(255) DEFAULT 'Nueva conversación',
  system_instruction TEXT NULL COMMENT 'Instrucción de sistema para el modelo',
  temperature DECIMAL(3,2) DEFAULT 1.00,
  top_p DECIMAL(3,2) DEFAULT 0.95,
  top_k INT DEFAULT 40,
  max_output_tokens INT DEFAULT 8192,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL,
  FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE RESTRICT
);

-- Índices para búsquedas frecuentes
CREATE INDEX idx_conversations_user ON conversations(user_id);
CREATE INDEX idx_conversations_project ON conversations(project_id);
CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);
