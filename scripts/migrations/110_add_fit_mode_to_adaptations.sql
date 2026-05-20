-- Migration 110: Add fit_mode to production_template_adaptations.
-- Controls how the master tree is fit into an adaptation's canvas:
--   contain      → uniform scale, entire master visible, may letterbox
--   cover        → uniform scale, fills the adaptation, may crop
--   width        → scale to match adaptation width, crops/extends vertically
--   height       → scale to match adaptation height, crops/extends horizontally
--   responsive   → use per-layer constraints (HTML-like fluid layout)
-- Default is 'contain' because it's the most predictable for new users:
-- everything visible, nothing cropped.

ALTER TABLE production_template_adaptations
ADD COLUMN fit_mode ENUM('contain', 'cover', 'width', 'height', 'responsive')
NOT NULL DEFAULT 'contain'
AFTER overrides_json;
