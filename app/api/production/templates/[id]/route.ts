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
      // Opt-in explícito: al guardar una orientación linked, empujar la
      // definition al master y al resto del grupo (comportamiento antiguo,
      // "sync bidireccional"). Sin esto, editar una linked la diferencia.
      propagate_to_group: z.boolean().optional(),
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
    // copiamos la definition de la fuente reflowed a las dims de este template.
    // No propaga a nadie: la fuente ya tiene ese contenido.
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

    // linked_to_template_id POST-update según lo que pidió el cliente. Si el
    // cliente lo está seteando a NULL en este mismo PUT (aceptar propuesta IA
    // "solo este formato", diferenciar) no debemos tratarla como linked.
    const effectiveLink =
      parsed.data.linked_to_template_id !== undefined
        ? parsed.data.linked_to_template_id
        : current.linked_to_template_id;

    // Regla de herencia: el master manda al resto; una orientación linked que
    // se edita a mano genera su propia versión. Es decir: guardar una
    // definition explícita sobre una linked la DIFERENCIA (linked → NULL) en
    // el mismo UPDATE, salvo que el cliente pida propagate_to_group.
    // Si el cliente manda linked_to_template_id explícito junto con la
    // definition, respetamos su intención (re-link con contenido o detach)
    // y no aplicamos la regla automática.
    const autoDifferentiate =
      clientSentDefinition &&
      parsed.data.linked_to_template_id === undefined &&
      current.linked_to_template_id != null &&
      parsed.data.propagate_to_group !== true;
    if (autoDifferentiate) {
      updates.push("linked_to_template_id = NULL");
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

    // Propagación de definition a las orientaciones linked del grupo.
    // Un grupo linked es: el master (principal del design, sin link) + todas
    // las orientaciones que apuntan a él. Solo el master propaga hacia abajo
    // (a las linked; las diferenciadas quedan fuera). Una linked editada a
    // mano se diferenció arriba y no propaga. Excepción opt-in:
    // propagate_to_group=true sobre una linked replica el comportamiento
    // antiguo (empuja al master + resto del grupo), usado por "aplicar
    // propuesta IA a todas las linkeadas".
    //
    // Un re-link (definition copiada de la fuente) nunca propaga.
    if (definitionChanged && clientSentDefinition && !autoDifferentiate) {
      const newDef = effectiveDefinition;
      let masterId: number | null = null;
      if (effectiveLink != null) {
        // Linked + propagate_to_group explícito.
        masterId = effectiveLink;
      } else if (current.design_id != null) {
        // Sin link. Es el master del grupo solo si es el principal del design
        // (MIN id sin link). Si no, es una diferenciada (standalone) y NO
        // propaga.
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
        const isPrincipal =
          minIdExcludingCurrent === null || minIdExcludingCurrent > id;
        if (isPrincipal) {
          masterId = id;
        }
      }

      if (masterId !== null) {
        // Master (si no es current) + todas las linked variants. Excluye
        // current (ya actualizado) y diferenciadas (sin link, id != masterId).
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

    // `differentiated` avisa al cliente que esta orientación dejó de heredar
    // del master en este mismo save (linked → independiente).
    return NextResponse.json({
      success: true,
      differentiated: autoDifferentiate,
    });
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
