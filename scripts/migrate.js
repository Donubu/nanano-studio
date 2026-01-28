#!/usr/bin/env node

/**
 * Database Migration Script
 *
 * - Creates _migrations table to track executed migrations
 * - Reads SQL files from scripts/migrations/ in numeric order
 * - Executes only pending migrations
 * - Works with both MySQL and MariaDB
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

async function ensureMigrationsTable(connection) {
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
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

  // Split by semicolon but be careful with strings containing semicolons
  // For simplicity, we'll execute the whole file at once (multipleStatements: true)
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
        console.log('OK');
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
