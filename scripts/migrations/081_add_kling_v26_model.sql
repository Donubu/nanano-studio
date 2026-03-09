-- Add Kling v2.6 Video model
INSERT IGNORE INTO models (
  model_id, display_name, description,
  supports_video_generation, is_active,
  cost_video_per_second, api_backend
) VALUES (
  'kling-v2-6', 'Kling v2.6 Video',
  'Kling AI v2.6 video generation. Text-to-video e image-to-video. 5s y 10s, 720p (std) y 1080p (pro). Audio nativo opcional.',
  1, 1, 0.150000, 'kling'
);

-- Ensure api_backend is set (in case model was added manually without it)
UPDATE models SET api_backend = 'kling', supports_video_generation = 1,
  cost_video_per_second = 0.150000
WHERE model_id = 'kling-v2-6' AND (api_backend IS NULL OR api_backend != 'kling');
