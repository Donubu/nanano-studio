-- Migration 034: Separate generation limits by quality tier
-- Replaces single limits with normal/hq splits for each generation type

-- Agregar limites separados por calidad para IMAGENES
ALTER TABLE project_users
ADD COLUMN max_monthly_image_normal INT DEFAULT 0
  COMMENT 'Limite mensual de imagenes calidad normal (0 = sin limite)'
  AFTER max_monthly_video_generations,
ADD COLUMN max_monthly_image_hq INT DEFAULT 0
  COMMENT 'Limite mensual de imagenes calidad HQ (0 = sin limite)'
  AFTER max_monthly_image_normal;

-- Agregar limites separados por calidad para VIDEO
ALTER TABLE project_users
ADD COLUMN max_monthly_video_normal INT DEFAULT 0
  COMMENT 'Limite mensual de videos calidad normal (0 = sin limite)'
  AFTER max_monthly_image_hq,
ADD COLUMN max_monthly_video_hq INT DEFAULT 0
  COMMENT 'Limite mensual de videos calidad HQ (0 = sin limite)'
  AFTER max_monthly_video_normal;

-- Agregar limites para AUDIO (normal y HQ)
ALTER TABLE project_users
ADD COLUMN max_monthly_audio_normal INT DEFAULT 0
  COMMENT 'Limite mensual de audios calidad normal (0 = sin limite)'
  AFTER max_monthly_video_hq,
ADD COLUMN max_monthly_audio_hq INT DEFAULT 0
  COMMENT 'Limite mensual de audios calidad HQ (0 = sin limite)'
  AFTER max_monthly_audio_normal;

-- Agregar limites para TEXTO (normal y HQ)
ALTER TABLE project_users
ADD COLUMN max_monthly_text_normal INT DEFAULT 0
  COMMENT 'Limite mensual de textos calidad normal (0 = sin limite)'
  AFTER max_monthly_audio_hq,
ADD COLUMN max_monthly_text_hq INT DEFAULT 0
  COMMENT 'Limite mensual de textos calidad HQ (0 = sin limite)'
  AFTER max_monthly_text_normal;

-- Migrar datos existentes: asignar limites antiguos a 'normal'
-- Los limites HQ quedan en 0 (sin limite) por defecto
UPDATE project_users
SET max_monthly_image_normal = COALESCE(max_monthly_image_generations, 0),
    max_monthly_video_normal = COALESCE(max_monthly_video_generations, 0)
WHERE max_monthly_image_generations > 0 OR max_monthly_video_generations > 0;

-- Nota: Las columnas antiguas (max_monthly_image_generations, max_monthly_video_generations)
-- se mantienen por retrocompatibilidad. Se pueden eliminar en una migracion futura
-- despues de verificar que todo funciona correctamente.
