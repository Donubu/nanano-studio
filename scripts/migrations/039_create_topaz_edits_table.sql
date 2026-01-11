-- Migration 039: Create topaz_edits table for Topaz Studio
-- Tracks all image processing operations done through Topaz API

CREATE TABLE IF NOT EXISTS topaz_edits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  message_id INT NOT NULL COMMENT 'Reference to original message with image',
  original_url VARCHAR(500) NOT NULL COMMENT 'Original image URL',
  result_url VARCHAR(500) NOT NULL COMMENT 'Processed image URL',

  -- Processing details
  model VARCHAR(50) NOT NULL COMMENT 'Topaz model: Standard V2, High Fidelity V2, Low Resolution V2, CGI, Text Refine, Wonder',
  scale_factor DECIMAL(3,1) NOT NULL COMMENT 'Scale factor: 2.0, 3.0, 4.0, 5.0, 6.0',

  -- Input dimensions
  input_width INT NOT NULL,
  input_height INT NOT NULL,

  -- Output dimensions
  output_width INT NOT NULL,
  output_height INT NOT NULL,
  output_megapixels DECIMAL(10,4) NOT NULL,

  -- Parameters stored as JSON for flexibility
  parameters JSON COMMENT 'All Topaz parameters: creativity, texture, sharpen, denoise, detail, face_enhancement, etc.',

  -- Cost tracking
  credits_consumed INT NOT NULL DEFAULT 1,

  -- Processing metadata
  processing_time_ms INT DEFAULT NULL COMMENT 'Time taken to process in milliseconds',
  output_format VARCHAR(10) DEFAULT 'png' COMMENT 'jpeg, png, tiff',
  output_file_size INT DEFAULT NULL COMMENT 'File size in bytes',

  -- Timestamps
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

  -- Foreign key
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);

-- Indexes for efficient queries
CREATE INDEX idx_topaz_edits_message ON topaz_edits(message_id);
CREATE INDEX idx_topaz_edits_model ON topaz_edits(model);
CREATE INDEX idx_topaz_edits_created ON topaz_edits(created_at);
