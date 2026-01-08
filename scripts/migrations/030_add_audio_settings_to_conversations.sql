-- Migration 030: Add audio settings to conversations table
-- Stores TTS configuration: voice, style, multi-speaker, output format

-- Add audio configuration columns to conversations
ALTER TABLE conversations
  ADD COLUMN audio_voice_id VARCHAR(50) DEFAULT 'Kore' AFTER video_negative_prompt,
  ADD COLUMN audio_style_prompt TEXT NULL AFTER audio_voice_id,
  ADD COLUMN audio_multi_speaker TINYINT(1) DEFAULT 0 AFTER audio_style_prompt,
  ADD COLUMN audio_speaker_config JSON NULL AFTER audio_multi_speaker,
  ADD COLUMN audio_output_format ENUM('wav', 'mp3') DEFAULT 'mp3' AFTER audio_speaker_config;
