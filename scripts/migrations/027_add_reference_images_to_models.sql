-- Add supports_reference_images column to models table
-- Only certain video models (like veo-3.1-generate-preview) support reference images

ALTER TABLE models
ADD COLUMN supports_reference_images BOOLEAN DEFAULT FALSE;

-- Enable reference images for veo-3.1-generate-preview (model_id may have 'models/' prefix)
UPDATE models
SET supports_reference_images = TRUE
WHERE model_id LIKE '%veo-3.1-generate-preview';
