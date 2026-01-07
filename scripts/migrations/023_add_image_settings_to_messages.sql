-- Migration 023: Add image_aspect_ratio and image_size to messages table
-- Stores the settings used when each image was generated

ALTER TABLE messages
  ADD COLUMN image_aspect_ratio VARCHAR(10) NULL AFTER image_file_size,
  ADD COLUMN image_size VARCHAR(10) NULL AFTER image_aspect_ratio;
