-- Project templates for quick project setup
CREATE TABLE IF NOT EXISTS project_templates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT NULL,
  config JSON NOT NULL COMMENT 'Full generation config: { text: { enabled, models }, image: {...}, ... }',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);
