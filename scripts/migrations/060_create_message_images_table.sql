-- Create message_images table to store all reference images per message
CREATE TABLE IF NOT EXISTS message_images (
    id INT AUTO_INCREMENT PRIMARY KEY,
    message_id INT NOT NULL,
    image_url TEXT NOT NULL,
    mime_type VARCHAR(50) NULL,
    file_size INT UNSIGNED NULL,
    sort_order TINYINT UNSIGNED DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    INDEX idx_message_id (message_id)
);
