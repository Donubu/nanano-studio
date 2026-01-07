-- Migration 024: Separate image and video generation limits
-- Replaces single max_monthly_generations with separate limits for images and videos

-- Add new columns for separate limits
ALTER TABLE project_users
ADD COLUMN max_monthly_image_generations INT DEFAULT 0 AFTER max_monthly_generations,
ADD COLUMN max_monthly_video_generations INT DEFAULT 0 AFTER max_monthly_image_generations;

-- Migrate existing data: if max_monthly_generations was set, apply to both types
UPDATE project_users
SET max_monthly_image_generations = max_monthly_generations,
    max_monthly_video_generations = max_monthly_generations
WHERE max_monthly_generations > 0;

-- Verify migration
SELECT
  id,
  project_id,
  user_id,
  max_monthly_generations as old_limit,
  max_monthly_image_generations as image_limit,
  max_monthly_video_generations as video_limit
FROM project_users;
