// Crear una variante de orientación a partir del template base.
// La variante nueva:
//   1. Hereda el design_id del base (creando uno si no existía).
//   2. Queda linked_to_template_id = base.id (heredando layout).
//   3. Su definition_json se calcula reflowing el base a las nuevas medidas
//      (con smart constraints, gracias a effectiveConstraints).
//
// Variantes "distintas" son las que después se marcan como tales vía PATCH
// del template con linked_to_template_id = null (se pierde el link, mantienen
// su propio definition_json a partir de ese momento).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { reflowForPreview } from "@/lib/production/reflow";
import { TemplateDefinition } from "@/lib/production/types";

interface BaseTemplateRow extends RowDataPacket {
  id: number;
  production_project_id: number;
  design_id: number | null;
  name: string;
  base_width: number;
  base_height: number;
  definition_json: string;
  brand_kit_id: number | null;
}

interface DesignInsertRow extends RowDataPacket {
  id: number;
}

function variantSuggestedName(width: number, height: number): string {
  const r = width / height;
  if (Math.abs(r - 1) < 0.05) return "Cuadrado";
  if (Math.abs(r - 16 / 9) < 0.05) return "Horizontal";
  if (Math.abs(r - 9 / 16) < 0.05) return "Vertical";
  if (r > 1) return "Horizontal";
  if (r < 1) return "Vertical";
  return "Personalizado";
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { id: rawId } = await params;
    const baseId = Number(rawId);
    if (!Number.isFinite(baseId)) {
      return NextResponse.json({ error: "Template inválido" }, { status: 400 });
    }

    const body = await request.json();
    const width = Number(body.width);
    const height = Number(body.height);
    const customName: string | null =
      typeof body.name === "string" && body.name.trim() !== ""
        ? body.name.trim()
        : null;
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return NextResponse.json({ error: "Dimensiones inválidas" }, { status: 400 });
    }

    const [baseRows] = await pool.execute<BaseTemplateRow[]>(
      `SELECT id, production_project_id, design_id, name, base_width, base_height,
              definition_json, brand_kit_id
         FROM production_templates
        WHERE id = ? AND deleted_at IS NULL`,
      [baseId]
    );
    if (baseRows.length === 0) {
      return NextResponse.json({ error: "Template base no encontrado" }, { status: 404 });
    }
    const base = baseRows[0];

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Aseguramos que el base tenga un design (auto-crea uno si no existe).
      // Así las variantes se agrupan visualmente.
      let designId = base.design_id;
      if (designId == null) {
        const [createdDesign] = await conn.execute<ResultSetHeader>(
          `INSERT INTO production_designs (production_project_id, name, created_by)
           VALUES (?, ?, ?)`,
          [base.production_project_id, base.name, Number(session.user.id)]
        );
        designId = createdDesign.insertId;
        await conn.execute<ResultSetHeader>(
          "UPDATE production_templates SET design_id = ? WHERE id = ?",
          [designId, base.id]
        );
        // Refresh local
        await conn.execute<DesignInsertRow[]>(
          "SELECT id FROM production_designs WHERE id = ?",
          [designId]
        );
      }

      // Reflowing el master del base a las nuevas dimensiones nos da un layout
      // razonable de partida (smart constraints aplicados via reflow).
      let parsedDef: TemplateDefinition | null = null;
      try {
        parsedDef = JSON.parse(base.definition_json) as TemplateDefinition;
      } catch {
        parsedDef = null;
      }
      const variantDef = parsedDef
        ? reflowForPreview(parsedDef, { w: width, h: height })
        : null;

      const variantName = customName || `${base.name} · ${variantSuggestedName(width, height)}`;

      const [result] = await conn.execute<ResultSetHeader>(
        `INSERT INTO production_templates
           (production_project_id, design_id, linked_to_template_id, name,
            base_width, base_height, definition_json, brand_kit_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          base.production_project_id,
          designId,
          base.id,
          variantName,
          width,
          height,
          JSON.stringify(variantDef ?? {
            id: "tpl_root",
            type: "frame",
            position: { x: 0, y: 0 },
            size: { w: width, h: height },
            background: { type: "color", value: "#ffffff" },
            layout: { mode: "free" },
            children: [],
          }),
          base.brand_kit_id,
          Number(session.user.id),
        ]
      );

      await conn.commit();
      return NextResponse.json(
        { id: result.insertId, design_id: designId, linked_to_template_id: base.id },
        { status: 201 }
      );
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error("Error creando variante:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
