-- Add Google Search grounding support

-- conversations: toggle per conversation
ALTER TABLE conversations ADD COLUMN google_search_enabled TINYINT(1) DEFAULT 0;

-- models: capability flag
ALTER TABLE models ADD COLUMN supports_google_search TINYINT(1) DEFAULT 0;

-- Enable for gemini-3.1-flash-image-preview
UPDATE models SET supports_google_search = 1 WHERE model_id = 'gemini-3.1-flash-image-preview';

-- messages: store grounding metadata (sources, searchEntryPointHtml, webSearchQueries)
ALTER TABLE messages ADD COLUMN grounding_data JSON NULL;
