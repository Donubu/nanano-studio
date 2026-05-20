// GET /api/production/templates/[id]/orientations
//
// Devuelve todas las orientaciones del master del template referido. Si el
// template está en un design, son todos los miembros del design. Si es
// standalone, devuelve solo el template (lista de 1).
//
// Incluye la definition_json parseada de cada orientación para que el cliente
// pueda renderear previews / adaptaciones sin más roundtrips.
//
// Esta es la fuente de verdad para "el master" del producir page: el master
// no es una fila singular sino el conjunto de orientaciones que comparten un
// design (o un solo template cuando no hay design).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket } from "mysql2";

interface OrientationRow extends RowDataPacket {
  id: number;
  production_project_id: number;
  design_id: number | null;
  linked_to_template_id: number | null;
  brand_kit_id: number | null;
  name: string;
  base_width: number;
  base_height: number;
  thumbnail_url: string | null;
  definition_json: string;
  version: number;
  created_at: string;
  updated_at: string;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { id: rawId } = await params;
    const id = Number(rawId);
    if (!Number.isFinite(id)) {
      return NextResponse.json({ error: "Template inválido" }, { status: 400 });
    }

    // Resolvemos el design del template. Si no tiene design, devolvemos solo
    // este template.
    const [refRows] = await pool.execute<OrientationRow[]>(
      `SELECT id, design_id FROM production_templates WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );
    if (refRows.length === 0) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 });
    }
    const designId = refRows[0].design_id;

    let rows: OrientationRow[];
    if (designId == null) {
      const [r] = await pool.execute<OrientationRow[]>(
        `SELECT id, production_project_id, design_id, linked_to_template_id,
                brand_kit_id, name, base_width, base_height, thumbnail_url,
                definition_json, version, created_at, updated_at
           FROM production_templates
          WHERE id = ? AND deleted_at IS NULL`,
        [id]
      );
      rows = r;
    } else {
      const [r] = await pool.execute<OrientationRow[]>(
        `SELECT id, production_project_id, design_id, linked_to_template_id,
                brand_kit_id, name, base_width, base_height, thumbnail_url,
                definition_json, version, created_at, updated_at
           FROM production_templates
          WHERE design_id = ? AND deleted_at IS NULL
          ORDER BY id ASC`,
        [designId]
      );
      rows = r;
    }

    const items = rows.map((r) => {
      let definition: unknown = null;
      try {
        definition = JSON.parse(r.definition_json);
      } catch {
        definition = null;
      }
      return {
        id: r.id,
        production_project_id: r.production_project_id,
        design_id: r.design_id,
        linked_to_template_id: r.linked_to_template_id,
        brand_kit_id: r.brand_kit_id,
        name: r.name,
        base_width: r.base_width,
        base_height: r.base_height,
        thumbnail_url: r.thumbnail_url,
        version: r.version,
        created_at: r.created_at,
        updated_at: r.updated_at,
        definition,
      };
    });

    return NextResponse.json(items);
  } catch (error) {
    console.error("Error obteniendo orientaciones:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
