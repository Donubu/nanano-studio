import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import { reflowForPreview } from "@/lib/production/reflow";
import { TemplateDefinition } from "@/lib/production/types";

interface TemplateRow extends RowDataPacket {
  id: number;
  production_project_id: number;
  design_id: number | null;
  linked_to_template_id: number | null;
  name: string;
  description: string | null;
  base_width: number;
  base_height: number;
  definition_json: string;
  thumbnail_url: string | null;
  brand_kit_id: number | null;
  status: "draft" | "published" | "archived";
  version: number;
  created_by: number;
  created_at: Date;
  updated_at: Date;
}

interface LinkedRow extends RowDataPacket {
  id: number;
  base_width: number;
  base_height: number;
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
    const { id } = await params;
    const [rows] = await pool.execute<TemplateRow[]>(
      `SELECT id, production_project_id, design_id, linked_to_template_id,
              name, description, base_width, base_height, definition_json,
              thumbnail_url, brand_kit_id, status, version,
              created_by, created_at, updated_at
         FROM production_templates
        WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );
    if (rows.length === 0) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 });
    }
    const row = rows[0];
    // Parse definition_json server-side so client gets an object
    let definition: unknown = null;
    try {
      definition = JSON.parse(row.definition_json);
    } catch {
      definition = null;
    }
    return NextResponse.json({ ...row, definition });
  } catch (error) {
    console.error("Error obteniendo template:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
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

    const schema = z.object({
      name: z.string().min(1).max(255).optional(),
      description: z.string().max(5000).nullable().optional(),
      base_width: z.number().int().positive().max(10000).optional(),
      base_height: z.number().int().positive().max(10000).optional(),
      brand_kit_id: z.number().int().positive().nullable().optional(),
      design_id: z.number().int().positive().nullable().optional(),
      linked_to_template_id: z.number().int().positive().nullable().optional(),
      status: z.enum(["draft", "published", "archived"]).optional(),
      thumbnail_url: z.string().url().max(1000).nullable().optional(),
      definition: z.unknown().optional(),
    });
    const parsed = await parseBody(request, schema);
    if (parsed.error) return parsed.error;

    // Estado actual del template — necesario para decidir propagación y para
    // re-link (copiar definition de la fuente cuando cambia linked_to_template_id
    // de NULL a un valor).
    const [currentRows] = await pool.execute<TemplateRow[]>(
      `SELECT id, production_project_id, design_id, linked_to_template_id,
              name, description, base_width, base_height, definition_json,
              thumbnail_url, brand_kit_id, status, version,
              created_by, created_at, updated_at
         FROM production_templates
        WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );
    if (currentRows.length === 0) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 });
    }
    const current = currentRows[0];

    // Re-link: si el cliente cambia linked_to_template_id de NULL a un valor,
    // copiamos la definition de la fuente reflowed a las dims de este template
    // y forzamos definition_changed (para propagar a siblings que dependen de
    // esta cadena, aunque por ahora cada link apunta al master MIN(id)).
    const requestedLink = parsed.data.linked_to_template_id;
    const isRelinking =
      requestedLink !== undefined &&
      requestedLink !== null &&
      requestedLink !== current.linked_to_template_id;
    let relinkedDefinition: TemplateDefinition | null = null;
    if (isRelinking) {
      const [srcRows] = await pool.execute<TemplateRow[]>(
        `SELECT id, base_width, base_height, definition_json
           FROM production_templates
          WHERE id = ? AND deleted_at IS NULL`,
        [requestedLink]
      );
      if (srcRows.length === 0) {
        return NextResponse.json(
          { error: "Template fuente para re-link no encontrado" },
          { status: 400 }
        );
      }
      let srcDef: TemplateDefinition | null = null;
      try {
        srcDef = JSON.parse(srcRows[0].definition_json) as TemplateDefinition;
      } catch {
        srcDef = null;
      }
      if (srcDef) {
        relinkedDefinition = reflowForPreview(srcDef, {
          w: current.base_width,
          h: current.base_height,
        });
      }
    }

    const updates: string[] = [];
    const values: (string | number | null)[] = [];

    for (const key of [
      "name",
      "description",
      "base_width",
      "base_height",
      "brand_kit_id",
      "design_id",
      "linked_to_template_id",
      "status",
      "thumbnail_url",
    ] as const) {
      const v = parsed.data[key];
      if (v === undefined) continue;
      updates.push(`${key} = ?`);
      values.push(v as string | number | null);
    }
    // Si el cliente mandó una definition explícita, gana. Si no, pero estamos
    // re-linkeando, usamos la definition reflowed de la fuente.
    const clientSentDefinition = parsed.data.definition !== undefined;
    const effectiveDefinition: TemplateDefinition | null = clientSentDefinition
      ? (parsed.data.definition as TemplateDefinition)
      : relinkedDefinition;
    const definitionChanged = effectiveDefinition !== null;
    if (definitionChanged) {
      updates.push("definition_json = ?");
      values.push(JSON.stringify(effectiveDefinition));
      updates.push("version = version + 1");
    }
    if (updates.length === 0) {
      return NextResponse.json({ success: true });
    }
    values.push(id);

    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE production_templates SET ${updates.join(", ")} WHERE id = ? AND deleted_at IS NULL`,
      values
    );
    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 });
    }

    // Propagación de definition a las orientaciones linked del mismo grupo.
    // Un grupo linked es: el master (linked_to_template_id IS NULL dentro de
    // un design) + todas las orientaciones que apuntan a él. Editar CUALQUIER
    // miembro del grupo propaga al resto (excluyendo diferenciadas, que están
    // fuera del grupo por definición).
    //
    // Resolvemos el masterId del grupo:
    //   - si current.linked_to_template_id != null → masterId = ese.
    //   - si current.linked_to_template_id == null y es el principal del design
    //     (MIN id sin link) → masterId = current.id.
    //   - si current.linked_to_template_id == null pero NO es el principal →
    //     es una orientación diferenciada (standalone). No propaga.
    if (definitionChanged) {
      const newDef = effectiveDefinition;
      // Caller editó esta orientación. Solo propagamos si pertenece al grupo
      // linked. Si es el master, su id es la fuente. Si es una linked variant,
      // su linked_to_template_id apunta al master.
      //
      // IMPORTANTE: usamos el linked_to_template_id POST-update, no el de
      // `current` (que es pre-update). Si el cliente está SETEANDO
      // linked_to_template_id a NULL en este mismo PUT (típico al aceptar
      // una propuesta de IA o al diferenciar), no debemos propagar como si
      // todavía estuviera linkeado — la intención del cliente es detach.
      const effectiveLink =
        parsed.data.linked_to_template_id !== undefined
          ? parsed.data.linked_to_template_id
          : current.linked_to_template_id;
      let masterId: number | null = null;
      if (effectiveLink != null) {
        masterId = effectiveLink;
      } else if (current.design_id != null) {
        // linked_to_template_id es null post-update. Verificamos si current
        // es el principal (MIN id sin link) — si lo es, ES el master del grupo
        // y propaga. Si no, es una orientación diferenciada (standalone) y
        // NO propaga.
        const [minRows] = await pool.execute<RowDataPacket[]>(
          `SELECT MIN(id) AS min_id
             FROM production_templates
            WHERE design_id = ?
              AND linked_to_template_id IS NULL
              AND id != ?
              AND deleted_at IS NULL`,
          [current.design_id, id]
        );
        const minIdExcludingCurrent =
          (minRows[0] as { min_id: number | null })?.min_id ?? null;
        // current es el principal si no hay otro template del design sin
        // link con id menor. Si minIdExcludingCurrent es null o > current.id,
        // current es el menor → es el principal.
        const isPrincipal =
          minIdExcludingCurrent === null || minIdExcludingCurrent > id;
        if (isPrincipal) {
          masterId = id;
        }
      }

      if (masterId !== null) {
        // Trae master (si no es current) + todas las linked variants. Excluye
        // current (ya lo actualizamos arriba). Excluye diferenciadas
        // (linked_to_template_id IS NULL y id != masterId).
        const [siblings] = await pool.execute<LinkedRow[]>(
          `SELECT id, base_width, base_height
             FROM production_templates
            WHERE (id = ? OR linked_to_template_id = ?)
              AND id != ?
              AND deleted_at IS NULL`,
          [masterId, masterId, id]
        );
        for (const sibling of siblings) {
          const reflowed = reflowForPreview(newDef, {
            w: sibling.base_width,
            h: sibling.base_height,
          });
          await pool.execute<ResultSetHeader>(
            `UPDATE production_templates
                SET definition_json = ?, version = version + 1
              WHERE id = ?`,
            [JSON.stringify(reflowed), sibling.id]
          );
        }
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error actualizando template:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { id } = await params;
    const [result] = await pool.execute<ResultSetHeader>(
      `UPDATE production_templates SET deleted_at = CURRENT_TIMESTAMP
        WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );
    if (result.affectedRows === 0) {
      return NextResponse.json({ error: "Template no encontrado" }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error eliminando template:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
