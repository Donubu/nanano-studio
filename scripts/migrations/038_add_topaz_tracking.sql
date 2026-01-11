-- Migration 038: Add Topaz upscale tracking to messages
-- Tracks credits consumed for 2x upscaling via Topaz API

-- Add topaz_credits: number of credits consumed (null = not upscaled via Topaz)
ALTER TABLE messages
ADD COLUMN topaz_credits INT DEFAULT NULL
  COMMENT 'Topaz API credits consumed for 2x upscale' AFTER has_2x;

-- Index for analytics queries
CREATE INDEX idx_messages_topaz ON messages(topaz_credits);
