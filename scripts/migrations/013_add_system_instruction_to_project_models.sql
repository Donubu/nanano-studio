-- Agregar instrucción del sistema base a la relación proyecto-modelo
ALTER TABLE project_models
ADD COLUMN system_instruction TEXT NULL AFTER is_default;

-- Verificar cambios
DESCRIBE project_models;
