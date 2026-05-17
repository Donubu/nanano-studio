import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { ResultSetHeader } from "mysql2";

const VALID_FIT_MODES = ["contain", "cover", "width", "height", "responsive"] as const;
type FitMode = (typeof VALID_FIT_MODES)[number];

// PATCH - Update mutable fields of an adaptation (admin only). For now just
// fit_mode; will expand to overrides_json and sort_order as features land.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; adaptationId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id: templateIdRaw, adaptationId: adaptationIdRaw } = await params;
    const templateId = Number(templateIdRaw);
    const adaptationId = Number(adaptationIdRaw);
    if (!Number.isFinite(templateId) || !Number.isFinite(adaptationId)) {
      return NextResponse.json({ error: "IDs inválidos" }, { status: 400 });
    }

    const body = await request.json();
    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (typeof body.fit_mode === "string") {
      if (!VALID_FIT_MODES.includes(body.fit_mode as FitMode)) {
        return NextResponse.json(
          { error: `fit_mode debe ser uno de: ${VALID_FIT_MODES.join(", ")}` },
          { status: 400 }
        );
      }
      updates.push("fit_mode = ?");
      values.push(body.fit_mode);
    }

    // overrides_json acepta:
    //  - object (se serializa a string)
    //  - null o "reset_overrides: true" → limpia el override y la pieza
    //    vuelve a renderizarse vía fit_mode automático desde el master
    if (body.reset_overrides === true) {
      updates.push("overrides_json = NULL");
    } else if ("overrides_json" in body) {
      if (body.overrides_json == null) {
        updates.push("overrides_json = NULL");
      } else if (typeof body.overrides_json === "object") {
        updates.push("overrides_json = ?");
        values.push(JSON.stringify(body.overrides_json));
      } else if (typeof body.overrides_json === "string") {
        // Validar que sea JSON parseable antes de guardar
        try {
          JSON.parse(body.overrides_json);
        } catch {
          return NextResponse.json(
            { error: "overrides_json no es un JSON válido" },
            { status: 400 }
          );
        }
        updates.push("overrides_json = ?");
        values.push(body.overrides_json);
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });
    }

    values.push(adaptationId, templateId);
    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE production_template_adaptations
          SET ${updates.join(", ")}
        WHERE id = ? AND template_id = ?`,
      values
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Adaptación no encontrada" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error actualizando adaptación:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// DELETE - Remove an adaptation (admin only).
export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; adaptationId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id: templateIdRaw, adaptationId: adaptationIdRaw } = await params;
    const templateId = Number(templateIdRaw);
    const adaptationId = Number(adaptationIdRaw);
    if (!Number.isFinite(templateId) || !Number.isFinite(adaptationId)) {
      return NextResponse.json({ error: "IDs inválidos" }, { status: 400 });
    }

    const [result] = await pool.execute<ResultSetHeader>(
      `DELETE FROM production_template_adaptations
        WHERE id = ? AND template_id = ?`,
      [adaptationId, templateId]
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Adaptación no encontrada" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error eliminando adaptación:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
