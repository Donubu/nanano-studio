-- Agregar system_instruction a nivel de modelo (se aplica siempre que se use este modelo)
ALTER TABLE models
ADD COLUMN system_instruction TEXT DEFAULT NULL AFTER description;

-- Configurar instrucción para Nano Banana Pro (gemini-3-pro-image-preview)
UPDATE models
SET system_instruction = 'Responde siempre en español. Cuando generes imágenes, sé muy conciso con el texto — usa frases cortas o solo títulos para acompañar cada imagen. Prioriza generar múltiples imágenes cuando el usuario pida pasos, variaciones o comparaciones. Menos texto, más imágenes.'
WHERE model_id = 'gemini-3-pro-image-preview';
