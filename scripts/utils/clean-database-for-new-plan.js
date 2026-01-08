/**
 * Script para limpiar la base de datos manteniendo:
 * - Usuario administrador
 * - Modelos
 *
 * Esto permite probar el nuevo sistema de tipos de generación desde cero.
 *
 * Uso: node scripts/utils/clean-database-for-new-plan.js
 */

import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });

async function cleanDatabase() {
    const connection = await mysql.createConnection({
        host: process.env.DB_HOST,
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME,
    });

    console.log("🗑️  Limpiando base de datos...\n");

    try {
        // Deshabilitar foreign key checks temporalmente
        await connection.execute("SET FOREIGN_KEY_CHECKS = 0");

        // 1. Borrar mensajes (depende de conversations)
        const [messagesResult] = await connection.execute("DELETE FROM messages");
        console.log(`✓ Eliminados ${messagesResult.affectedRows} mensajes`);

        // 2. Borrar message_tags
        try {
            const [msgTagsResult] = await connection.execute("DELETE FROM message_tags");
            console.log(`✓ Eliminados ${msgTagsResult.affectedRows} message_tags`);
        } catch (e) {
            console.log("  (message_tags no existe o ya está vacía)");
        }

        // 3. Borrar project_tags
        try {
            const [projTagsResult] = await connection.execute("DELETE FROM project_tags");
            console.log(`✓ Eliminados ${projTagsResult.affectedRows} project_tags`);
        } catch (e) {
            console.log("  (project_tags no existe o ya está vacía)");
        }

        // 4. Borrar conversations
        const [convsResult] = await connection.execute("DELETE FROM conversations");
        console.log(`✓ Eliminadas ${convsResult.affectedRows} conversaciones`);

        // 5. Borrar project_generation_config
        try {
            const [genConfigResult] = await connection.execute("DELETE FROM project_generation_config");
            console.log(`✓ Eliminadas ${genConfigResult.affectedRows} configuraciones de generación`);
        } catch (e) {
            console.log("  (project_generation_config no existe o ya está vacía)");
        }

        // 6. Borrar project_models
        const [projModelsResult] = await connection.execute("DELETE FROM project_models");
        console.log(`✓ Eliminados ${projModelsResult.affectedRows} project_models`);

        // 7. Borrar project_users
        const [projUsersResult] = await connection.execute("DELETE FROM project_users");
        console.log(`✓ Eliminados ${projUsersResult.affectedRows} project_users`);

        // 8. Borrar projects
        const [projectsResult] = await connection.execute("DELETE FROM projects");
        console.log(`✓ Eliminados ${projectsResult.affectedRows} proyectos`);

        // 9. Borrar clients
        const [clientsResult] = await connection.execute("DELETE FROM clients");
        console.log(`✓ Eliminados ${clientsResult.affectedRows} clientes`);

        // 10. Borrar sessions (excepto del admin)
        const [adminUser] = await connection.execute(
            "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
        );
        if (adminUser.length > 0) {
            const adminId = adminUser[0].id;
            const [sessionsResult] = await connection.execute(
                "DELETE FROM sessions WHERE user_id != ?",
                [adminId]
            );
            console.log(`✓ Eliminadas ${sessionsResult.affectedRows} sesiones (excepto admin)`);
        }

        // 11. Borrar accounts (excepto del admin)
        if (adminUser.length > 0) {
            const adminId = adminUser[0].id;
            const [accountsResult] = await connection.execute(
                "DELETE FROM accounts WHERE user_id != ?",
                [adminId]
            );
            console.log(`✓ Eliminadas ${accountsResult.affectedRows} cuentas OAuth (excepto admin)`);
        }

        // 12. Borrar usuarios que no son admin
        const [usersResult] = await connection.execute(
            "DELETE FROM users WHERE role != 'admin'"
        );
        console.log(`✓ Eliminados ${usersResult.affectedRows} usuarios (admin preservado)`);

        // 13. Borrar verification_tokens y password_reset_tokens
        try {
            await connection.execute("DELETE FROM verification_tokens");
            console.log("✓ Eliminados verification_tokens");
        } catch (e) {}

        try {
            await connection.execute("DELETE FROM password_reset_tokens");
            console.log("✓ Eliminados password_reset_tokens");
        } catch (e) {}

        // Re-habilitar foreign key checks
        await connection.execute("SET FOREIGN_KEY_CHECKS = 1");

        console.log("\n✅ Base de datos limpiada exitosamente!");
        console.log("\n📋 Conservado:");

        // Mostrar qué quedó
        const [admins] = await connection.execute(
            "SELECT id, email, name, role FROM users WHERE role = 'admin'"
        );
        console.log(`   - ${admins.length} usuario(s) admin:`);
        admins.forEach(u => console.log(`     • ${u.email} (${u.name || 'sin nombre'})`));

        const [models] = await connection.execute(
            "SELECT id, display_name FROM models WHERE is_active = 1"
        );
        console.log(`   - ${models.length} modelo(s) activo(s):`);
        models.forEach(m => console.log(`     • ${m.display_name}`));

    } catch (error) {
        console.error("❌ Error:", error.message);
        // Re-habilitar foreign key checks en caso de error
        await connection.execute("SET FOREIGN_KEY_CHECKS = 1");
        throw error;
    } finally {
        await connection.end();
    }
}

cleanDatabase().catch(console.error);
