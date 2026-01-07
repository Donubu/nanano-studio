import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

interface ProjectModelRow extends RowDataPacket {
  id: number;
  project_id: number;
  model_id: number;
  model_model_id: string;
  model_display_name: string;
  is_default: boolean;
  system_instruction: string | null;
  supports_image_generation: number; // MySQL TINYINT
  supports_video_generation: number; // MySQL TINYINT
  created_at: Date;
}

// GET - Listar modelos de un proyecto
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

    // Verificar acceso al proyecto (admin o usuario asignado)
    if (session.user.role !== "admin") {
      const [access] = await pool.execute<RowDataPacket[]>(
        "SELECT 1 FROM project_users WHERE project_id = ? AND user_id = ?",
        [id, session.user.id]
      );
      if (access.length === 0) {
        return NextResponse.json({ error: "No autorizado" }, { status: 401 });
      }
    }

    const [rows] = await pool.execute<ProjectModelRow[]>(`
      SELECT
        pm.id, pm.project_id, pm.model_id, pm.is_default, pm.system_instruction, pm.created_at,
        m.model_id as model_model_id, m.display_name as model_display_name,
        m.supports_image_generation, m.supports_video_generation
      FROM project_models pm
      JOIN models m ON pm.model_id = m.id
      WHERE pm.project_id = ? AND m.is_active = TRUE
      ORDER BY pm.is_default DESC, m.display_name ASC
    `, [id]);

    // Convert MySQL TINYINT to proper booleans
    const modelsWithBooleans = rows.map(row => ({
      ...row,
      supports_image_generation: Boolean(row.supports_image_generation),
      supports_video_generation: Boolean(row.supports_video_generation),
    }));

    return NextResponse.json(modelsWithBooleans);
  } catch (error) {
    console.error("Error obteniendo modelos del proyecto:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// POST - Agregar modelo a proyecto
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
    const { model_id, is_default = false, system_instruction } = body;

    if (!model_id) {
      return NextResponse.json(
        { error: "El model_id es requerido" },
        { status: 400 }
      );
    }

    // Verificar si ya existe la asociación
    const [existing] = await pool.execute<RowDataPacket[]>(
      "SELECT id FROM project_models WHERE project_id = ? AND model_id = ?",
      [id, model_id]
    );

    if (existing.length > 0) {
      return NextResponse.json(
        { error: "El modelo ya está asignado al proyecto" },
        { status: 400 }
      );
    }

    // Si es default, quitar el default actual
    if (is_default) {
      await pool.execute(
        "UPDATE project_models SET is_default = FALSE WHERE project_id = ?",
        [id]
      );
    }

    const [result] = await pool.execute<ResultSetHeader>(
      "INSERT INTO project_models (project_id, model_id, is_default, system_instruction) VALUES (?, ?, ?, ?)",
      [id, model_id, is_default, system_instruction ?? null]
    );

    return NextResponse.json(
      { id: result.insertId, project_id: Number(id), model_id, is_default, system_instruction },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error agregando modelo al proyecto:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// PUT - Actualizar modelo en proyecto (cambiar default o system_instruction)
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
    const { model_id, is_default, system_instruction } = body;

    if (!model_id) {
      return NextResponse.json(
        { error: "El model_id es requerido" },
        { status: 400 }
      );
    }

    // Si se está estableciendo como default
    if (is_default !== undefined && is_default) {
      // Quitar el default actual
      await pool.execute(
        "UPDATE project_models SET is_default = FALSE WHERE project_id = ?",
        [id]
      );
    }

    // Construir query dinámicamente según los campos proporcionados
    const updates: string[] = [];
    const values: (boolean | string | number | null)[] = [];

    if (is_default !== undefined) {
      updates.push("is_default = ?");
      values.push(is_default);
    }

    if (system_instruction !== undefined) {
      updates.push("system_instruction = ?");
      values.push(system_instruction);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "No hay campos para actualizar" }, { status: 400 });
    }

    values.push(id, model_id);

    await pool.execute<ResultSetHeader>(
      `UPDATE project_models SET ${updates.join(", ")} WHERE project_id = ? AND model_id = ?`,
      values
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error actualizando modelo del proyecto:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}

// DELETE - Remover modelo de proyecto
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();

    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const modelId = searchParams.get("model_id");

    if (!modelId) {
      return NextResponse.json(
        { error: "El model_id es requerido" },
        { status: 400 }
      );
    }

    const [result] = await pool.execute<ResultSetHeader>(
      "DELETE FROM project_models WHERE project_id = ? AND model_id = ?",
      [id, modelId]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json(
        { error: "Asociación no encontrada" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removiendo modelo del proyecto:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
