-- Migration 070: Add music generation limits to project_users
-- Adds monthly limits for normal and HQ music generation

ALTER TABLE project_users
  ADD COLUMN max_monthly_music_normal INT DEFAULT 0
    COMMENT 'Monthly limit for normal quality music generations'
    AFTER max_monthly_audio_chirp,
  ADD COLUMN max_monthly_music_hq INT DEFAULT 0
    COMMENT 'Monthly limit for HQ music generations'
    AFTER max_monthly_music_normal;
