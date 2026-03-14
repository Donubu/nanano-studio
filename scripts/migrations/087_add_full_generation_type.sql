-- Add 'full' (Estudio) generation type for mixed image+video workspace
ALTER TABLE conversations
  MODIFY COLUMN generation_type ENUM('text','image','video','audio','music','full') NOT NULL DEFAULT 'text';

ALTER TABLE project_generation_config
  MODIFY COLUMN generation_type ENUM('text','image','video','audio','music','full') NOT NULL;
