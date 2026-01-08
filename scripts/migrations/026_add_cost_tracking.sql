-- Migration 026: Add cost tracking to models and messages
-- Enables cost estimation based on model pricing and usage

-- ============================================
-- MODELS TABLE: Add pricing columns
-- ============================================

-- Cost per million tokens (standard Vertex AI pricing format)
ALTER TABLE models
ADD COLUMN cost_input_per_million DECIMAL(10,6) DEFAULT 0
  COMMENT 'Cost in USD per 1 million input tokens' AFTER supports_video_generation,
ADD COLUMN cost_output_per_million DECIMAL(10,6) DEFAULT 0
  COMMENT 'Cost in USD per 1 million output tokens' AFTER cost_input_per_million;

-- Cost per image by resolution (for Imagen and similar models)
ALTER TABLE models
ADD COLUMN cost_image_1k DECIMAL(10,6) DEFAULT 0
  COMMENT 'Cost in USD per image at 1K resolution (1024px)' AFTER cost_output_per_million,
ADD COLUMN cost_image_2k DECIMAL(10,6) DEFAULT 0
  COMMENT 'Cost in USD per image at 2K resolution (2048px)' AFTER cost_image_1k,
ADD COLUMN cost_image_4k DECIMAL(10,6) DEFAULT 0
  COMMENT 'Cost in USD per image at 4K resolution (4096px)' AFTER cost_image_2k;

-- Cost per second of video (for VEO models)
ALTER TABLE models
ADD COLUMN cost_video_per_second DECIMAL(10,6) DEFAULT 0
  COMMENT 'Cost in USD per second of generated video' AFTER cost_image_4k;

-- ============================================
-- MESSAGES TABLE: Add estimated cost column
-- ============================================

ALTER TABLE messages
ADD COLUMN estimated_cost DECIMAL(10,6) DEFAULT 0
  COMMENT 'Estimated cost in USD for this generation' AFTER tokens_output;

-- ============================================
-- CONVERSATIONS TABLE: Add total cost column
-- ============================================

ALTER TABLE conversations
ADD COLUMN total_estimated_cost DECIMAL(12,6) DEFAULT 0
  COMMENT 'Total estimated cost in USD for all messages' AFTER total_tokens_output;

-- ============================================
-- Set approximate pricing for existing models
-- Prices as of early 2025 (USD)
-- ============================================

-- Gemini 2.0 Flash (economical)
UPDATE models SET
  cost_input_per_million = 0.10,
  cost_output_per_million = 0.40,
  cost_image_1k = 0.02
WHERE model_id LIKE '%gemini-2.0-flash%' OR model_id LIKE '%gemini-2.5-flash%';

-- Gemini 2.5 Pro (premium)
UPDATE models SET
  cost_input_per_million = 1.25,
  cost_output_per_million = 5.00,
  cost_image_1k = 0.03,
  cost_image_2k = 0.04
WHERE model_id LIKE '%gemini-2.5-pro%' OR model_id LIKE '%gemini-3-pro%';

-- Gemini Flash Lite (very economical)
UPDATE models SET
  cost_input_per_million = 0.075,
  cost_output_per_million = 0.30
WHERE model_id LIKE '%flash-lite%';

-- Imagen models (image generation)
UPDATE models SET
  cost_image_1k = 0.02,
  cost_image_2k = 0.04,
  cost_image_4k = 0.08
WHERE model_id LIKE '%imagen%';

-- VEO 3 models (video generation)
UPDATE models SET
  cost_video_per_second = 0.35
WHERE model_id LIKE '%veo-3.0%';

-- VEO 3.1 models (video generation, slightly more expensive)
UPDATE models SET
  cost_video_per_second = 0.40
WHERE model_id LIKE '%veo-3.1%';

-- ============================================
-- Verification
-- ============================================

SELECT
  model_id,
  display_name,
  cost_input_per_million,
  cost_output_per_million,
  cost_image_1k,
  cost_image_2k,
  cost_image_4k,
  cost_video_per_second
FROM models
WHERE is_active = 1;
