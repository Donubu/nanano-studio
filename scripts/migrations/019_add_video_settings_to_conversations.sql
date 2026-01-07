-- Migration 019: Add video generation settings to conversations table
-- Settings for video duration, resolution, aspect ratio, audio, and negative prompt

ALTER TABLE conversations
  ADD COLUMN video_duration TINYINT DEFAULT 8 AFTER image_size,
  ADD COLUMN video_resolution VARCHAR(10) DEFAULT '720p' AFTER video_duration,
  ADD COLUMN video_aspect_ratio VARCHAR(10) DEFAULT '16:9' AFTER video_resolution,
  ADD COLUMN video_audio_enabled TINYINT(1) DEFAULT 1 AFTER video_aspect_ratio,
  ADD COLUMN video_negative_prompt TEXT NULL AFTER video_audio_enabled;
