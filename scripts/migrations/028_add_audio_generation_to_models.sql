-- Migration 028: Add audio generation (TTS) support to models table
-- Adds supports_audio_generation flag, cost field, and inserts Gemini TTS models

-- Add audio generation support flag
ALTER TABLE models ADD COLUMN supports_audio_generation TINYINT(1) DEFAULT 0
  AFTER supports_video_generation;

-- Add audio cost per minute
ALTER TABLE models ADD COLUMN cost_audio_per_minute DECIMAL(10, 6) DEFAULT 0
  AFTER cost_video_per_second;

-- Insert Gemini 2.5 Flash TTS model
INSERT INTO models (
  model_id, display_name, description,
  supports_audio, supports_audio_generation, is_active
) VALUES (
  'gemini-2.5-flash-preview-tts',
  'Gemini 2.5 Flash TTS',
  'Text-to-speech de baja latencia. Soporta 30 voces, multi-speaker, 24 idiomas y control de estilo.',
  TRUE, TRUE, TRUE
);

-- Insert Gemini 2.5 Pro TTS model
INSERT INTO models (
  model_id, display_name, description,
  supports_audio, supports_audio_generation, is_active
) VALUES (
  'gemini-2.5-pro-preview-tts',
  'Gemini 2.5 Pro TTS',
  'Text-to-speech de alta calidad. Voces más expresivas y mayor control de entonación.',
  TRUE, TRUE, TRUE
);
