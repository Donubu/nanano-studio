-- Store model reasoning/thought content from thinking-enabled models
ALTER TABLE messages ADD COLUMN thought MEDIUMTEXT DEFAULT NULL AFTER content;
