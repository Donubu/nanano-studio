-- Add OpenRouter as a new video generation backend (api_backend='openrouter')
-- with two Seedance 2 model variants. cost_video_per_second is left at 0 because
-- Seedance pricing follows tokens = (width * height * duration * 24) / 1024 and
-- is computed at generation time by lib/openrouter-video.ts (returned via
-- GeneratedVideo.actualCost). The route prefers actualCost over the per-second
-- fallback when present.

-- Widen api_backend to give room for future provider names (current is VARCHAR(10);
-- 'openrouter' fits but leaves zero headroom).
ALTER TABLE models MODIFY COLUMN api_backend VARCHAR(20) DEFAULT NULL;

INSERT IGNORE INTO models (
  model_id, display_name, description,
  supports_video_generation, is_active,
  cost_video_per_second, api_backend
) VALUES (
  'bytedance/seedance-2.0', 'Seedance 2.0',
  'ByteDance Seedance 2.0 via OpenRouter. Text-to-video, image-to-video (first/last frame), multimodal reference-to-video. 4-15s, hasta 1080p, audio nativo opcional, seed support. Pricing por tokens (w*h*d*24/1024 * $0.000007).',
  1, 1, 0.000000, 'openrouter'
);

INSERT IGNORE INTO models (
  model_id, display_name, description,
  supports_video_generation, is_active,
  cost_video_per_second, api_backend
) VALUES (
  'bytedance/seedance-2.0-fast', 'Seedance 2.0 Fast',
  'ByteDance Seedance 2.0 Fast via OpenRouter. Misma funcionalidad que 2.0 (text/image/reference-to-video, audio, seed) priorizando velocidad y costo. 4-15s, hasta 720p. Pricing por tokens (w*h*d*24/1024 * $0.0000056).',
  1, 1, 0.000000, 'openrouter'
);

-- Repair api_backend if rows already existed without it (idempotent).
UPDATE models SET api_backend = 'openrouter', supports_video_generation = 1
WHERE model_id IN ('bytedance/seedance-2.0', 'bytedance/seedance-2.0-fast')
  AND (api_backend IS NULL OR api_backend != 'openrouter');
