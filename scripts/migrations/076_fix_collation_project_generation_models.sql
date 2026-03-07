-- Fix collation mismatch on project_generation_models table
ALTER TABLE project_generation_models CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
