import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";

// POST - Marcar modelo como obsoleto con reemplazo
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
    const { replacement_model_id } = body;

    // Verify model exists
    const [model] = await pool.execute<RowDataPacket[]>(
      "SELECT id, display_name, is_obsolete FROM models WHERE id = ?",
      [id]
    );
    if (model.length === 0) {
      return NextResponse.json({ error: "Modelo no encontrado" }, { status: 404 });
    }

    if (model[0].is_obsolete) {
      return NextResponse.json({ error: "El modelo ya está marcado como obsoleto" }, { status: 400 });
    }

    // Get projects using this model
    const [projectAssociations] = await pool.execute<RowDataPacket[]>(
      `SELECT pgm.project_id, pgm.generation_type, pgm.label, pgm.sort_order, pgm.is_default
       FROM project_generation_models pgm
       WHERE pgm.model_id = ?`,
      [id]
    );

    // If model is associated with projects, replacement is required
    if (projectAssociations.length > 0 && !replacement_model_id) {
      return NextResponse.json(
        { error: "El modelo está asociado a proyectos. Debe seleccionar un modelo de reemplazo." },
        { status: 400 }
      );
    }

    // If replacement provided, verify it exists and is not obsolete
    if (replacement_model_id) {
      const [replacement] = await pool.execute<RowDataPacket[]>(
        "SELECT id, display_name, is_obsolete FROM models WHERE id = ?",
        [replacement_model_id]
      );
      if (replacement.length === 0) {
        return NextResponse.json({ error: "Modelo de reemplazo no encontrado" }, { status: 404 });
      }
      if (replacement[0].is_obsolete) {
        return NextResponse.json({ error: "El modelo de reemplazo no puede ser obsoleto" }, { status: 400 });
      }
      if (Number(replacement_model_id) === Number(id)) {
        return NextResponse.json({ error: "El modelo de reemplazo no puede ser el mismo modelo" }, { status: 400 });
      }

      // Replace in all project associations
      for (const assoc of projectAssociations) {
        // Check if the replacement model already exists in this project+type
        const [existing] = await pool.execute<RowDataPacket[]>(
          `SELECT id FROM project_generation_models
           WHERE project_id = ? AND generation_type = ? AND model_id = ?`,
          [assoc.project_id, assoc.generation_type, replacement_model_id]
        );

        if (existing.length > 0) {
          // Replacement already exists in this project+type, just remove the old model
          // If old was default and replacement isn't, make replacement default
          if (assoc.is_default) {
            await pool.execute<ResultSetHeader>(
              `UPDATE project_generation_models SET is_default = 1
               WHERE project_id = ? AND generation_type = ? AND model_id = ?`,
              [assoc.project_id, assoc.generation_type, replacement_model_id]
            );
          }
          await pool.execute<ResultSetHeader>(
            `DELETE FROM project_generation_models
             WHERE project_id = ? AND generation_type = ? AND model_id = ?`,
            [assoc.project_id, assoc.generation_type, id]
          );
        } else {
          // Replacement doesn't exist, swap old model for new one (keep label, sort_order, is_default)
          await pool.execute<ResultSetHeader>(
            `UPDATE project_generation_models SET model_id = ?
             WHERE project_id = ? AND generation_type = ? AND model_id = ?`,
            [replacement_model_id, assoc.project_id, assoc.generation_type, id]
          );
        }
      }
    }

    // Mark model as obsolete and inactive
    await pool.execute<ResultSetHeader>(
      `UPDATE models SET is_obsolete = TRUE, is_active = FALSE, replaced_by_model_id = ?
       WHERE id = ?`,
      [replacement_model_id || null, id]
    );

    return NextResponse.json({
      success: true,
      projects_updated: projectAssociations.length,
    });
  } catch (error) {
    console.error("Error marcando modelo como obsoleto:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    );
  }
}
