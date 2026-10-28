-- Migration 130: slug de cliente + guía de marca traída de practicante.
--
--   * slug — identificador compartido con practicante (Client.slug allá).
--     Los nombres no coinciden entre plataformas; el slug es la llave.
--   * brand_guide_json — snapshot de lo que practicante sabe de la marca
--     (voz, tratamiento, palabras a usar/evitar, reglas visuales del
--     brandbook). Se trae a pedido ("Sincronizar") y la IA de producción lo
--     lee de acá: nunca se consulta practicante en medio de una generación.
--   * brand_guide_synced_at — cuándo se trajo.

ALTER TABLE clients
  ADD COLUMN slug VARCHAR(64) NULL AFTER name,
  ADD COLUMN brand_guide_json JSON NULL,
  ADD COLUMN brand_guide_synced_at TIMESTAMP NULL,
  ADD UNIQUE KEY uq_clients_slug (slug);
