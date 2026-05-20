-- Migration 107: Production area tables
-- New isolated area for producing banner sets from a master template + adaptations.
-- All tables prefixed `production_*`. MVP scope: static JPG only, admin-only access.

-- Production projects: parallel to `projects` but lives in its own table to avoid
-- impacting the existing creation flow. Linked to clients(id).
CREATE TABLE production_projects (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  status ENUM('active','paused','completed','archived') NOT NULL DEFAULT 'active',
  hidden BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_prodproj_client (client_id),
  INDEX idx_prodproj_status (status),
  INDEX idx_prodproj_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Brand kits: design tokens scoped to a client. Manual entry only in MVP.
CREATE TABLE production_brand_kits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  name VARCHAR(150) NOT NULL,
  colors_json JSON NULL,
  typography_json JSON NULL,
  logos_json JSON NULL,
  spacing_json JSON NULL,
  rules_text TEXT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_prodbk_client (client_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Format presets: catalog of output sizes grouped by channel.
-- Seeded with system presets (is_system=1). Per-client custom presets allowed.
CREATE TABLE production_format_presets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  channel ENUM('gdn','meta','instagram','linkedin','x','tiktok','youtube','email','print','custom') NOT NULL,
  group_name VARCHAR(100) NULL,
  name VARCHAR(150) NOT NULL,
  width INT NOT NULL,
  height INT NOT NULL,
  orientation ENUM('horizontal','vertical','square') NOT NULL,
  file_size_max_kb INT NULL,
  is_system BOOLEAN NOT NULL DEFAULT TRUE,
  client_id INT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  INDEX idx_prodfp_channel (channel),
  INDEX idx_prodfp_client (client_id),
  INDEX idx_prodfp_system (is_system)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Templates: the master composition. `definition_json` holds the layer graph
-- (frames, text, image, shape) with auto-layout + constraints + token refs.
-- LONGTEXT (not JSON) because we may store large compositions and don't need
-- MySQL-side JSON queries on this column.
CREATE TABLE production_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  production_project_id INT NOT NULL,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  base_width INT NOT NULL DEFAULT 1080,
  base_height INT NOT NULL DEFAULT 1080,
  definition_json LONGTEXT NOT NULL,
  thumbnail_url VARCHAR(1000) NULL,
  brand_kit_id INT NULL,
  status ENUM('draft','published','archived') NOT NULL DEFAULT 'draft',
  version INT NOT NULL DEFAULT 1,
  created_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL DEFAULT NULL,
  FOREIGN KEY (production_project_id) REFERENCES production_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (brand_kit_id) REFERENCES production_brand_kits(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_prodtpl_project (production_project_id),
  INDEX idx_prodtpl_status (status),
  INDEX idx_prodtpl_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Adaptations: one per output format. `overrides_json` stores deltas over the
-- master keyed by layer id. NULL format_preset_id = custom size.
CREATE TABLE production_template_adaptations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT NOT NULL,
  format_preset_id INT NULL,
  custom_name VARCHAR(150) NULL,
  width INT NOT NULL,
  height INT NOT NULL,
  overrides_json LONGTEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  thumbnail_url VARCHAR(1000) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (template_id) REFERENCES production_templates(id) ON DELETE CASCADE,
  FOREIGN KEY (format_preset_id) REFERENCES production_format_presets(id) ON DELETE SET NULL,
  INDEX idx_prodadp_template (template_id),
  INDEX idx_prodadp_preset (format_preset_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Variables declared for a template, resolved from datasets or manual input.
CREATE TABLE production_template_variables (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT NOT NULL,
  var_key VARCHAR(100) NOT NULL,
  var_type ENUM('text','number','image_url','color','boolean') NOT NULL DEFAULT 'text',
  default_value TEXT NULL,
  label VARCHAR(150) NULL,
  description TEXT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (template_id) REFERENCES production_templates(id) ON DELETE CASCADE,
  UNIQUE KEY uniq_prodvar_template_key (template_id, var_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Datasets: CSV/XLSX uploads. rows_json holds parsed rows for small datasets;
-- larger ones can be migrated to S3 later (add a rows_s3_url column then).
CREATE TABLE production_datasets (
  id INT AUTO_INCREMENT PRIMARY KEY,
  production_project_id INT NOT NULL,
  template_id INT NULL,
  name VARCHAR(255) NOT NULL,
  source_filename VARCHAR(255) NULL,
  columns_json JSON NULL,
  rows_json LONGTEXT NULL,
  row_count INT NOT NULL DEFAULT 0,
  created_by INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (production_project_id) REFERENCES production_projects(id) ON DELETE CASCADE,
  FOREIGN KEY (template_id) REFERENCES production_templates(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_prodds_project (production_project_id),
  INDEX idx_prodds_template (template_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Renders: export jobs. MVP supports only JPG; ENUM expandable for png/mp4/etc.
CREATE TABLE production_renders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  template_id INT NOT NULL,
  dataset_id INT NULL,
  selected_adaptation_ids JSON NOT NULL,
  selected_row_ids JSON NULL,
  output_format ENUM('jpg') NOT NULL DEFAULT 'jpg',
  jpg_quality INT NOT NULL DEFAULT 85,
  status ENUM('queued','running','done','error','partial') NOT NULL DEFAULT 'queued',
  progress_pct INT NOT NULL DEFAULT 0,
  total_assets INT NOT NULL DEFAULT 0,
  completed_assets INT NOT NULL DEFAULT 0,
  output_archive_url VARCHAR(1000) NULL,
  per_asset_results_json LONGTEXT NULL,
  error_message TEXT NULL,
  created_by INT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  started_at TIMESTAMP NULL DEFAULT NULL,
  finished_at TIMESTAMP NULL DEFAULT NULL,
  FOREIGN KEY (template_id) REFERENCES production_templates(id) ON DELETE CASCADE,
  FOREIGN KEY (dataset_id) REFERENCES production_datasets(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_prodrnd_template (template_id),
  INDEX idx_prodrnd_status (status),
  INDEX idx_prodrnd_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
