-- Migration 067: Add music generation support to models table
-- Adds supports_music_generation flag, cost field, and inserts Lyria model

-- Add music generation support flag
ALTER TABLE models ADD COLUMN supports_music_generation TINYINT(1) DEFAULT 0
  AFTER supports_audio_generation;

-- Add music cost per minute
ALTER TABLE models ADD COLUMN cost_music_per_minute DECIMAL(10, 6) DEFAULT 0
  AFTER cost_audio_per_minute;

-- Insert Lyria Realtime model
-- cost_music_per_minute: currently free (experimental), set to 0 until Google announces pricing
INSERT INTO models (
  model_id, display_name, description,
  supports_music_generation, cost_music_per_minute, is_active
) VALUES (
  'lyria-realtime-exp',
  'Lyria Realtime (Experimental)',
  'Generacion de musica instrumental en tiempo real. Soporta control de BPM, densidad, brillo, escala y guia. Solo instrumental con watermark.',
  TRUE, 0.000000, TRUE
);
