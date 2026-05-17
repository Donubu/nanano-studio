-- Migration 111: Production Designs.
-- Un "Design" agrupa varios templates que son variantes orientadas del mismo
-- concepto creativo (cuadrado, vertical, horizontal, etc.). Las adaptaciones
-- se siguen creando por template, pero el productor puede ver los hermanos
-- del design para elegir cuál variante adaptar a cada formato de salida.
--
-- El template puede vivir suelto (design_id NULL) o ser parte de un design.

CREATE TABLE production_designs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  production_project_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  created_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  FOREIGN KEY (production_project_id) REFERENCES production_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_proddes_project (production_project_id),
  INDEX idx_proddes_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE production_templates
ADD COLUMN design_id INT NULL AFTER production_project_id,
ADD CONSTRAINT fk_prodtpl_design FOREIGN KEY (design_id) REFERENCES production_designs(id) ON DELETE SET NULL,
ADD INDEX idx_prodtpl_design (design_id);
