/**
 * Migration 036: Add Imagen 4 models
 * Adds the 3 Imagen 4 image generation models with proper costs
 *
 * Models:
 * - imagen-4.0-fast-generate-001 (Fast): $0.02 per image
 * - imagen-4.0-generate-001 (Standard): $0.04 per image
 * - imagen-4.0-ultra-generate-001 (Ultra): $0.06 per image
 *
 * These models:
 * - Support image generation only (not text/chat)
 * - Support 1K and 2K resolution (not 4K)
 * - Have flat per-image pricing (same cost for 1K and 2K)
 * - Support seed for reproducibility (requires addWatermark: false)
 * - Support aspect ratios: 1:1, 3:4, 4:3, 9:16, 16:9
 *
 * Usage: node scripts/migrations/036_add_imagen4_models.js
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

    console.log("🔧 Migration 036: Adding Imagen 4 models...\n");

    try {
        const imagen4Models = [
            {
                model_id: "imagen-4.0-fast-generate-001",
                display_name: "Imagen 4 Fast",
                description: "Imagen 4 Fast - Generación de imágenes rápida con IA de Google. Soporta aspect ratios 1:1, 3:4, 4:3, 9:16, 16:9 y resoluciones 1K/2K. Incluye soporte de seed para reproducibilidad.",
                supports_image_generation: true,
                cost_image_1k: 0.02,
                cost_image_2k: 0.02,
                cost_image_4k: 0, // Not supported
            },
            {
                model_id: "imagen-4.0-generate-001",
                display_name: "Imagen 4",
                description: "Imagen 4 Standard - Generación de imágenes de alta calidad con IA de Google. Soporta aspect ratios 1:1, 3:4, 4:3, 9:16, 16:9 y resoluciones 1K/2K. Incluye soporte de seed para reproducibilidad.",
                supports_image_generation: true,
                cost_image_1k: 0.04,
                cost_image_2k: 0.04,
                cost_image_4k: 0, // Not supported
            },
            {
                model_id: "imagen-4.0-ultra-generate-001",
                display_name: "Imagen 4 Ultra",
                description: "Imagen 4 Ultra - Máxima calidad de generación de imágenes con IA de Google. Soporta aspect ratios 1:1, 3:4, 4:3, 9:16, 16:9 y resoluciones 1K/2K. Incluye soporte de seed para reproducibilidad.",
                supports_image_generation: true,
                cost_image_1k: 0.06,
                cost_image_2k: 0.06,
                cost_image_4k: 0, // Not supported
            },
        ];

        for (const model of imagen4Models) {
            // Check if model already exists
            const [existing] = await connection.execute(
                "SELECT id FROM models WHERE model_id = ?",
                [model.model_id]
            );

            if (existing.length > 0) {
                console.log(`✓ Model ${model.model_id} already exists, skipping...`);
                continue;
            }

            // Insert model
            await connection.execute(
                `INSERT INTO models (
                    model_id, display_name, description, is_active,
                    supports_images, supports_audio, supports_video,
                    supports_image_generation, supports_video_generation, supports_audio_generation,
                    cost_input_per_million, cost_output_per_million,
                    cost_image_1k, cost_image_2k, cost_image_4k,
                    cost_video_per_second, cost_audio_per_minute,
                    max_tokens, supports_reference_images
                ) VALUES (?, ?, ?, 1, 0, 0, 0, ?, 0, 0, 0, 0, ?, ?, ?, 0, 0, 0, 0)`,
                [
                    model.model_id,
                    model.display_name,
                    model.description,
                    model.supports_image_generation ? 1 : 0,
                    model.cost_image_1k,
                    model.cost_image_2k,
                    model.cost_image_4k,
                ]
            );
            console.log(`✓ Added model: ${model.display_name} (${model.model_id})`);
        }

        console.log("\n✅ Migration 036 completed successfully!");
    } catch (error) {
        console.error("❌ Migration error:", error.message);
        throw error;
    } finally {
        await connection.end();
    }
}

migrate().catch(console.error);
