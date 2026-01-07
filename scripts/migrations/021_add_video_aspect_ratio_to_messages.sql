-- Migration 021: Add video_aspect_ratio to messages table
-- Stores the aspect ratio used when the video was generated

ALTER TABLE messages
  ADD COLUMN video_aspect_ratio VARCHAR(10) NULL AFTER video_has_audio;
