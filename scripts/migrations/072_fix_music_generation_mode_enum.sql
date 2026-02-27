-- Fix music_generation_mode enum: rename DIVERSE to DIVERSITY to match Google GenAI SDK
ALTER TABLE conversations
  MODIFY COLUMN music_generation_mode ENUM('QUALITY', 'DIVERSITY') DEFAULT 'QUALITY';

-- Update any existing rows that had the old value
UPDATE conversations SET music_generation_mode = 'QUALITY' WHERE music_generation_mode IS NULL;
