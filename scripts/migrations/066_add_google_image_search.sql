-- Add Google Image Search grounding support (separate from web search grounding)
-- Only supported by gemini-3.1-flash-image-preview

ALTER TABLE conversations ADD COLUMN google_image_search_enabled TINYINT(1) DEFAULT 0;
