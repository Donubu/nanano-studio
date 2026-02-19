-- Migration 056: Add Chirp 3 HD TTS support
-- Adds Chirp model, generation config column, user limits, conversation settings, and custom voices table

-- 1. Insert Chirp 3 HD model
INSERT INTO models (model_id, display_name, description, supports_audio_generation, is_active, cost_audio_per_minute, api_backend)
VALUES ('chirp3-hd', 'Chirp 3 HD TTS', 'Google Cloud TTS Chirp 3 HD. 30 voces, 51 idiomas, SSML, control de velocidad.', 1, 1, 0.000160, 'vertex');

-- 2. Add model_chirp_id column to project_generation_config
ALTER TABLE project_generation_config
  ADD COLUMN model_chirp_id INT NULL COMMENT 'Modelo para calidad Chirp HD' AFTER model_hq_id,
  ADD CONSTRAINT fk_pgc_chirp FOREIGN KEY (model_chirp_id) REFERENCES models(id) ON DELETE SET NULL;

-- 3. Add monthly Chirp limit to project_users
ALTER TABLE project_users
  ADD COLUMN max_monthly_audio_chirp INT DEFAULT 0 AFTER max_monthly_audio_hq;

-- 4. Add Chirp fields to conversations
ALTER TABLE conversations
  ADD COLUMN audio_tts_engine ENUM('gemini', 'chirp') DEFAULT 'gemini' AFTER audio_output_format,
  ADD COLUMN audio_speaking_rate DECIMAL(3,2) DEFAULT 1.00 AFTER audio_tts_engine,
  ADD COLUMN audio_locale VARCHAR(10) DEFAULT 'en-US' AFTER audio_speaking_rate;

-- 5. Create table for Custom Voices (phase 2, schema prepared now)
CREATE TABLE IF NOT EXISTS user_voice_clones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  name VARCHAR(100) NOT NULL,
  description TEXT NULL,
  voice_cloning_key TEXT NOT NULL,
  reference_audio_url TEXT NULL,
  locale VARCHAR(10) DEFAULT 'en-US',
  is_active TINYINT(1) DEFAULT 1,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_uvc_user_active (user_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
