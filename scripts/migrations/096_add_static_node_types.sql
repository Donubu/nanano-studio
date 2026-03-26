ALTER TABLE canvas_nodes
  MODIFY COLUMN type ENUM('text','image','video','note','static-text','static-image','static-image-group') NOT NULL;
