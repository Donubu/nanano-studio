-- Canvas nodes: each node in a conversation's canvas
CREATE TABLE canvas_nodes (
  id VARCHAR(64) NOT NULL,
  conversation_id INT NOT NULL,
  type ENUM('text','image','video','note','static-text','static-image','static-image-group','params-text','params-image','params-video') NOT NULL,
  label VARCHAR(255) NOT NULL DEFAULT '',
  position_x DOUBLE NOT NULL DEFAULT 0,
  position_y DOUBLE NOT NULL DEFAULT 0,
  width DOUBLE NULL,
  height DOUBLE NULL,
  config JSON NOT NULL,
  status ENUM('idle','generating','completed','error') NOT NULL DEFAULT 'idle',
  output_message_id INT NULL,
  output_url VARCHAR(2048) NULL,
  output_text TEXT NULL,
  error_message TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id, conversation_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  INDEX idx_canvas_nodes_conv (conversation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Canvas edges: connections between nodes
CREATE TABLE canvas_edges (
  id VARCHAR(64) NOT NULL,
  conversation_id INT NOT NULL,
  source_node_id VARCHAR(64) NOT NULL,
  source_handle VARCHAR(64) NULL,
  target_node_id VARCHAR(64) NOT NULL,
  target_handle VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id, conversation_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  INDEX idx_canvas_edges_conv (conversation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
