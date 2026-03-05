import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

type GenerationType = "text" | "image" | "video" | "audio" | "music";

interface GenerationConfigRow extends RowDataPacket {
  id: number;
  project_id: number;
  generation_type: GenerationType;
  is_enabled: number;
  model_normal_id: number | null;
  model_hq_id: number | null;
  model_chirp_id: number | null;
  // Model normal info
  model_normal_model_id: string | null;
  model_normal_display_name: string | null;
  // Model HQ info
  model_hq_model_id: string | null;
  model_hq_display_name: string | null;
  // Model Chirp info
  model_chirp_model_id: string | null;
  model_chirp_display_name: string | null;
}

interface GenerationConfigResponse {
  text: TypeConfig;
  image: TypeConfig;
  video: TypeConfig;
  audio: TypeConfig;
  music: TypeConfig;
}

interface TypeConfig {
  enabled: boolean;
  model_normal: ModelInfo | null;
  model_hq: ModelInfo | null;
  model_chirp: ModelInfo | null;
}

interface ModelInfo {
  id: number;
  model_id: string;
  display_name: string;
  supports_google_search: boolean;
  api_backend: string | null;
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

    const [rows] = await pool.execute<GenerationConfigRow[]>(`
      SELECT
        pgc.id,
        pgc.project_id,
        pgc.generation_type,
        pgc.is_enabled,
        pgc.model_normal_id,
        pgc.model_hq_id,
        pgc.model_chirp_id,
        mn.model_id as model_normal_model_id,
        mn.display_name as model_normal_display_name,
        mh.model_id as model_hq_model_id,
        mh.display_name as model_hq_display_name,
        mc.model_id as model_chirp_model_id,
        mc.display_name as model_chirp_display_name,
        mn.supports_google_search as model_normal_supports_google_search,
        mh.supports_google_search as model_hq_supports_google_search,
        mn.api_backend as model_normal_api_backend,
        mh.api_backend as model_hq_api_backend,
        mc.api_backend as model_chirp_api_backend
      FROM project_generation_config pgc
      LEFT JOIN models mn ON pgc.model_normal_id = mn.id
      LEFT JOIN models mh ON pgc.model_hq_id = mh.id
      LEFT JOIN models mc ON pgc.model_chirp_id = mc.id
      WHERE pgc.project_id = ?
    `, [id]);

    // Construir respuesta estructurada
    const config: GenerationConfigResponse = {
      text: { enabled: false, model_normal: null, model_hq: null, model_chirp: null },
      image: { enabled: false, model_normal: null, model_hq: null, model_chirp: null },
      video: { enabled: false, model_normal: null, model_hq: null, model_chirp: null },
      audio: { enabled: false, model_normal: null, model_hq: null, model_chirp: null },
      music: { enabled: false, model_normal: null, model_hq: null, model_chirp: null },
    };

    for (const row of rows) {
      const type = row.generation_type as GenerationType;
      config[type] = {
        enabled: Boolean(row.is_enabled),
        model_normal: row.model_normal_id ? {
          id: row.model_normal_id,
          model_id: row.model_normal_model_id!,
          display_name: row.model_normal_display_name!,
          supports_google_search: Boolean((row as Record<string, unknown>).model_normal_supports_google_search),
          api_backend: (row as Record<string, unknown>).model_normal_api_backend as string | null,
        } : null,
        model_hq: row.model_hq_id ? {
          id: row.model_hq_id,
          model_id: row.model_hq_model_id!,
          display_name: row.model_hq_display_name!,
          supports_google_search: Boolean((row as Record<string, unknown>).model_hq_supports_google_search),
          api_backend: (row as Record<string, unknown>).model_hq_api_backend as string | null,
        } : null,
        model_chirp: row.model_chirp_id ? {
          id: row.model_chirp_id,
          model_id: row.model_chirp_model_id!,
          display_name: row.model_chirp_display_name!,
          supports_google_search: false,
          api_backend: (row as Record<string, unknown>).model_chirp_api_backend as string | null,
        } : null,
      };
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
    const {
      generation_type,
      is_enabled,
      model_normal_id,
      model_hq_id,
      model_chirp_id,
    } = body;

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

    // Verificar que los modelos existen si se proporcionaron
    if (model_normal_id) {
      const [model] = await pool.execute<RowDataPacket[]>(
        "SELECT id FROM models WHERE id = ? AND is_active = 1",
        [model_normal_id]
      );
      if (model.length === 0) {
        return NextResponse.json({ error: "Modelo normal no encontrado o inactivo" }, { status: 400 });
      }
    }

    if (model_hq_id) {
      const [model] = await pool.execute<RowDataPacket[]>(
        "SELECT id FROM models WHERE id = ? AND is_active = 1",
        [model_hq_id]
      );
      if (model.length === 0) {
        return NextResponse.json({ error: "Modelo HQ no encontrado o inactivo" }, { status: 400 });
      }
    }

    if (model_chirp_id) {
      const [model] = await pool.execute<RowDataPacket[]>(
        "SELECT id FROM models WHERE id = ? AND is_active = 1",
        [model_chirp_id]
      );
      if (model.length === 0) {
        return NextResponse.json({ error: "Modelo Chirp no encontrado o inactivo" }, { status: 400 });
      }
    }

    // Check if config exists for this type
    const [existing] = await pool.execute<RowDataPacket[]>(
      "SELECT id, is_enabled, model_normal_id, model_hq_id, model_chirp_id FROM project_generation_config WHERE project_id = ? AND generation_type = ?",
      [id, generation_type]
    );

    if (existing.length === 0) {
      // Insert new config
      await pool.execute<ResultSetHeader>(`
        INSERT INTO project_generation_config
          (project_id, generation_type, is_enabled, model_normal_id, model_hq_id, model_chirp_id)
        VALUES (?, ?, ?, ?, ?, ?)
      `, [
        id,
        generation_type,
        is_enabled !== undefined ? (is_enabled ? 1 : 0) : 1,
        model_normal_id !== undefined ? (model_normal_id || null) : null,
        model_hq_id !== undefined ? (model_hq_id || null) : null,
        model_chirp_id !== undefined ? (model_chirp_id || null) : null,
      ]);
    } else {
      // Partial update - only update provided fields
      const updates: string[] = [];
      const values: (string | number | null)[] = [];

      if (is_enabled !== undefined) {
        updates.push("is_enabled = ?");
        values.push(is_enabled ? 1 : 0);
      }
      if (model_normal_id !== undefined) {
        updates.push("model_normal_id = ?");
        values.push(model_normal_id || null);
      }
      if (model_hq_id !== undefined) {
        updates.push("model_hq_id = ?");
        values.push(model_hq_id || null);
      }
      if (model_chirp_id !== undefined) {
        updates.push("model_chirp_id = ?");
        values.push(model_chirp_id || null);
      }

      if (updates.length > 0) {
        updates.push("updated_at = CURRENT_TIMESTAMP");
        values.push(id, generation_type);

        await pool.execute<ResultSetHeader>(
          `UPDATE project_generation_config SET ${updates.join(", ")} WHERE project_id = ? AND generation_type = ?`,
          values
        );
      }
    }

    return NextResponse.json({
      success: true,
      generation_type,
      is_enabled: is_enabled !== undefined ? is_enabled : true,
      model_normal_id: model_normal_id || null,
      model_hq_id: model_hq_id || null,
      model_chirp_id: model_chirp_id || null,
    });
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
      model_normal_id?: number;
      model_hq_id?: number;
      model_chirp_id?: number;
    }> = body.configs || [];

    // Verificar que el proyecto existe
    const [project] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM projects WHERE id = ?",
      [id]
    );
    if (project.length === 0) {
      return NextResponse.json({ error: "Proyecto no encontrado" }, { status: 404 });
    }

    // Insertar cada configuracion
    for (const config of configs) {
      if (!["text", "image", "video", "audio", "music"].includes(config.generation_type)) {
        continue;
      }

      await pool.execute<ResultSetHeader>(`
        INSERT INTO project_generation_config
          (project_id, generation_type, is_enabled, model_normal_id, model_hq_id, model_chirp_id)
        VALUES (?, ?, ?, ?, ?, ?)
        ON DUPLICATE KEY UPDATE
          is_enabled = VALUES(is_enabled),
          model_normal_id = VALUES(model_normal_id),
          model_hq_id = VALUES(model_hq_id),
          model_chirp_id = VALUES(model_chirp_id),
          updated_at = CURRENT_TIMESTAMP
      `, [
        id,
        config.generation_type,
        config.is_enabled ? 1 : 0,
        config.model_normal_id || null,
        config.model_hq_id || null,
        config.model_chirp_id || null,
      ]);
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
