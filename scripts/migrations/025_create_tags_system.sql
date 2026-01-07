-- Migration 025: Create tags system for organizing generated content
-- Includes tags table, message_tags junction table, and soft delete for messages

-- Create tags table
CREATE TABLE IF NOT EXISTS tags (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  name VARCHAR(50) NOT NULL,
  color VARCHAR(7) DEFAULT '#6366f1' COMMENT 'Hex color for tag display',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  UNIQUE KEY unique_tag_per_project (project_id, name),
  INDEX idx_tags_project (project_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create message_tags junction table
CREATE TABLE IF NOT EXISTS message_tags (
  id INT AUTO_INCREMENT PRIMARY KEY,
  message_id INT NOT NULL,
  tag_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE,
  UNIQUE KEY unique_message_tag (message_id, tag_id),
  INDEX idx_message_tags_message (message_id),
  INDEX idx_message_tags_tag (tag_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Add soft delete to messages table
ALTER TABLE messages
ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL AFTER created_at;

-- Add index for soft delete queries
CREATE INDEX idx_messages_deleted_at ON messages(deleted_at);

-- Verify migration
SELECT 'Tags table created' as status;
SELECT 'Message_tags junction table created' as status;
SELECT 'Soft delete added to messages' as status;
