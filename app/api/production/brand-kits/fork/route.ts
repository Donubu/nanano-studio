// Fork de un brand kit: crea un snapshot independiente scoped al proyecto
// indicado. El fork copia colors/typography/logos/spacing/rules_text del source
// y se persiste como un nuevo row con `production_project_id` seteado.
//
// Snapshot independiente (no shadow / no live link): si el cliente edita
// después el kit original, el fork NO se entera. Esto es por diseño — el
// fork representa la decisión del productor de "congelar" el kit como base
// para su proyecto y modificarlo a piacere sin afectar al cliente.
//
// URL: POST /api/production/brand-kits/fork
// Body: { source_kit_id: number, production_project_id: number, name?: string }
// Returns: el row completo del nuevo kit (mismo shape que GET /brand-kits).

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";

interface BrandKitRow extends RowDataPacket {
  id: number;
  client_id: number;
  production_project_id: number | null;
  name: string;
  colors_json: unknown;
  typography_json: unknown;
  logos_json: unknown;
  spacing_json: unknown;
  rules_text: string | null;
  is_default: number;
}

const schema = z.object({
  source_kit_id: z.number().int().positive(),
  production_project_id: z.number().int().positive(),
  name: z.string().min(1).max(150).optional(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const parsed = await parseBody(request, schema);
    if (parsed.error) return parsed.error;
    const { source_kit_id, production_project_id, name } = parsed.data;

    // Cargar el source. Debe pertenecer al mismo cliente que el proyecto
    // target — chequear vía join project → cliente. Excluimos soft-deleted
    // para no forkear desde kits eliminados.
    const [sourceRows] = await pool.execute<BrandKitRow[]>(
      `SELECT id, client_id, production_project_id, name, colors_json,
              typography_json, logos_json, spacing_json, rules_text, is_default
         FROM production_brand_kits
        WHERE id = ? AND deleted_at IS NULL`,
      [source_kit_id],
    );
    if (sourceRows.length === 0) {
      return NextResponse.json(
        { error: "Brand kit fuente no encontrado" },
        { status: 404 },
      );
    }
    const source = sourceRows[0];

    interface ProjectRow extends RowDataPacket {
      client_id: number;
    }
    const [projectRows] = await pool.execute<ProjectRow[]>(
      "SELECT client_id FROM production_projects WHERE id = ?",
      [production_project_id],
    );
    if (projectRows.length === 0) {
      return NextResponse.json(
        { error: "Proyecto target no encontrado" },
        { status: 404 },
      );
    }
    if (projectRows[0].client_id !== source.client_id) {
      return NextResponse.json(
        { error: "El brand kit fuente pertenece a otro cliente" },
        { status: 400 },
      );
    }

    // Nombre del fork: si el caller no pasa uno, usamos "{source.name}
    // (proyecto)". El productor lo puede editar después desde el editor.
    const forkName = name ?? `${source.name} (proyecto)`;

    // INSERT con snapshot completo. is_default queda en 0 — los forks
    // project-scoped no usan is_default (el editor de producción los
    // referencia explícitamente vía production_templates.brand_kit_id).
    const [result] = await pool.execute<ResultSetHeader>(
      `INSERT INTO production_brand_kits
         (client_id, production_project_id, name,
          colors_json, typography_json, logos_json, spacing_json,
          rules_text, is_default, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        source.client_id,
        production_project_id,
        forkName,
        // Las columnas JSON pueden venir como objeto parseado o string desde
        // mysql2 dependiendo del driver/versión. Re-serializamos para
        // garantizar formato consistente al insertar.
        source.colors_json !== null ? JSON.stringify(source.colors_json) : null,
        source.typography_json !== null ? JSON.stringify(source.typography_json) : null,
        source.logos_json !== null ? JSON.stringify(source.logos_json) : null,
        source.spacing_json !== null ? JSON.stringify(source.spacing_json) : null,
        source.rules_text,
        Number(session.user.id),
      ],
    );

    // Read-back: devolvemos el row completo del fork, mismo shape que GET.
    const [createdRows] = await pool.execute<BrandKitRow[]>(
      `SELECT id, client_id, production_project_id, name, colors_json,
              typography_json, logos_json, spacing_json, rules_text,
              is_default, created_by, created_at, updated_at
         FROM production_brand_kits
        WHERE id = ?`,
      [result.insertId],
    );
    return NextResponse.json(createdRows[0], { status: 201 });
  } catch (error) {
    console.error("Error forkeando brand_kit:", error);
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 },
    );
  }
}
