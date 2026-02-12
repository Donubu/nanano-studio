-- Add api_backend column to models table
-- Allows per-model selection of Vertex AI or Gemini API
-- NULL = use global GOOGLE_GENAI_USE_VERTEXAI env setting
-- 'vertex' = always use Vertex AI for this model
-- 'gemini' = always use Gemini API for this model
ALTER TABLE models ADD COLUMN api_backend VARCHAR(10) DEFAULT NULL;
