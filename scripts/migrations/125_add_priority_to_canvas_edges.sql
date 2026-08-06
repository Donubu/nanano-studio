-- Prioridad opcional de un edge de referencia (canvas).
-- NULL = neutro (comportamiento histórico: orden de creación, sin inyección
-- de prompt). 1 = máxima prioridad. Solo se usa en edges cuyo target handle
-- es input-reference; en el resto se ignora.
ALTER TABLE canvas_edges ADD COLUMN priority TINYINT NULL AFTER target_handle;
