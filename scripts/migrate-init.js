#!/usr/bin/env node

/**
 * Migration Init Script
 *
 * Run this ONCE on an existing production database to initialize the _migrations table
 * with all migrations that have already been executed manually.
 *
 * This script:
 * 1. Creates the _migrations table
 * 2. Detects which migrations have already been applied (by checking if tables/columns exist)
 * 3. Marks them as executed
 *
 * After running this once, use the regular migrate.js for future migrations.
 *
 * Usage: node scripts/migrate-init.js
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Load environment variables in development
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config({ path: '.env.local' });
  } catch {
    // dotenv not available
  }
}

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

async function getConnection() {
  const config = {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306'),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'nanano',
  };

  console.log(`[Init] Connecting to ${config.host}:${config.port}/${config.database}...`);
  return mysql.createConnection(config);
}

async function tableExists(connection, tableName) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) as count FROM information_schema.tables
     WHERE table_schema = DATABASE() AND table_name = ?`,
    [tableName]
  );
  return rows[0].count > 0;
}

async function columnExists(connection, tableName, columnName) {
  const [rows] = await connection.execute(
    `SELECT COUNT(*) as count FROM information_schema.columns
     WHERE table_schema = DATABASE() AND table_name = ? AND column_name = ?`,
    [tableName, columnName]
  );
  return rows[0].count > 0;
}

// Map of migration files to their detection logic
// If the check returns true, the migration is considered already applied
const migrationChecks = {
  '001_create_models_table.sql': (c) => tableExists(c, 'models'),
  '002_create_conversations_table.sql': (c) => tableExists(c, 'conversations'),
  '003_create_messages_table.sql': (c) => tableExists(c, 'messages'),
  '004_create_project_models_table.sql': (c) => tableExists(c, 'project_models'),
  '005_add_images_to_messages.sql': (c) => columnExists(c, 'messages', 'image_url'),
  '011_add_image_settings_to_conversations.sql': (c) => columnExists(c, 'conversations', 'image_aspect_ratio'),
  '012_add_image_generation_to_models.sql': (c) => columnExists(c, 'models', 'supports_image_generation'),
  '013_add_system_instruction_to_project_models.sql': (c) => columnExists(c, 'project_models', 'system_instruction'),
  '014_add_soft_delete_to_conversations.sql': (c) => columnExists(c, 'conversations', 'deleted_at'),
  '015_add_request_data_to_messages.sql': (c) => columnExists(c, 'messages', 'request_data'),
  '016_add_token_totals_to_conversations.sql': (c) => columnExists(c, 'conversations', 'total_tokens_input'),
  '017_add_file_size_to_messages.sql': (c) => columnExists(c, 'messages', 'file_size'),
  '018_add_video_generation_to_models.sql': (c) => columnExists(c, 'models', 'supports_video_generation'),
  '019_add_video_settings_to_conversations.sql': (c) => columnExists(c, 'conversations', 'video_duration'),
  '020_add_video_fields_to_messages.sql': (c) => columnExists(c, 'messages', 'video_url'),
  '021_add_video_aspect_ratio_to_messages.sql': (c) => columnExists(c, 'messages', 'video_aspect_ratio'),
  '022_create_project_uploads_table.sql': (c) => tableExists(c, 'project_uploads'),
  '023_add_image_settings_to_messages.sql': (c) => columnExists(c, 'messages', 'image_aspect_ratio'),
  '024_separate_generation_limits.sql': (c) => columnExists(c, 'project_users', 'video_generation_limit'),
  '025_create_tags_system.sql': (c) => tableExists(c, 'tags'),
  '026_add_cost_tracking.sql': (c) => columnExists(c, 'messages', 'estimated_cost'),
  '027_add_reference_images_to_models.sql': (c) => columnExists(c, 'models', 'supports_reference_images'),
  '028_add_audio_generation_to_models.sql': (c) => columnExists(c, 'models', 'supports_audio_generation'),
  '029_add_audio_fields_to_messages.sql': (c) => columnExists(c, 'messages', 'audio_url'),
  '030_add_audio_settings_to_conversations.sql': (c) => columnExists(c, 'conversations', 'audio_voice_id'),
  '031_add_project_generation_config.sql': (c) => tableExists(c, 'project_generation_config'),
  '032_add_generation_type_to_conversations.sql': (c) => columnExists(c, 'conversations', 'generation_type'),
  '033_add_quality_and_seed_to_messages.sql': (c) => columnExists(c, 'messages', 'quality_tier'),
  '034_add_quality_limits_to_project_users.sql': (c) => columnExists(c, 'project_users', 'image_hq_limit'),
  '035_add_favorite_to_messages.sql': (c) => columnExists(c, 'messages', 'is_favorite'),
  '036_add_has_2x_to_messages.sql': (c) => columnExists(c, 'messages', 'has_2x'),
  '037_create_gcp_costs_table.sql': (c) => tableExists(c, 'gcp_daily_costs'),
  '038_add_topaz_tracking.sql': (c) => columnExists(c, 'messages', 'topaz_credits'),
  '039_create_topaz_edits_table.sql': (c) => tableExists(c, 'topaz_edits'),
  '040_create_topaz_video_edits_table.sql': (c) => tableExists(c, 'topaz_video_edits'),
  '041_fix_gcp_usage_amount_range.sql': async (c) => {
    // Check if column type was changed - harder to detect, assume yes if table exists
    return tableExists(c, 'gcp_daily_costs');
  },
  '042_add_ignore_context_to_messages.sql': (c) => columnExists(c, 'messages', 'ignore_in_context'),
};

async function init() {
  console.log('[Init] Initializing migrations table for existing database...');

  let connection;

  try {
    connection = await getConnection();
    console.log('[Init] Connected to database');

    // Create migrations table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS _migrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    console.log('[Init] Migrations table created');

    // Get all migration files
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    console.log(`[Init] Found ${files.length} migration files`);

    // Check each migration
    let markedCount = 0;
    for (const file of files) {
      const checkFn = migrationChecks[file];

      if (!checkFn) {
        console.log(`[Init] ${file} - NO CHECK DEFINED, skipping`);
        continue;
      }

      const isApplied = await checkFn(connection);

      if (isApplied) {
        // Check if already in _migrations table
        const [existing] = await connection.execute(
          'SELECT id FROM _migrations WHERE name = ?',
          [file]
        );

        if (existing.length === 0) {
          await connection.execute(
            'INSERT INTO _migrations (name) VALUES (?)',
            [file]
          );
          console.log(`[Init] ${file} - MARKED as executed`);
          markedCount++;
        } else {
          console.log(`[Init] ${file} - already tracked`);
        }
      } else {
        console.log(`[Init] ${file} - NOT applied (will run on next migrate)`);
      }
    }

    console.log(`[Init] Done! Marked ${markedCount} migrations as already executed.`);
    console.log('[Init] You can now use "npm run migrate" for future migrations.');

  } catch (error) {
    console.error('[Init] Error:', error.message);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

init()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
