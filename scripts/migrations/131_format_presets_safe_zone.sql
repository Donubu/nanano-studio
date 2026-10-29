-- Migration 131: zona segura por preset de formato.
--
-- safe_zone_json = {"top":px,"right":px,"bottom":px,"left":px}: franjas que
-- la interfaz de la plataforma tapa o recorta (stories, TikTok, portada de
-- X…). NULL = usar el valor por defecto por canal y proporción de
-- lib/production/safe-zone.ts. Lo leen el chequeo de diseño, el motor de
-- adaptación y el editor de la adaptación.

ALTER TABLE production_format_presets
  ADD COLUMN safe_zone_json JSON NULL AFTER file_size_max_kb;
