-- Migration 103: Add monthly image/video credit limits to clients
-- These define the baseline monthly quota at the client/marca level.
-- Convention:
--   NULL = ilimitado (sin política configurada)
--   0    = bloqueado explícito
--   N>0  = límite mensual de generaciones

ALTER TABLE clients
  ADD COLUMN monthly_image_limit INT NULL DEFAULT NULL
    COMMENT 'Cuota mensual de imágenes (NULL = ilimitado, 0 = bloqueado)',
  ADD COLUMN monthly_video_limit INT NULL DEFAULT NULL
    COMMENT 'Cuota mensual de videos (NULL = ilimitado, 0 = bloqueado)';
