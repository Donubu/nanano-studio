-- Migration 132: versiones de un design (master + orientaciones +
-- adaptaciones congeladas juntas, que es lo que se entrega y se aprueba).
--
-- Cada versión es un snapshot explícito (lib/production/design-versions.ts)
-- con estado de aprobación interna: en_revision → aprobada | con_cambios.
-- kind = 'pre_restore' son los respaldos automáticos que se guardan antes
-- de restaurar otra versión (no cuentan como entregas). Entre versiones se
-- sigue editando como siempre; production_templates.version sigue siendo
-- el contador de guardados.

CREATE TABLE IF NOT EXISTS production_design_versions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  design_id INT NOT NULL,
  number INT NOT NULL,
  kind ENUM('manual', 'pre_restore') NOT NULL DEFAULT 'manual',
  label VARCHAR(150) NULL,
  notes TEXT NULL,
  status ENUM('en_revision', 'aprobada', 'con_cambios') NOT NULL DEFAULT 'en_revision',
  snapshot_json LONGTEXT NOT NULL,
  templates_count INT NOT NULL DEFAULT 0,
  adaptations_count INT NOT NULL DEFAULT 0,
  thumbnail_url VARCHAR(1000) NULL,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by INT NULL,
  reviewed_at TIMESTAMP NULL,
  review_notes TEXT NULL,
  -- Los respaldos pre_restore numeran aparte: no consumen vN de entregas.
  UNIQUE KEY uq_design_kind_number (design_id, kind, number),
  INDEX idx_design (design_id),
  CONSTRAINT fk_pdv_design FOREIGN KEY (design_id) REFERENCES production_designs(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
