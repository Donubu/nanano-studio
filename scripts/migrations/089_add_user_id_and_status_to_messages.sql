-- Add user_id to messages so we know who generated each message/asset
-- Add status to track generation lifecycle (generating → completed / error)
ALTER TABLE messages
  ADD COLUMN user_id INT NULL AFTER conversation_id,
  ADD COLUMN status ENUM('generating','completed','error') NOT NULL DEFAULT 'completed' AFTER role;

-- Backfill existing messages with the conversation owner's user_id
UPDATE messages m
  JOIN conversations c ON m.conversation_id = c.id
  SET m.user_id = c.user_id;

-- Add index for efficient polling of generating messages
ALTER TABLE messages ADD INDEX idx_messages_status (status);
ALTER TABLE messages ADD INDEX idx_messages_user_id (user_id);
