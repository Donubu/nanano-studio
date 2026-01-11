-- Migration 040: Create topaz_video_edits table for Topaz Video Studio
-- Tracks all video processing operations done through Topaz Video API
-- Unlike image processing, video uses async workflow with status tracking

CREATE TABLE IF NOT EXISTS topaz_video_edits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  message_id INT NOT NULL COMMENT 'Reference to original message with video',

  -- Topaz API async tracking
  topaz_request_id VARCHAR(100) NULL COMMENT 'Topaz API request ID for async workflow',

  -- URLs
  original_url VARCHAR(500) NOT NULL COMMENT 'Original video URL',
  result_url VARCHAR(500) NULL COMMENT 'Processed video URL (null until complete)',

  -- Processing details
  model VARCHAR(50) NOT NULL COMMENT 'Topaz model code: prob-4, ahq-12, nyx-3, rhea-1, ghq-5, apo-8, chr-2',
  model_name VARCHAR(50) NOT NULL COMMENT 'Human-readable: Proteus, Artemis, Nyx, Rhea, Gaia, Apollo, Chronos',

  -- Input video metadata
  input_duration DECIMAL(10,2) NOT NULL COMMENT 'Input video duration in seconds',
  input_width INT NULL,
  input_height INT NULL,
  input_fps DECIMAL(6,2) NULL COMMENT 'Input frames per second',
  input_file_size INT NULL COMMENT 'Input file size in bytes',

  -- Output video metadata (populated after completion)
  output_duration DECIMAL(10,2) NULL COMMENT 'Output duration (different for slowmo)',
  output_width INT NULL,
  output_height INT NULL,
  output_fps DECIMAL(6,2) NULL COMMENT 'Output frames per second',
  output_file_size INT NULL COMMENT 'Output file size in bytes',

  -- Enhancement parameters stored as JSON
  parameters JSON COMMENT 'Model-specific params: scale_factor, slowmo_factor, denoise, sharpen, target_fps, output_format',

  -- Cost tracking
  credits_estimated INT NOT NULL DEFAULT 0 COMMENT 'Credits estimated at request creation',
  credits_consumed INT NULL COMMENT 'Credits actually consumed (after completion)',

  -- Async status tracking
  status ENUM('pending', 'accepted', 'uploading', 'processing', 'completed', 'failed', 'cancelled')
    DEFAULT 'pending' COMMENT 'Current processing status',
  error_message TEXT NULL COMMENT 'Error details if failed',

  -- Processing metadata
  processing_started_at TIMESTAMP NULL COMMENT 'When Topaz started processing',
  processing_completed_at TIMESTAMP NULL COMMENT 'When processing finished',
  processing_time_ms INT NULL COMMENT 'Total processing time in milliseconds',

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- Foreign key
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- Indexes for efficient queries
CREATE INDEX idx_topaz_video_edits_message ON topaz_video_edits(message_id);
CREATE INDEX idx_topaz_video_edits_request ON topaz_video_edits(topaz_request_id);
CREATE INDEX idx_topaz_video_edits_status ON topaz_video_edits(status);
CREATE INDEX idx_topaz_video_edits_model ON topaz_video_edits(model);
CREATE INDEX idx_topaz_video_edits_created ON topaz_video_edits(created_at);

-- Add topaz_video_credits to messages table for tracking accumulated credits
ALTER TABLE messages
ADD COLUMN topaz_video_credits INT DEFAULT NULL
  COMMENT 'Topaz Video API credits consumed for video enhancement';
