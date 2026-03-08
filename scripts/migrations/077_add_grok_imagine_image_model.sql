-- Add Grok Imagine Image model
INSERT IGNORE INTO models (model_id, display_name, api_backend, is_active, supports_image_generation, cost_image_1k, cost_image_2k)
VALUES ('grok-imagine-image', 'Grok Imagine Image', 'xai', 1, 1, 0.020000, 0.040000);
