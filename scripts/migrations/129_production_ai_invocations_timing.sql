-- Migration 129: latencia y modelo por invocación de IA de producción.
--
--   * duration_ms — tiempo de pared de la llamada al modelo/agente (incluye
--     el retry de validación si lo hubo). Línea base para comparar el
--     Banner Designer de practicante contra las llamadas directas a Gemini.
--   * model — id del modelo cuando lo llamamos directo (ej. gemini-3.8-flash).
--     NULL en las invocaciones vía practicante: ahí el modelo lo define el
--     agente y no viene en la respuesta.

ALTER TABLE production_ai_invocations
  ADD COLUMN model VARCHAR(64) NULL AFTER agent_name,
  ADD COLUMN duration_ms INT NULL AFTER estimated_cost;
