CREATE TABLE canvas_executions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  node_id VARCHAR(64) NOT NULL,
  node_type ENUM('text','image','video') NOT NULL,
  run_id VARCHAR(64) NULL COMMENT 'Groups nodes executed in the same Run All',
  model_name VARCHAR(255) NULL,
  status ENUM('completed','error') NOT NULL,
  duration_ms INT NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  output_message_id INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  INDEX idx_exec_conv (conversation_id),
  INDEX idx_exec_node (conversation_id, node_id),
  INDEX idx_exec_run (run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
