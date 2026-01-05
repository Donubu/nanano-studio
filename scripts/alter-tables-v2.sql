-- Agregar max_monthly_generations a project_users
ALTER TABLE project_users
ADD COLUMN max_monthly_generations INT DEFAULT 0 AFTER role;

-- Agregar campos para soft delete y bloqueo en users
ALTER TABLE users
ADD COLUMN blocked_at TIMESTAMP NULL DEFAULT NULL AFTER updated_at,
ADD COLUMN deleted_at TIMESTAMP NULL DEFAULT NULL AFTER blocked_at;

-- Índice para soft delete
CREATE INDEX idx_deleted_at ON users(deleted_at);
