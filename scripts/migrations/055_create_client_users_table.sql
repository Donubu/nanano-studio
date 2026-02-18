CREATE TABLE client_users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  client_id INT NOT NULL,
  user_id INT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY unique_client_user (client_id, user_id),
  INDEX idx_client_id (client_id),
  INDEX idx_user_id (user_id)
);
