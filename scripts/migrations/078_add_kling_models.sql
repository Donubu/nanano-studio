-- Add Kling v3 Omni Video model
INSERT IGNORE INTO models (
  model_id, display_name, description,
  supports_video_generation, is_active,
  cost_video_per_second, api_backend
) VALUES (
  'kling-v3-omni', 'Kling v3 Omni Video',
  'Kling AI video generation. Text-to-video e image-to-video. 3-15s, 720p (std) y 1080p (pro). Audio nativo opcional.',
  1, 1, 0.230000, 'kling'
);

-- Ensure api_backend is set (in case model was added manually without it)
UPDATE models SET api_backend = 'kling', supports_video_generation = 1,
  cost_video_per_second = 0.230000
WHERE model_id = 'kling-v3-omni' AND (api_backend IS NULL OR api_backend != 'kling');

-- Add Kling Omni Image model
INSERT IGNORE INTO models (
  model_id, display_name, description,
  supports_image_generation, is_active,
  cost_image_1k, cost_image_2k, api_backend
) VALUES (
  'kling-omni-image', 'Kling Omni Image',
  'Kling AI image generation. Text-to-image con imagenes de referencia. Resoluciones 1k y 2k.',
  1, 1, 0.010000, 0.020000, 'kling'
);

-- Ensure api_backend is set (in case model was added manually without it)
UPDATE models SET api_backend = 'kling', supports_image_generation = 1,
  cost_image_1k = 0.010000, cost_image_2k = 0.020000
WHERE model_id = 'kling-omni-image' AND (api_backend IS NULL OR api_backend != 'kling');
