import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

interface TemplateConfig {
  [type: string]: {
    enabled?: boolean;
    models?: Array<{
      model_id: number;
      label?: string;
      sort_order?: number;
      is_default?: boolean;
    }>;
  };
}

/**
 * Apply a template config to a project (generation config + models).
 * Extracted from /api/admin/templates/[id]/apply for reuse.
 */
export async function applyTemplateToProject(projectId: number, config: TemplateConfig) {
  const types = ["text", "image", "video", "audio", "music"] as const;

  for (const type of types) {
    const typeConfig = config[type];
    if (!typeConfig) continue;

    await pool.execute<ResultSetHeader>(
      `INSERT INTO project_generation_config (project_id, generation_type, is_enabled)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled), updated_at = CURRENT_TIMESTAMP`,
      [projectId, type, typeConfig.enabled ? 1 : 0]
    );

    await pool.execute<ResultSetHeader>(
      "DELETE FROM project_generation_models WHERE project_id = ? AND generation_type = ?",
      [projectId, type]
    );

    if (typeConfig.models && typeConfig.models.length > 0) {
      for (let i = 0; i < typeConfig.models.length; i++) {
        const m = typeConfig.models[i];

        const [modelCheck] = await pool.execute<RowDataPacket[]>(
          "SELECT id FROM models WHERE id = ? AND is_active = 1",
          [m.model_id]
        );
        if (modelCheck.length === 0) continue;

        await pool.execute<ResultSetHeader>(
          `INSERT INTO project_generation_models (project_id, generation_type, model_id, label, sort_order, is_default)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [projectId, type, m.model_id, m.label || "", m.sort_order ?? i, m.is_default ? 1 : 0]
        );
      }
    }
  }
}

/**
 * Create a personal space for a user:
 * 1. Find the internal client
 * 2. Find the first template
 * 3. Create a hidden project under the internal client
 * 4. Assign the user to the project
 * 5. Apply the template
 *
 * Returns the new project ID, or null if already exists.
 * Throws if no internal client or no template found.
 */
export async function createPersonalSpace(userId: number, userName: string): Promise<number | null> {
  // Check if user already has a personal project
  const [existing] = await pool.execute<RowDataPacket[]>(
    "SELECT id FROM projects WHERE is_personal = 1 AND owner_user_id = ?",
    [userId]
  );
  if (existing.length > 0) {
    return null; // already has one
  }

  // Find internal client
  const [internalClients] = await pool.execute<RowDataPacket[]>(
    "SELECT id FROM clients WHERE is_internal = 1 LIMIT 1"
  );
  if (internalClients.length === 0) {
    throw new Error("No se ha configurado un cliente interno. Marca un cliente como 'Interno' primero.");
  }
  const internalClientId = internalClients[0].id;

  // Find first template
  const [templates] = await pool.execute<RowDataPacket[]>(
    "SELECT id, config FROM project_templates ORDER BY id ASC LIMIT 1"
  );
  if (templates.length === 0) {
    throw new Error("No hay templates disponibles. Crea al menos un template primero.");
  }

  const template = templates[0];
  const config: TemplateConfig = typeof template.config === "string"
    ? JSON.parse(template.config)
    : template.config;

  // Create hidden personal project
  const projectTitle = userName || `Usuario ${userId}`;
  const [result] = await pool.execute<ResultSetHeader>(
    "INSERT INTO projects (title, client_id, status, hidden, is_personal, owner_user_id) VALUES (?, ?, 'active', 1, 1, ?)",
    [projectTitle, internalClientId, userId]
  );
  const projectId = result.insertId;

  // Assign user to project
  await pool.execute<ResultSetHeader>(
    "INSERT INTO project_users (project_id, user_id, role) VALUES (?, ?, 'member') ON DUPLICATE KEY UPDATE role = 'member'",
    [projectId, userId]
  );

  // Apply template
  await applyTemplateToProject(projectId, config);

  return projectId;
}
