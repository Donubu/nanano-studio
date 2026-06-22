-- Migration 122: Desactivar los modelos Gemini 2.5 TTS legacy
--
-- Tras las migraciones 120 (proyectos) y 121 (templates), ningún proyecto ni
-- template referencia ya los 4 modelos Gemini 2.5 TTS (Flash, Pro y sus
-- duplicados con prefijo 'models/'). Se marcan is_active = 0 para que NO
-- reaparezcan en los selectores de modelo y nadie vuelva a quedar en legacy 2.5.
--
-- NO afecta generaciones históricas: los messages ya guardan su model_id y costo;
-- is_active solo controla la disponibilidad en los pickers.
-- Chirp (chirp3-hd) y Gemini 3.1 Flash TTS quedan activos.
--
-- Reversible: UPDATE models SET is_active = 1 WHERE model_id IN (...).

UPDATE models SET is_active = 0
  WHERE model_id IN (
    'gemini-2.5-flash-preview-tts',
    'gemini-2.5-pro-preview-tts',
    'models/gemini-2.5-flash-preview-tts',
    'models/gemini-2.5-pro-preview-tts'
  );
