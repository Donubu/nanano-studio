-- Per-user gate for OpenRouter models (Seedance 2.0, Seedance 2.0 Fast, …).
-- OpenRouter is paid out-of-pocket, so even when an admin adds a Seedance
-- model to a project's generation_models, only users with this flag set to
-- 1 (or with role='admin', who bypass the gate) can list / execute it.
-- Default 0 means existing users have to be explicitly granted.
ALTER TABLE users
  ADD COLUMN can_use_openrouter BOOLEAN NOT NULL DEFAULT 0 AFTER can_create_projects;
