import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import {
  DEFAULT_TEMPLATE_DEFINITION,
  DEFAULT_TEMPLATE_HEIGHT,
  DEFAULT_TEMPLATE_WIDTH,
} from "@/lib/production/defaults";

interface TemplateRow extends RowDataPacket {
  id: number;
  production_project_id: number;
  design_id: number | null;
  design_name: string | null;
  linked_to_template_id: number | null;
  name: string;
  description: string | null;
  base_width: number;
  base_height: number;
  // definition_json viene como LONGTEXT (string serializado). El listado lo
  // necesita para renderizar el preview del master en cada card sin tener
  // que hacer N+1 fetches al endpoint del template individual.
  definition_json: string | null;
  thumbnail_url: string | null;
  brand_kit_id: number | null;
  status: "draft" | "published" | "archived";
  version: number;
  created_by: number;
  created_at: Date;
  updated_at: Date;
  adaptation_count?: number;
  // Cuántas variantes (otros templates) viven dentro del mismo design.
  // 0 cuando es standalone, N cuando hay variantes adicionales.
  variant_count?: number;
}

// GET - List templates for a production project
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const projectId = searchParams.get("production_project_id");
    // Cuando include_variants=true, devolvemos TODOS los templates del
    // proyecto (incluidas variantes dentro de un design). Default = false:
    // listado a nivel de proyecto colapsa cada design a su base.
    const includeVariants = searchParams.get("include_variants") === "true";
    if (!projectId) {
      return NextResponse.json(
        { error: "production_project_id es requerido" },
        { status: 400 }
      );
    }

    // Filtro de design: cuando include_variants es false (listado del
    // proyecto), por cada design devolvemos el template con MIN(id) — la
    // base. Cuando es true (producir / sibling lookup), devolvemos todos.
    const designFilter = includeVariants
      ? ""
      : `AND (
            pt.design_id IS NULL
            OR pt.id = (
              SELECT MIN(pt2.id) FROM production_templates pt2
               WHERE pt2.design_id = pt.design_id AND pt2.deleted_at IS NULL
            )
          )`;

    const [rows] = await pool.execute<TemplateRow[]>(
      `SELECT pt.id, pt.production_project_id, pt.design_id, pt.linked_to_template_id,
              pt.name, pt.description, pt.base_width, pt.base_height,
              pt.definition_json, pt.thumbnail_url, pt.brand_kit_id,
              pt.status, pt.version,
              pt.created_by, pt.created_at, pt.updated_at,
              d.name AS design_name,
              -- adaptation_count: las adaptaciones cuelgan del design (no de un
              -- template), así que contamos las del design al que pertenece este
              -- template. Si no tiene design (caso defensivo), retorna 0.
              CASE
                WHEN pt.design_id IS NULL THEN 0
                ELSE (
                  SELECT COUNT(*) FROM production_template_adaptations a
                   WHERE a.design_id = pt.design_id
                )
              END AS adaptation_count,
              CASE
                WHEN pt.design_id IS NULL THEN 0
                ELSE (
                  SELECT COUNT(*) - 1
                    FROM production_templates pt3
                   WHERE pt3.design_id = pt.design_id
                     AND pt3.deleted_at IS NULL
                )
              END AS variant_count
         FROM production_templates pt
         LEFT JOIN production_designs d
                ON d.id = pt.design_id AND d.deleted_at IS NULL
        WHERE pt.production_project_id = ? AND pt.deleted_at IS NULL
          ${designFilter}
        ORDER BY pt.updated_at DESC`,
      [projectId]
    );

    // Parse definition_json server-side (same convention used by the
     // single-template GET): the list card needs the parsed master to render
     // an inline preview, parsing per card on the client would be O(n) JSON.parse.
    const enriched = rows.map((r) => {
      let definition: unknown = null;
      if (r.definition_json) {
        try {
          definition = JSON.parse(r.definition_json);
        } catch {
          definition = null;
        }
      }
      // We drop the raw string to keep payload smaller and avoid sending two
      // representations of the same data.
      const { definition_json: _omit, ...rest } = r;
      void _omit;
      return { ...rest, definition };
    });

    return NextResponse.json(enriched);
  } catch (error) {
    console.error("Error listando production_templates:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// POST - Crear template. Soporta dos modos:
//   1. Default (sin definition): crea un master en blanco con definition_json
//      derivado de DEFAULT_TEMPLATE_DEFINITION.
//   2. Con definition: el cliente manda el árbol completo (típicamente desde
//      un layout template instanciado en cliente). Opcionalmente además puede
//      mandar `variants: [{ width, height, definition }]` para crear las
//      orientaciones linked en la misma transacción — sirve para que un
//      layout template multi-aspect cree master + variantes en un solo POST.
//
// definition / variants[].definition son `unknown` en el schema porque la
// validación profunda del árbol de capas tiene mucha superficie; confiamos
// en que el cliente manda bien-formado y el renderer es tolerante a faltas.
// Validamos lo crítico (es objeto + tiene size) acá; el resto es runtime.
const variantSchema = z.object({
  width: z.number().int().positive().max(10000),
  height: z.number().int().positive().max(10000),
  definition: z.unknown(),
});

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const schema = z.object({
      production_project_id: z.number().int().positive(),
      name: z.string().min(1).max(255),
      description: z.string().max(5000).optional().nullable(),
      base_width: z.number().int().positive().max(10000).optional(),
      base_height: z.number().int().positive().max(10000).optional(),
      brand_kit_id: z.number().int().positive().optional().nullable(),
      definition: z.unknown().optional(),
      variants: z.array(variantSchema).optional(),
    });
    const parsed = await parseBody(request, schema);
    if (parsed.error) return parsed.error;
    const {
      production_project_id,
      name,
      description,
      base_width = DEFAULT_TEMPLATE_WIDTH,
      base_height = DEFAULT_TEMPLATE_HEIGHT,
      brand_kit_id,
      definition: clientDefinition,
      variants,
    } = parsed.data;

    // Si el cliente mandó una definition la usamos tal cual; si no, default
    // vacío con el tamaño del template.
    const definition = clientDefinition ?? {
      ...DEFAULT_TEMPLATE_DEFINITION,
      size: { w: base_width, h: base_height },
    };

    // Resolución del brand_kit_id efectivo:
    //   - Si el cliente pasó uno explícito, ese gana.
    //   - Si no, buscamos el default client-wide (is_default=1, scope=NULL)
    //     del cliente dueño del proyecto. Así los templates nuevos heredan
    //     automáticamente el kit que el admin marcó como por defecto en el
    //     dashboard del cliente.
    //   - Si ni siquiera hay default, queda NULL — el editor maneja ese
    //     caso mostrando vacío y dejando al productor elegir uno.
    let effectiveBrandKitId: number | null = brand_kit_id ?? null;
    if (effectiveBrandKitId == null) {
      interface ProjectClientRow extends RowDataPacket {
        client_id: number;
      }
      const [pcRows] = await pool.execute<ProjectClientRow[]>(
        "SELECT client_id FROM production_projects WHERE id = ?",
        [production_project_id]
      );
      if (pcRows.length > 0) {
        interface BrandKitIdRow extends RowDataPacket {
          id: number;
        }
        const [dkRows] = await pool.execute<BrandKitIdRow[]>(
          `SELECT id FROM production_brand_kits
            WHERE client_id = ?
              AND production_project_id IS NULL
              AND is_default = 1
              AND deleted_at IS NULL
            LIMIT 1`,
          [pcRows[0].client_id]
        );
        if (dkRows.length > 0) {
          effectiveBrandKitId = dkRows[0].id;
        }
      }
    }

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();
      const [designRes] = await conn.execute<ResultSetHeader>(
        `INSERT INTO production_designs (production_project_id, name, description, created_by)
         VALUES (?, ?, ?, ?)`,
        [production_project_id, name, description ?? null, Number(session.user.id)]
      );
      const designId = designRes.insertId;
      const [result] = await conn.execute<ResultSetHeader>(
        `INSERT INTO production_templates
           (production_project_id, design_id, name, description, base_width, base_height,
            definition_json, brand_kit_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          production_project_id,
          designId,
          name,
          description ?? null,
          base_width,
          base_height,
          JSON.stringify(definition),
          effectiveBrandKitId,
          Number(session.user.id),
        ]
      );
      const masterId = result.insertId;

      // Variants (linked al master): se crean con su propia definition. Cada
      // variant queda `linked_to_template_id = master.id`, así pertenecen al
      // mismo grupo de sync — aunque sus definitions iniciales sean DISTINTAS
      // (típico al instanciar un layout template multi-aspect). El motor de
      // propagación bidireccional re-flowa después si el usuario edita el master.
      const createdVariantIds: number[] = [];
      if (variants && variants.length > 0) {
        for (const v of variants) {
          // Saltamos duplicados exactos del master.
          if (v.width === base_width && v.height === base_height) continue;
          const [vRes] = await conn.execute<ResultSetHeader>(
            `INSERT INTO production_templates
               (production_project_id, design_id, linked_to_template_id, name,
                base_width, base_height, definition_json, brand_kit_id, created_by)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              production_project_id,
              designId,
              masterId,
              variantSuggestedName(v.width, v.height),
              v.width,
              v.height,
              JSON.stringify(v.definition),
              effectiveBrandKitId,
              Number(session.user.id),
            ],
          );
          createdVariantIds.push(vRes.insertId);
        }
      }

      await conn.commit();
      return NextResponse.json(
        {
          id: masterId,
          production_project_id,
          design_id: designId,
          name,
          base_width,
          base_height,
          variant_ids: createdVariantIds,
        },
        { status: 201 }
      );
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (error) {
    console.error("Error creando production_template:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}

// Nombre legible de la orientación según el aspect. Mismo criterio que el
// endpoint variants/route.ts para mantener consistencia visual.
function variantSuggestedName(width: number, height: number): string {
  const r = width / height;
  if (Math.abs(r - 1) < 0.05) return "Cuadrado";
  if (Math.abs(r - 16 / 9) < 0.05) return "Horizontal";
  if (Math.abs(r - 9 / 16) < 0.05) return "Vertical";
  if (r > 1) return "Horizontal";
  if (r < 1) return "Vertical";
  return "Personalizado";
}
