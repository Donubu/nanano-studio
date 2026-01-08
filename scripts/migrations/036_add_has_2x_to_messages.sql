-- Add has_2x field to messages table to track if 2x upscaled version exists
-- This is set to true after the first successful upscale operation

ALTER TABLE messages
ADD COLUMN has_2x TINYINT(1) NOT NULL DEFAULT 0 AFTER image_size;

-- Add index for potential filtering
CREATE INDEX idx_messages_has_2x ON messages(has_2x);
