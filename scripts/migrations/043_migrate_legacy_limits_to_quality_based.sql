-- Migrar limites legacy a los campos nuevos por calidad
-- Los campos legacy (max_monthly_image_generations, max_monthly_video_generations)
-- se copian a los campos nuevos (normal y hq) para que las cuotas se apliquen correctamente.
-- Solo actualiza filas donde los campos nuevos estan en 0 (default) y los legacy tienen valor.

-- Imagen: copiar limite legacy a normal y hq
UPDATE project_users
SET max_monthly_image_normal = max_monthly_image_generations,
    max_monthly_image_hq = max_monthly_image_generations
WHERE max_monthly_image_generations > 0
  AND max_monthly_image_normal = 0
  AND max_monthly_image_hq = 0;

-- Video: copiar limite legacy a normal y hq
UPDATE project_users
SET max_monthly_video_normal = max_monthly_video_generations,
    max_monthly_video_hq = max_monthly_video_generations
WHERE max_monthly_video_generations > 0
  AND max_monthly_video_normal = 0
  AND max_monthly_video_hq = 0;
