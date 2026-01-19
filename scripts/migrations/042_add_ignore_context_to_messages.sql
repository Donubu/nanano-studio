-- Add ignore_in_context column to messages table
-- This allows users to mark messages to be excluded from the context sent to the model

ALTER TABLE messages
ADD COLUMN ignore_in_context TINYINT(1) DEFAULT 0
COMMENT 'Si es 1, este mensaje no se incluye en el historial enviado al modelo';

-- Index for filtering messages by ignore status (improves query performance)
CREATE INDEX idx_messages_ignore_context ON messages(ignore_in_context);
