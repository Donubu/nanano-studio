-- Migration 068: Add music generation type to conversations and project config
-- Expands generation_type ENUMs and adds music settings to conversations

-- Expand generation_type ENUM in conversations
ALTER TABLE conversations MODIFY COLUMN generation_type
  ENUM('text', 'image', 'video', 'audio', 'music') DEFAULT 'text';

-- Expand generation_type ENUM in project_generation_config
ALTER TABLE project_generation_config MODIFY COLUMN generation_type
  ENUM('text', 'image', 'video', 'audio', 'music') NOT NULL;

-- Add music settings to conversations
ALTER TABLE conversations
  ADD COLUMN music_prompts JSON NULL AFTER audio_locale,
  ADD COLUMN music_bpm INT DEFAULT 120 AFTER music_prompts,
  ADD COLUMN music_density DECIMAL(3, 2) DEFAULT 0.50 AFTER music_bpm,
  ADD COLUMN music_brightness DECIMAL(3, 2) DEFAULT 0.50 AFTER music_density,
  ADD COLUMN music_scale ENUM('C_MAJOR', 'D_MAJOR', 'E_MAJOR', 'F_MAJOR', 'G_MAJOR', 'A_MAJOR', 'B_MAJOR',
    'C_MINOR', 'D_MINOR', 'E_MINOR', 'F_MINOR', 'G_MINOR', 'A_MINOR', 'B_MINOR',
    'UNSPECIFIED') DEFAULT 'UNSPECIFIED' AFTER music_brightness,
  ADD COLUMN music_guidance DECIMAL(4, 2) DEFAULT 3.50 AFTER music_scale,
  ADD COLUMN music_generation_mode ENUM('QUALITY', 'DIVERSE') DEFAULT 'QUALITY' AFTER music_guidance,
  ADD COLUMN music_duration INT DEFAULT 30 AFTER music_generation_mode,
  ADD COLUMN music_mute_bass TINYINT(1) DEFAULT 0 AFTER music_duration,
  ADD COLUMN music_mute_drums TINYINT(1) DEFAULT 0 AFTER music_mute_bass,
  ADD COLUMN music_only_bass_and_drums TINYINT(1) DEFAULT 0 AFTER music_mute_drums;
