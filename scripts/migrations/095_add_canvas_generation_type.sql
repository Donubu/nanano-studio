ALTER TABLE conversations
  MODIFY COLUMN generation_type ENUM('text','image','video','audio','music','full','canvas') NOT NULL DEFAULT 'text';

ALTER TABLE project_generation_config
  MODIFY COLUMN generation_type ENUM('text','image','video','audio','music','full','canvas') NOT NULL;
