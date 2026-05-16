-- Migration 108: Seed system format presets for Production area.
-- Grouped by channel; group_name allows visual sub-grouping in the picker UI.
-- sort_order leaves gaps (10, 20, 30...) to allow inserts without renumbering.

-- Google Display Network ----------------------------------------------------
INSERT INTO production_format_presets
  (channel, group_name, name, width, height, orientation, file_size_max_kb, is_system, sort_order)
VALUES
  ('gdn', 'Display estándar', 'Medium Rectangle (300×250)',     300,  250, 'horizontal', 150, TRUE, 10),
  ('gdn', 'Display estándar', 'Large Rectangle (336×280)',      336,  280, 'horizontal', 150, TRUE, 20),
  ('gdn', 'Display estándar', 'Leaderboard (728×90)',           728,   90, 'horizontal', 150, TRUE, 30),
  ('gdn', 'Display estándar', 'Large Leaderboard (970×90)',     970,   90, 'horizontal', 150, TRUE, 40),
  ('gdn', 'Display estándar', 'Billboard (970×250)',            970,  250, 'horizontal', 150, TRUE, 50),
  ('gdn', 'Display estándar', 'Banner (468×60)',                468,   60, 'horizontal', 150, TRUE, 60),
  ('gdn', 'Display estándar', 'Half Page (300×600)',            300,  600, 'vertical',   150, TRUE, 70),
  ('gdn', 'Display estándar', 'Wide Skyscraper (160×600)',      160,  600, 'vertical',   150, TRUE, 80),
  ('gdn', 'Display móvil',    'Mobile Banner (320×50)',         320,   50, 'horizontal', 150, TRUE, 90),
  ('gdn', 'Display móvil',    'Large Mobile Banner (320×100)',  320,  100, 'horizontal', 150, TRUE, 100);

-- Meta / Facebook -----------------------------------------------------------
INSERT INTO production_format_presets
  (channel, group_name, name, width, height, orientation, is_system, sort_order)
VALUES
  ('meta', 'Feed',             'Feed cuadrado (1080×1080)',     1080, 1080, 'square',     TRUE, 10),
  ('meta', 'Feed',             'Feed vertical (1080×1350)',     1080, 1350, 'vertical',   TRUE, 20),
  ('meta', 'Feed',             'Link Ad (1200×628)',            1200,  628, 'horizontal', TRUE, 30);

-- Instagram -----------------------------------------------------------------
INSERT INTO production_format_presets
  (channel, group_name, name, width, height, orientation, is_system, sort_order)
VALUES
  ('instagram', 'Feed',              'Feed cuadrado (1080×1080)', 1080, 1080, 'square',   TRUE, 10),
  ('instagram', 'Feed',              'Feed vertical (1080×1350)', 1080, 1350, 'vertical', TRUE, 20),
  ('instagram', 'Stories & Reels',   'Stories / Reels (1080×1920)', 1080, 1920, 'vertical', TRUE, 30);

-- LinkedIn ------------------------------------------------------------------
INSERT INTO production_format_presets
  (channel, group_name, name, width, height, orientation, is_system, sort_order)
VALUES
  ('linkedin', 'Display', 'Single Image Ad (1200×627)', 1200,  627, 'horizontal', TRUE, 10),
  ('linkedin', 'Display', 'Square (1080×1080)',         1080, 1080, 'square',     TRUE, 20),
  ('linkedin', 'Stories', 'Story (1080×1920)',          1080, 1920, 'vertical',   TRUE, 30);

-- X / Twitter ---------------------------------------------------------------
INSERT INTO production_format_presets
  (channel, group_name, name, width, height, orientation, is_system, sort_order)
VALUES
  ('x', 'Display', 'Single Image (1600×900)', 1600,  900, 'horizontal', TRUE, 10),
  ('x', 'Display', 'Card Image (1200×675)',   1200,  675, 'horizontal', TRUE, 20),
  ('x', 'Header',  'Header (1500×500)',       1500,  500, 'horizontal', TRUE, 30);

-- TikTok --------------------------------------------------------------------
INSERT INTO production_format_presets
  (channel, group_name, name, width, height, orientation, is_system, sort_order)
VALUES
  ('tiktok', 'Vertical', 'Full vertical (1080×1920)', 1080, 1920, 'vertical', TRUE, 10);

-- YouTube -------------------------------------------------------------------
INSERT INTO production_format_presets
  (channel, group_name, name, width, height, orientation, is_system, sort_order)
VALUES
  ('youtube', 'Thumbnail', 'Thumbnail HD (1920×1080)', 1920, 1080, 'horizontal', TRUE, 10),
  ('youtube', 'Thumbnail', 'Thumbnail (1280×720)',     1280,  720, 'horizontal', TRUE, 20),
  ('youtube', 'Shorts',    'Shorts (1080×1920)',       1080, 1920, 'vertical',   TRUE, 30);

-- Email ---------------------------------------------------------------------
INSERT INTO production_format_presets
  (channel, group_name, name, width, height, orientation, is_system, sort_order)
VALUES
  ('email', 'Hero',  'Hero ancho (600×300)',  600, 300, 'horizontal', TRUE, 10),
  ('email', 'Hero',  'Hero cuadrado (600×600)', 600, 600, 'square',   TRUE, 20),
  ('email', 'Hero',  'Hero alto (600×900)',   600, 900, 'vertical',   TRUE, 30);
