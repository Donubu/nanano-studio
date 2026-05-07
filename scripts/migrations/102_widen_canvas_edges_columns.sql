-- Widen canvas_edges columns. The previous VARCHAR(64) caused
-- "Data too long for column 'id'" when xyflow auto-generated edge IDs by
-- concatenating long source/target node IDs and their handles
-- (e.g. xy-edge__params-scene-node-4-output-params-scene-node-4-1-input-scene-params).
ALTER TABLE canvas_edges
  MODIFY COLUMN id VARCHAR(255) NOT NULL,
  MODIFY COLUMN source_node_id VARCHAR(128) NOT NULL,
  MODIFY COLUMN target_node_id VARCHAR(128) NOT NULL,
  MODIFY COLUMN source_handle VARCHAR(128) NULL,
  MODIFY COLUMN target_handle VARCHAR(128) NULL;

-- canvas_nodes uses VARCHAR(64) IDs which is fine today (node-N, scene-node-X-N,
-- dst-node-X-N), but bump to VARCHAR(128) defensively to match edges.
ALTER TABLE canvas_nodes
  MODIFY COLUMN id VARCHAR(128) NOT NULL;
