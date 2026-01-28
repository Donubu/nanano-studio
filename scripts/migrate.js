#!/usr/bin/env node

/**
 * Database Migration Script
 *
 * - Creates _migrations table to track executed migrations
 * - Reads SQL files from scripts/migrations/ in numeric order
 * - Executes only pending migrations
 * - Works with both MySQL and MariaDB
 * - Auto-detects existing databases and initializes tracking
 *
 * Usage: node scripts/migrate.js
 */

const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');

// Load environment variables in development
if (process.env.NODE_ENV !== 'production') {
  try {
    require('dotenv').config({ path: '.env.local' });
  } catch {
    // dotenv not available, use existing env vars
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
    multipleStatements: true, // Required for running SQL files with multiple statements
  };

  console.log(`[Migrate] Connecting to ${config.host}:${config.port}/${config.database}...`);
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
  '017_add_file_size_to_messages.sql': (c) => columnExists(c, 'messages', 'image_file_size'),
  '018_add_video_generation_to_models.sql': (c) => columnExists(c, 'models', 'supports_video_generation'),
  '019_add_video_settings_to_conversations.sql': (c) => columnExists(c, 'conversations', 'video_duration'),
  '020_add_video_fields_to_messages.sql': (c) => columnExists(c, 'messages', 'video_url'),
  '021_add_video_aspect_ratio_to_messages.sql': (c) => columnExists(c, 'messages', 'video_aspect_ratio'),
  '022_create_project_uploads_table.sql': (c) => tableExists(c, 'project_uploads'),
  '023_add_image_settings_to_messages.sql': (c) => columnExists(c, 'messages', 'image_aspect_ratio'),
  '024_separate_generation_limits.sql': (c) => columnExists(c, 'project_users', 'max_monthly_image_generations'),
  '025_create_tags_system.sql': (c) => tableExists(c, 'tags'),
  '026_add_cost_tracking.sql': (c) => columnExists(c, 'messages', 'estimated_cost'),
  '027_add_reference_images_to_models.sql': (c) => columnExists(c, 'models', 'supports_reference_images'),
  '028_add_audio_generation_to_models.sql': (c) => columnExists(c, 'models', 'supports_audio_generation'),
  '029_add_audio_fields_to_messages.sql': (c) => columnExists(c, 'messages', 'audio_url'),
  '030_add_audio_settings_to_conversations.sql': (c) => columnExists(c, 'conversations', 'audio_voice_id'),
  '031_add_project_generation_config.sql': (c) => tableExists(c, 'project_generation_config'),
  '032_add_generation_type_to_conversations.sql': (c) => columnExists(c, 'conversations', 'generation_type'),
  '033_add_quality_and_seed_to_messages.sql': (c) => columnExists(c, 'messages', 'quality_tier'),
  '034_add_quality_limits_to_project_users.sql': (c) => columnExists(c, 'project_users', 'max_monthly_image_normal'),
  '035_add_favorite_to_messages.sql': (c) => columnExists(c, 'messages', 'is_favorite'),
  '036_add_has_2x_to_messages.sql': (c) => columnExists(c, 'messages', 'has_2x'),
  '037_create_gcp_costs_table.sql': (c) => tableExists(c, 'gcp_daily_costs'),
  '038_add_topaz_tracking.sql': (c) => columnExists(c, 'messages', 'topaz_credits'),
  '039_create_topaz_edits_table.sql': (c) => tableExists(c, 'topaz_edits'),
  '040_create_topaz_video_edits_table.sql': (c) => tableExists(c, 'topaz_video_edits'),
  '041_fix_gcp_usage_amount_range.sql': (c) => tableExists(c, 'gcp_daily_costs'),
  '042_add_ignore_context_to_messages.sql': (c) => columnExists(c, 'messages', 'ignore_in_context'),
};

async function ensureMigrationsTable(connection) {
  // Create migrations table if it doesn't exist
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Check if we need to auto-initialize:
  // - _migrations table is empty (no records)
  // - But models table exists (database has been used)
  const [migrationCount] = await connection.execute('SELECT COUNT(*) as count FROM _migrations');
  const hasMigrationRecords = migrationCount[0].count > 0;
  const modelsTableExists = await tableExists(connection, 'models');

  if (!hasMigrationRecords && modelsTableExists) {
    console.log('[Migrate] Detected existing database without migration tracking');
    console.log('[Migrate] Auto-initializing migration records...');

    // Get all migration files
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    let markedCount = 0;
    for (const file of files) {
      const checkFn = migrationChecks[file];

      if (checkFn) {
        const isApplied = await checkFn(connection);
        if (isApplied) {
          await connection.execute(
            'INSERT INTO _migrations (name) VALUES (?)',
            [file]
          );
          markedCount++;
        }
      }
    }

    console.log(`[Migrate] Marked ${markedCount} existing migrations as executed`);
  }
}

async function getExecutedMigrations(connection) {
  const [rows] = await connection.execute('SELECT name FROM _migrations ORDER BY name');
  return new Set(rows.map(row => row.name));
}

async function getMigrationFiles() {
  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort(); // Numeric sort works because files are zero-padded (001_, 002_, etc.)

  return files;
}

async function executeMigration(connection, filename) {
  const filepath = path.join(MIGRATIONS_DIR, filename);
  const sql = fs.readFileSync(filepath, 'utf8');

  // Check if migration is already applied (even if not tracked)
  const checkFn = migrationChecks[filename];
  if (checkFn) {
    const alreadyApplied = await checkFn(connection);
    if (alreadyApplied) {
      // Migration already applied but not tracked - just mark it
      await connection.execute(
        'INSERT INTO _migrations (name) VALUES (?)',
        [filename]
      );
      return { success: true, skipped: true };
    }
  }

  // Execute the migration
  try {
    await connection.query(sql);
    await connection.execute(
      'INSERT INTO _migrations (name) VALUES (?)',
      [filename]
    );
    return { success: true };
  } catch (error) {
    return { success: false, error };
  }
}

async function migrate() {
  console.log('[Migrate] Starting database migrations...');
  console.log(`[Migrate] Migrations directory: ${MIGRATIONS_DIR}`);

  let connection;

  try {
    connection = await getConnection();
    console.log('[Migrate] Connected to database');

    // Ensure migrations table exists
    await ensureMigrationsTable(connection);
    console.log('[Migrate] Migrations table ready');

    // Get list of executed migrations
    const executed = await getExecutedMigrations(connection);
    console.log(`[Migrate] Already executed: ${executed.size} migrations`);

    // Get all migration files
    const files = await getMigrationFiles();
    console.log(`[Migrate] Found ${files.length} migration files`);

    // Filter to pending migrations
    const pending = files.filter(f => !executed.has(f));

    if (pending.length === 0) {
      console.log('[Migrate] No pending migrations. Database is up to date.');
      return { success: true, executed: 0 };
    }

    console.log(`[Migrate] Pending migrations: ${pending.length}`);

    // Execute pending migrations
    let successCount = 0;
    for (const file of pending) {
      process.stdout.write(`[Migrate] Running ${file}... `);

      const result = await executeMigration(connection, file);

      if (result.success) {
        if (result.skipped) {
          console.log('SKIPPED (already applied)');
        } else {
          console.log('OK');
        }
        successCount++;
      } else {
        console.log('FAILED');
        console.error(`[Migrate] Error in ${file}:`, result.error.message);

        // Stop on first error to prevent cascading failures
        throw new Error(`Migration ${file} failed: ${result.error.message}`);
      }
    }

    console.log(`[Migrate] Completed: ${successCount} migrations executed successfully`);
    return { success: true, executed: successCount };

  } catch (error) {
    console.error('[Migrate] Migration failed:', error.message);
    throw error;
  } finally {
    if (connection) {
      await connection.end();
      console.log('[Migrate] Database connection closed');
    }
  }
}

// Run migrations
migrate()
  .then(result => {
    if (result.success) {
      process.exit(0);
    } else {
      process.exit(1);
    }
  })
  .catch(error => {
    console.error('[Migrate] Fatal error:', error);
    process.exit(1);
  });
