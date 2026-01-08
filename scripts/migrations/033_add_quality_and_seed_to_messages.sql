-- Migration 033: Add quality tier and seed to messages
-- Tracks whether generation was normal or HQ, and stores seed for reproducibility

-- Agregar indicador de calidad a mensajes (normal o HQ)
ALTER TABLE messages
ADD COLUMN quality_tier ENUM('normal', 'hq') DEFAULT 'normal'
  COMMENT 'Nivel de calidad: normal o hq (alta calidad)'
  AFTER content_type;

-- Agregar seed para reproducibilidad (algunas APIs lo devuelven)
ALTER TABLE messages
ADD COLUMN generation_seed BIGINT NULL
  COMMENT 'Seed usado en la generacion para reproducibilidad'
  AFTER quality_tier;

-- Indice para filtrar por calidad
CREATE INDEX idx_messages_quality ON messages(quality_tier);

-- Indice compuesto para conteo de generaciones por tipo y calidad
CREATE INDEX idx_messages_quality_created ON messages(quality_tier, created_at);

-- Marcar todas las generaciones existentes como 'normal'
-- (ya tienen el default, pero forzamos para asegurar consistencia)
UPDATE messages SET quality_tier = 'normal' WHERE quality_tier IS NULL;
