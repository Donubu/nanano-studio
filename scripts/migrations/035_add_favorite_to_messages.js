/**
 * Migration 035: Add favorite flag to messages
 * Allows marking assets (images, videos, audio) as favorites within a project
 * This is a global favorite (shared across all project users, not personal)
 *
 * Usage: node scripts/migrations/035_add_favorite_to_messages.js
 */

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });

async function migrate() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });

    console.log("🔧 Migration 035: Adding favorite flag to messages...\n");

    try {
        // Check if column already exists
        const [columns] = await connection.execute(
            "SHOW COLUMNS FROM messages LIKE 'is_favorite'"
        );

        if (columns.length > 0) {
            console.log("✓ Column is_favorite already exists, skipping...");
        } else {
            // Add favorite flag to messages
            await connection.execute(`
                ALTER TABLE messages
                ADD COLUMN is_favorite TINYINT(1) DEFAULT 0
                COMMENT 'Marca el asset como favorito dentro del proyecto (global, no personal)'
                AFTER quality_tier
            `);
            console.log("✓ Added is_favorite column to messages");
        }

        // Check if idx_messages_favorite index exists
        const [indexes1] = await connection.execute(
            "SHOW INDEX FROM messages WHERE Key_name = 'idx_messages_favorite'"
        );

        if (indexes1.length > 0) {
            console.log("✓ Index idx_messages_favorite already exists, skipping...");
        } else {
            // Index for filtering favorites within a project (via conversation)
            await connection.execute(
                "CREATE INDEX idx_messages_favorite ON messages(is_favorite)"
            );
            console.log("✓ Created index idx_messages_favorite");
        }

        // Check if idx_messages_favorite_content index exists
        const [indexes2] = await connection.execute(
            "SHOW INDEX FROM messages WHERE Key_name = 'idx_messages_favorite_content'"
        );

        if (indexes2.length > 0) {
            console.log("✓ Index idx_messages_favorite_content already exists, skipping...");
        } else {
            // Composite index for fetching favorites by type within conversations
            await connection.execute(
                "CREATE INDEX idx_messages_favorite_content ON messages(is_favorite, content_type)"
            );
            console.log("✓ Created index idx_messages_favorite_content");
        }

        console.log("\n✅ Migration 035 completed successfully!");
    } catch (error) {
        console.error("❌ Migration error:", error.message);
        throw error;
    } finally {
        await connection.end();
    }
}

migrate().catch(console.error);
