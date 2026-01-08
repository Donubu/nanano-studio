-- Migration 029: Add audio fields to messages table
-- Stores generated audio URL, metadata, and voice configuration

-- Add audio fields to messages table
ALTER TABLE messages
  ADD COLUMN audio_url TEXT NULL AFTER video_aspect_ratio,
  ADD COLUMN audio_mime_type VARCHAR(50) NULL AFTER audio_url,
  ADD COLUMN audio_file_size INT UNSIGNED NULL AFTER audio_mime_type,
  ADD COLUMN audio_duration INT UNSIGNED NULL AFTER audio_file_size,
  ADD COLUMN audio_voice_config JSON NULL AFTER audio_duration;

-- Add index for audio queries (for gallery/stats)
CREATE INDEX idx_messages_audio_url ON messages(audio_url(100));

-- Update content_type enum to include audio
ALTER TABLE messages MODIFY COLUMN content_type
  ENUM('text', 'image', 'video', 'audio', 'mixed') DEFAULT 'text';
