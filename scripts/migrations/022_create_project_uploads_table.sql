-- Migration: Create project_uploads table for user-uploaded images
-- These images are shared across all users in the project

CREATE TABLE IF NOT EXISTS project_uploads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  project_id INT NOT NULL,
  user_id INT NOT NULL,
  image_url TEXT NOT NULL,
  original_filename VARCHAR(255),
  file_size INT UNSIGNED,
  mime_type VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_project_uploads_project (project_id),
  INDEX idx_project_uploads_created (created_at DESC),

  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
