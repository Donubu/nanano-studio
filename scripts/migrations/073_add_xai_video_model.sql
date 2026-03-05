-- Add xAI Grok Imagine Video model
-- api_backend = 'xai' for routing to xAI API instead of Google AI
INSERT INTO models (model_id, display_name, description, supports_video_generation, is_active, cost_video_per_second, api_backend)
VALUES ('grok-imagine-video', 'Grok Imagine Video', 'xAI video generation. Text-to-video e image-to-video. 1-15s, hasta 720p, aspect ratios: 1:1, 16:9, 9:16, 4:3, 3:4, 3:2, 2:3. Sin audio.', 1, 1, 0.050, 'xai');
