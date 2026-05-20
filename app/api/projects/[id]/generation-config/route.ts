import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

type GenerationType = "text" | "image" | "video" | "audio" | "music";

interface ModelRow extends RowDataPacket {
  id: number;
  project_id: number;
  generation_type: GenerationType;
  model_id: number;
  label: string;
  sort_order: number;
  is_default: number;
  // From models table
  model_model_id: string;
  model_display_name: string;
  model_supports_google_search: number;
  model_api_backend: string | null;
}

interface ConfigEnabledRow extends RowDataPacket {
  generation_type: GenerationType;
  is_enabled: number;
}

interface ModelInfo {
  id: number;
  model_id: string;
  display_name: string;
  label: string;
  sort_order: number;
  is_default: boolean;
  supports_google_search: boolean;
  api_backend: string | null;
}

interface TypeConfig {
  enabled: boolean;
  models: ModelInfo[];
}

interface GenerationConfigResponse {
  text: TypeConfig;
  image: TypeConfig;
  video: TypeConfig;
  audio: TypeConfig;
  music: TypeConfig;
}

// GET - Obtener configuracion de tipos de generacion del proyecto
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;

    // Per-user gate: non-admins without can_use_openrouter cannot see
    // OpenRouter-backed models even if admin added them to the project.
    const isAdmin = session.user.role === "admin";
    let userCanUseOpenRouter = false;
    if (!isAdmin) {
      const [userRows] = await pool.execute<RowDataPacket[]>(
        "SELECT can_use_openrouter FROM users WHERE id = ?",
        [session.user.id]
      );
      userCanUseOpenRouter = userRows.length > 0 && Boolean(userRows[0].can_use_openrouter);
    }
    const allowOpenRouter = isAdmin || userCanUseOpenRouter;

    // Fetch enabled status from legacy table
    const [enabledRows] = await pool.execute<ConfigEnabledRow[]>(
      `SELECT generation_type, is_enabled FROM project_generation_config WHERE project_id = ?`,
      [id]
    );

    // Fetch models from new table
    const [modelRows] = await pool.execute<ModelRow[]>(`
      SELECT
        pgm.id,
        pgm.project_id,
        pgm.generation_type,
        pgm.model_id,
        pgm.label,
        pgm.sort_order,
        pgm.is_default,
        m.model_id as model_model_id,
        m.display_name as model_display_name,
        m.supports_google_search as model_supports_google_search,
        m.api_backend as model_api_backend
      FROM project_generation_models pgm
      JOIN models m ON pgm.model_id = m.id
      WHERE pgm.project_id = ?
      ORDER BY pgm.generation_type, pgm.sort_order ASC
    `, [id]);

    const enabledMap: Record<string, boolean> = {};
    for (const row of enabledRows) {
      enabledMap[row.generation_type] = Boolean(row.is_enabled);
    }

    const config: GenerationConfigResponse = {
      text: { enabled: false, models: [] },
      image: { enabled: false, models: [] },
      video: { enabled: false, models: [] },
      audio: { enabled: false, models: [] },
      music: { enabled: false, models: [] },
    };

    // Set enabled status
    for (const type of Object.keys(config) as GenerationType[]) {
      config[type].enabled = enabledMap[type] ?? false;
    }

    // Group models by type, applying the OpenRouter per-user gate.
    for (const row of modelRows) {
      if (!allowOpenRouter && row.model_api_backend === "openrouter") continue;
      const type = row.generation_type as GenerationType;
      config[type].models.push({
        id: row.model_id,
        model_id: row.model_model_id,
        display_name: row.model_display_name,
        label: row.label,
        sort_order: row.sort_order,
        is_default: Boolean(row.is_default),
        supports_google_search: Boolean(row.model_supports_google_search),
        api_backend: row.model_api_backend,
      });
    }

    // If filtering dropped the default model for a type, promote the first
    // remaining model so the canvas/chat still resolves a valid default.
    for (const type of Object.keys(config) as GenerationType[]) {
      const models = config[type].models;
      if (models.length > 0 && !models.some(m => m.is_default)) {
        models[0].is_default = true;
      }
    }

    return NextResponse.json(config);
  } catch (error) {
    console.error("Error obteniendo configuracion de generacion:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// PUT - Actualizar configuracion de un tipo de generacion
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { generation_type, action } = body;

    if (!generation_type || !["text", "image", "video", "audio", "music"].includes(generation_type)) {
      return NextResponse.json(
        { error: "generation_type invalido. Debe ser: text, image, video, audio o music" },
        { status: 400 }
      );
    }

    // Verificar que el proyecto existe
    const [project] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM projects WHERE id = ?",
      [id]
    );
    if (project.length === 0) {
      return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
    }

    // Toggle enabled/disabled
    if (body.is_enabled !== undefined) {
      const [existing] = await pool.execute<RowDataPacket[]>(
        "SELECT id FROM project_generation_config WHERE project_id = ? AND generation_type = ?",
        [id, generation_type]
      );
      if (existing.length === 0) {
        await pool.execute<ResultSetHeader>(
          `INSERT INTO project_generation_config (project_id, generation_type, is_enabled) VALUES (?, ?, ?)`,
          [id, generation_type, body.is_enabled ? 1 : 0]
        );
      } else {
        await pool.execute<ResultSetHeader>(
          `UPDATE project_generation_config SET is_enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE project_id = ? AND generation_type = ?`,
          [body.is_enabled ? 1 : 0, id, generation_type]
        );
      }
    }

    // Add a model
    if (action === "add_model") {
      const { model_id, label = "", sort_order } = body;
      if (!model_id) {
        return NextResponse.json({ error: "model_id requerido" }, { status: 400 });
      }
      // Verify model exists, is active, and not obsolete
      const [model] = await pool.execute<RowDataPacket[]>(
        "SELECT id, is_obsolete FROM models WHERE id = ? AND is_active = 1",
        [model_id]
      );
      if (model.length === 0) {
        return NextResponse.json({ error: "Modelo no encontrado o inactivo" }, { status: 400 });
      }
      if (model[0].is_obsolete) {
        return NextResponse.json({ error: "No se puede agregar un modelo obsoleto a un proyecto" }, { status: 400 });
      }

      // Get next sort_order if not provided
      let effectiveSortOrder = sort_order;
      if (effectiveSortOrder === undefined) {
        const [maxOrder] = await pool.execute<RowDataPacket[]>(
          "SELECT COALESCE(MAX(sort_order), -1) + 1 as next_order FROM project_generation_models WHERE project_id = ? AND generation_type = ?",
          [id, generation_type]
        );
        effectiveSortOrder = maxOrder[0].next_order;
      }

      // Check if this is the first model for this type (make it default)
      const [existingModels] = await pool.execute<RowDataPacket[]>(
        "SELECT id FROM project_generation_models WHERE project_id = ? AND generation_type = ?",
        [id, generation_type]
      );
      const isFirst = existingModels.length === 0;

      await pool.execute<ResultSetHeader>(
        `INSERT INTO project_generation_models (project_id, generation_type, model_id, label, sort_order, is_default)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE label = VALUES(label), sort_order = VALUES(sort_order)`,
        [id, generation_type, model_id, label, effectiveSortOrder, isFirst ? 1 : 0]
      );
    }

    // Remove a model
    if (action === "remove_model") {
      const { model_id } = body;
      if (!model_id) {
        return NextResponse.json({ error: "model_id requerido" }, { status: 400 });
      }

      // Check if removing the default model
      const [removingDefault] = await pool.execute<RowDataPacket[]>(
        "SELECT is_default FROM project_generation_models WHERE project_id = ? AND generation_type = ? AND model_id = ?",
        [id, generation_type, model_id]
      );

      await pool.execute<ResultSetHeader>(
        "DELETE FROM project_generation_models WHERE project_id = ? AND generation_type = ? AND model_id = ?",
        [id, generation_type, model_id]
      );

      // If we removed the default, set the first remaining model as default
      if (removingDefault.length > 0 && removingDefault[0].is_default) {
        await pool.execute<ResultSetHeader>(
          `UPDATE project_generation_models SET is_default = 1
           WHERE project_id = ? AND generation_type = ?
           ORDER BY sort_order ASC LIMIT 1`,
          [id, generation_type]
        );
      }
    }

    // Update a model's label or sort_order
    if (action === "update_model") {
      const { model_id, label, sort_order: newSortOrder } = body;
      if (!model_id) {
        return NextResponse.json({ error: "model_id requerido" }, { status: 400 });
      }
      const updates: string[] = [];
      const values: (string | number)[] = [];
      if (label !== undefined) {
        updates.push("label = ?");
        values.push(label);
      }
      if (newSortOrder !== undefined) {
        updates.push("sort_order = ?");
        values.push(newSortOrder);
      }
      if (updates.length > 0) {
        values.push(Number(id), generation_type, model_id);
        await pool.execute<ResultSetHeader>(
          `UPDATE project_generation_models SET ${updates.join(", ")} WHERE project_id = ? AND generation_type = ? AND model_id = ?`,
          values
        );
      }
    }

    // Set default model
    if (action === "set_default") {
      const { model_id } = body;
      if (!model_id) {
        return NextResponse.json({ error: "model_id requerido" }, { status: 400 });
      }
      // Unset all defaults for this type
      await pool.execute<ResultSetHeader>(
        "UPDATE project_generation_models SET is_default = 0 WHERE project_id = ? AND generation_type = ?",
        [id, generation_type]
      );
      // Set the new default
      await pool.execute<ResultSetHeader>(
        "UPDATE project_generation_models SET is_default = 1 WHERE project_id = ? AND generation_type = ? AND model_id = ?",
        [id, generation_type, model_id]
      );
    }

    // Reorder models
    if (action === "reorder") {
      const { model_ids } = body as { model_ids: number[] };
      if (!model_ids || !Array.isArray(model_ids)) {
        return NextResponse.json({ error: "model_ids requerido (array)" }, { status: 400 });
      }
      for (let i = 0; i < model_ids.length; i++) {
        await pool.execute<ResultSetHeader>(
          "UPDATE project_generation_models SET sort_order = ? WHERE project_id = ? AND generation_type = ? AND model_id = ?",
          [i, id, generation_type, model_ids[i]]
        );
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error actualizando configuracion de generacion:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// POST - Crear configuracion inicial para todos los tipos de un proyecto
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const configs: Array<{
      generation_type: GenerationType;
      is_enabled: boolean;
      models?: Array<{
        model_id: number;
        label?: string;
        sort_order?: number;
        is_default?: boolean;
      }>;
    }> = body.configs || [];

    // Verificar que el proyecto existe
    const [project] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM projects WHERE id = ?",
      [id]
    );
    if (project.length === 0) {
      return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
    }

    for (const config of configs) {
      if (!["text", "image", "video", "audio", "music"].includes(config.generation_type)) {
        continue;
      }

      // Upsert enabled status in legacy table
      await pool.execute<ResultSetHeader>(`
        INSERT INTO project_generation_config (project_id, generation_type, is_enabled)
        VALUES (?, ?, ?)
        ON DUPLICATE KEY UPDATE is_enabled = VALUES(is_enabled), updated_at = CURRENT_TIMESTAMP
      `, [id, config.generation_type, config.is_enabled ? 1 : 0]);

      // Insert models
      if (config.models) {
        for (let i = 0; i < config.models.length; i++) {
          const m = config.models[i];
          await pool.execute<ResultSetHeader>(`
            INSERT INTO project_generation_models (project_id, generation_type, model_id, label, sort_order, is_default)
            VALUES (?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE label = VALUES(label), sort_order = VALUES(sort_order), is_default = VALUES(is_default)
          `, [
            id,
            config.generation_type,
            m.model_id,
            m.label || "",
            m.sort_order ?? i,
            m.is_default ? 1 : 0,
          ]);
        }
      }
    }

    return NextResponse.json({ success: true, count: configs.length }, { status: 201 });
  } catch (error) {
    console.error("Error creando configuracion de generacion:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
