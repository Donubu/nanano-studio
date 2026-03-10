-- Migrate VEO 3.1 models from Vertex AI to Gemini API
-- The code now maps Vertex-style IDs (veo-3.1-generate-001) to Gemini-style IDs (veo-3.1-generate-preview) automatically
UPDATE models SET api_backend = 'gemini' WHERE model_id LIKE 'veo-3.1%';
