-- Migration 020: Add video fields to messages table
-- Extends content_type enum and adds video-specific columns

-- Extend content_type enum to include 'video'
ALTER TABLE messages MODIFY COLUMN content_type ENUM('text', 'image', 'video', 'mixed') DEFAULT 'text';

-- Add video-specific fields
ALTER TABLE messages
  ADD COLUMN video_url TEXT NULL AFTER image_file_size,
  ADD COLUMN video_mime_type VARCHAR(50) NULL AFTER video_url,
  ADD COLUMN video_file_size INT UNSIGNED NULL AFTER video_mime_type,
  ADD COLUMN video_duration TINYINT NULL AFTER video_file_size,
  ADD COLUMN video_has_audio TINYINT(1) DEFAULT 0 AFTER video_duration;

-- Index for video URLs (for video gallery queries)
CREATE INDEX idx_messages_video_url ON messages(video_url(100));
