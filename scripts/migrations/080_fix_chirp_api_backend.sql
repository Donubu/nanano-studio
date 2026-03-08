-- Fix Chirp model api_backend: should be 'chirp' not 'vertex'
-- The frontend detects Chirp models by api_backend = 'chirp' to create the virtual 'audio_hd' type
UPDATE models SET api_backend = 'chirp' WHERE model_id = 'chirp3-hd';
