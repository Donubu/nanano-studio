-- Migration 053: Add Gemini 3 Pro Preview model

INSERT INTO models (
  model_id, display_name, description, is_active,
  max_tokens,
  supports_images, supports_audio, supports_video,
  supports_image_generation, supports_video_generation, supports_audio_generation,
  supports_reference_images,
  cost_input_per_million, cost_output_per_million
) VALUES (
  'gemini-3-pro-preview',
  'Gemini 3 Pro Preview',
  'Modelo de última generación con razonamiento avanzado (Deep Think), 1M de contexto. Soporta texto, imágenes, audio, video y PDF como entrada.',
  1,
  65536,
  1, 1, 1,
  0, 0, 0,
  0,
  2.000000, 12.000000
);
