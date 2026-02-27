-- Migration 071: Fix music_scale column to use SDK-compatible scale values
-- Changes ENUM to VARCHAR to support combined scale names (e.g. C_MAJOR_A_MINOR)

ALTER TABLE conversations MODIFY COLUMN music_scale VARCHAR(50) DEFAULT 'UNSPECIFIED';
