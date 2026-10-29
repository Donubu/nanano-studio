-- Migration 133: elimina user_voice_clones.
--
-- La creó la migración 056 (Chirp TTS) para clonación de voz por usuario,
-- pero ninguna ruta ni lib la lee o escribe y está vacía en local y en
-- producción (verificado 2026-10-29). Si la clonación de voz se construye,
-- se vuelve a crear con el diseño de ese momento.

DROP TABLE IF EXISTS user_voice_clones;
