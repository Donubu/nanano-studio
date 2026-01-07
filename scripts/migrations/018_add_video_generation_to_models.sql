-- Migration 018: Add video generation support to models table
-- Adds supports_video_generation flag and inserts VEO 3 and VEO 3.1 video models

-- Add video generation support flag
ALTER TABLE models ADD COLUMN supports_video_generation TINYINT(1) DEFAULT 0 AFTER supports_image_generation;

-- Insert VEO 3 Fast model
INSERT INTO models (model_id, display_name, description, supports_video, supports_video_generation, is_active) VALUES
('veo-3.0-fast-generate-001', 'VEO 3 Fast', 'Generación rápida de video con audio nativo. Soporta text-to-video, first frame, last frame y reference images.', TRUE, TRUE, TRUE);

-- Insert VEO 3.1 Fast model
INSERT INTO models (model_id, display_name, description, supports_video, supports_video_generation, is_active) VALUES
('veo-3.1-fast-generate-001', 'VEO 3.1 Fast', 'Video avanzado con mejor calidad. Soporta text-to-video, first/last frame interpolation y hasta 3 reference images.', TRUE, TRUE, TRUE);
