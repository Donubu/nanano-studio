-- Migration 069: Add music fields to messages table
-- Stores generated music URL, metadata, and configuration

-- Expand content_type ENUM to include music
ALTER TABLE messages MODIFY COLUMN content_type
  ENUM('text', 'image', 'video', 'audio', 'music', 'mixed', 'error') DEFAULT 'text';

-- Add music fields to messages table
ALTER TABLE messages
  ADD COLUMN music_url TEXT NULL AFTER audio_voice_config,
  ADD COLUMN music_mime_type VARCHAR(50) NULL AFTER music_url,
  ADD COLUMN music_file_size INT UNSIGNED NULL AFTER music_mime_type,
  ADD COLUMN music_duration INT UNSIGNED NULL AFTER music_file_size,
  ADD COLUMN music_config JSON NULL AFTER music_duration;

-- Add index for music queries
CREATE INDEX idx_messages_music_url ON messages(music_url(100));
