-- Revierte: vuelve a HABILITAR el tipo TEXTO en TODOS los proyectos.
-- (Deshacer el efecto de disable-text-chat-all-projects.sql)
--
-- El gate real de "solo admin puede crear texto" se hará en el frontend, no
-- con este flag. Este flag debe quedar en 1 para que el admin siga viendo y
-- pudiendo administrar los modelos de texto en la config del proyecto.
--
-- Compatible con MySQL 5.7 (local) y 8.x (prod).

-- 1) Prender texto en todos los proyectos que YA tienen fila 'text'.
UPDATE project_generation_config
SET is_enabled = 1,
    updated_at = CURRENT_TIMESTAMP
WHERE generation_type = 'text'
  AND is_enabled = 0;

-- 2) Crear fila 'text' habilitada para proyectos que no la tengan
--    (así "todos los proyectos" quedan cubiertos, no solo los preexistentes).
INSERT INTO project_generation_config (project_id, generation_type, is_enabled)
SELECT p.id, 'text', 1
FROM projects p
LEFT JOIN project_generation_config pgc
  ON pgc.project_id = p.id AND pgc.generation_type = 'text'
WHERE pgc.id IS NULL;

-- 3) Verificación: debe dar 0 (no debe quedar ningún proyecto con texto apagado).
SELECT COUNT(*) AS text_apagados_restantes
FROM project_generation_config
WHERE generation_type = 'text' AND is_enabled = 0;
