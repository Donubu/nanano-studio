-- Migrate all Gemini models to Gemini API (instead of Vertex AI)
-- Gemini API has better/faster support for new features (thinkingConfig, includeThoughts, etc.)
-- Only updates models that don't already have a specific api_backend set
UPDATE models SET api_backend = 'gemini' WHERE model_id LIKE 'gemini-%' AND (api_backend IS NULL OR api_backend = 'vertex');
