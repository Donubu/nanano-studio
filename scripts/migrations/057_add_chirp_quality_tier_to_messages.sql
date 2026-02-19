-- Add 'chirp' to quality_tier ENUM in messages table
ALTER TABLE messages
MODIFY COLUMN quality_tier ENUM('normal', 'hq', 'chirp') DEFAULT 'normal';

-- Change default locale for audio conversations to es-US
ALTER TABLE conversations
ALTER COLUMN audio_locale SET DEFAULT 'es-US';
