-- Migration 119: Add Gemini 3.1 Flash TTS model
-- Sucesor de los TTS 2.5. Mismo flujo de generateContent en lib/google-ai-audio.ts;
-- solo cambia el model_id.
--
-- Costo: el audio de Gemini TTS se factura a 25 tokens/seg => 1.500 tokens/min.
-- El sistema cobra el audio por minuto (cost_audio_per_minute, ver
-- lib/cost-calculator.ts). Output $20/1M -> 1500*20/1e6 = $0.030000/min.
--
-- api_backend = 'gemini' para igualar a los TTS 2.5 ya existentes en prod (todos
-- usan el backend Gemini API). Dejarlo NULL heredaría el default de env
-- (isVertexAI), que en prod podría enrutar a Vertex AI por error.

INSERT INTO models (
  model_id, display_name, description,
  supports_audio, supports_audio_generation,
  cost_audio_per_minute, api_backend, is_active
) VALUES (
  'gemini-3.1-flash-tts-preview',
  'Gemini 3.1 Flash TTS',
  'Text-to-speech de última generación. 200+ audio tags para controlar tono, ritmo, acento y emoción. Multi-speaker, 90+ idiomas, streaming y watermark SynthID.',
  TRUE, TRUE,
  0.030000, 'gemini', TRUE
);
