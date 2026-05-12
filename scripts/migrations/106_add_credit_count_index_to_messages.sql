-- Migration 106: Composite index to accelerate monthly client credit usage counting
-- Query target:
--   SELECT COUNT(*) FROM messages m
--   JOIN conversations c ... JOIN projects p ...
--   WHERE p.client_id = ? AND m.role='assistant' AND m.status='completed'
--     AND m.content_type IN ('image','video')
--     AND m.created_at >= ? AND m.created_at < ?

ALTER TABLE messages
  ADD INDEX idx_messages_credit_count (content_type, status, created_at);
