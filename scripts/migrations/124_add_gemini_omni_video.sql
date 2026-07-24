-- Gemini Omni (interactions API) como nuevo backend de video: api_backend='omni'.
-- provider_generation_ref: referencia opaca de generación del proveedor. Para Omni
-- guarda el interaction_id (v1_...) creado con store=true, lo que habilita la fase 2
-- (edición conversacional vía previous_interaction_id) sin re-migrar. NULL para el
-- resto de proveedores.
ALTER TABLE messages
  ADD COLUMN provider_generation_ref VARCHAR(128) NULL AFTER generation_seed;

INSERT IGNORE INTO models (
  model_id, display_name, description,
  supports_video_generation, is_active, cost_video_per_second, api_backend
) VALUES (
  'gemini-omni-flash-preview', 'Gemini Omni Flash (Preview)',
  'Video con audio integrado vía interactions API de Gemini. 720p/24fps fijo, 16:9 o 9:16. La duración se pide en el prompt. Sin negative prompt ni seed. ~$0.10/segundo.',
  1, 1, 0.100000, 'omni'
);

-- Reparación idempotente si la fila ya existía con otro backend.
UPDATE models SET api_backend = 'omni', supports_video_generation = 1
WHERE model_id = 'gemini-omni-flash-preview'
  AND (api_backend IS NULL OR api_backend != 'omni');
