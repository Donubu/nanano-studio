-- Add public sharing support for conversations (Studio mode)
ALTER TABLE conversations
  ADD COLUMN share_token VARCHAR(64) NULL AFTER deleted_at,
  ADD COLUMN shared_at TIMESTAMP NULL AFTER share_token,
  ADD UNIQUE INDEX idx_conversations_share_token (share_token);

-- Track public share visits
CREATE TABLE share_visits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  ip_address VARCHAR(45) NOT NULL,
  user_agent TEXT NULL,
  referer VARCHAR(512) NULL,
  visited_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  INDEX idx_share_visits_conversation (conversation_id),
  INDEX idx_share_visits_date (visited_at),
  INDEX idx_share_visits_dedup (conversation_id, ip_address, visited_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
