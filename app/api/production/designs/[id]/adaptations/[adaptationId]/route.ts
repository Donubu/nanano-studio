// PATCH / DELETE de una adaptación específica del design.
//
// PATCH acepta:
//   - fit_mode: string enum
//   - source_template_id: number | null  (null = auto-pick por aspect)
//   - overrides_json: object | null
//   - reset_overrides: true  (atajo para overrides_json=NULL)
//
// Verifica que la adaptación pertenece al design referido en la URL antes
// de aplicar el cambio. Read-back devuelve la fila canónica.
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { ResultSetHeader, RowDataPacket } from "mysql2";

const VALID_FIT_MODES = ["contain", "cover", "width", "height", "responsive"] as const;
type FitMode = (typeof VALID_FIT_MODES)[number];

interface AdaptationFitRow extends RowDataPacket {
  id: number;
  design_id: number;
  source_template_id: number | null;
  fit_mode: FitMode;
  overrides_json: string | null;
}

interface TemplateLookupRow extends RowDataPacket {
  id: number;
  design_id: number | null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; adaptationId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { id: rawDesignId, adaptationId: rawAdaptationId } = await params;
    const designId = Number(rawDesignId);
    const adaptationId = Number(rawAdaptationId);
    if (!Number.isFinite(designId) || !Number.isFinite(adaptationId)) {
      return NextResponse.json({ error: "IDs inválidos" }, { status: 400 });
    }

    const body = await request.json();
    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    if (typeof body.fit_mode === "string") {
      if (!VALID_FIT_MODES.includes(body.fit_mode as FitMode)) {
        return NextResponse.json(
          { error: `fit_mode debe ser uno de: ${VALID_FIT_MODES.join(", ")}` },
          { status: 400 },
        );
      }
      updates.push("fit_mode = ?");
      values.push(body.fit_mode);
    }

    // source_template_id: null = auto-pick, number = orientación pinned.
    // Si viene una orientación, validamos que pertenezca al mismo design (no
    // permitimos cross-design sourcing — sería un nightmare conceptual).
    if ("source_template_id" in body) {
      if (body.source_template_id === null) {
        updates.push("source_template_id = NULL");
      } else if (Number.isFinite(Number(body.source_template_id))) {
        const sourceId = Number(body.source_template_id);
        const [tplRows] = await pool.execute<TemplateLookupRow[]>(
          "SELECT id, design_id FROM production_templates WHERE id = ? AND deleted_at IS NULL",
          [sourceId],
        );
        if (tplRows.length === 0) {
          return NextResponse.json(
            { error: "Source template no encontrado" },
            { status: 400 },
          );
        }
        if (tplRows[0].design_id !== designId) {
          return NextResponse.json(
            { error: "El source debe pertenecer al mismo design" },
            { status: 400 },
          );
        }
        updates.push("source_template_id = ?");
        values.push(sourceId);
      } else {
        return NextResponse.json(
          { error: "source_template_id debe ser número o null" },
          { status: 400 },
        );
      }
    }

    // overrides_json: object | null | reset_overrides shortcut.
    if (body.reset_overrides === true) {
      updates.push("overrides_json = NULL");
    } else if ("overrides_json" in body) {
      if (body.overrides_json == null) {
        updates.push("overrides_json = NULL");
      } else if (typeof body.overrides_json === "object") {
        updates.push("overrides_json = ?");
        values.push(JSON.stringify(body.overrides_json));
      } else if (typeof body.overrides_json === "string") {
        try {
          JSON.parse(body.overrides_json);
        } catch {
          return NextResponse.json(
            { error: "overrides_json no es un JSON válido" },
            { status: 400 },
          );
        }
        updates.push("overrides_json = ?");
        values.push(body.overrides_json);
      }
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "Nada para actualizar" }, { status: 400 });
    }

    values.push(adaptationId, designId);
    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE production_template_adaptations
          SET ${updates.join(", ")}
        WHERE id = ? AND design_id = ?`,
      values,
    );

    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Adaptación no encontrada" }, { status: 404 });
    }

    const [rows] = await pool.execute<AdaptationFitRow[]>(
      `SELECT id, design_id, source_template_id, fit_mode, overrides_json
         FROM production_template_adaptations
        WHERE id = ?`,
      [adaptationId],
    );
    return NextResponse.json({ success: true, adaptation: rows[0] ?? null });
  } catch (error) {
    console.error("Error actualizando adaptación:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; adaptationId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { id: rawDesignId, adaptationId: rawAdaptationId } = await params;
    const designId = Number(rawDesignId);
    const adaptationId = Number(rawAdaptationId);
    if (!Number.isFinite(designId) || !Number.isFinite(adaptationId)) {
      return NextResponse.json({ error: "IDs inválidos" }, { status: 400 });
    }
    const [result] = await pool.execute<ResultSetHeader>(
      `DELETE FROM production_template_adaptations
        WHERE id = ? AND design_id = ?`,
      [adaptationId, designId],
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
