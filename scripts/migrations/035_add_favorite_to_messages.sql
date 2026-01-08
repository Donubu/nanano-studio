-- Migration 035: Add favorite flag to messages
-- Allows marking assets (images, videos, audio) as favorites within a project
-- This is a global favorite (shared across all project users, not personal)

-- Add favorite flag to messages
ALTER TABLE messages
ADD COLUMN is_favorite TINYINT(1) DEFAULT 0
  COMMENT 'Marca el asset como favorito dentro del proyecto (global, no personal)'
  AFTER quality_tier;

-- Index for filtering favorites within a project (via conversation)
CREATE INDEX idx_messages_favorite ON messages(is_favorite);

-- Composite index for fetching favorites by type within conversations
CREATE INDEX idx_messages_favorite_content ON messages(is_favorite, content_type);
