// Endpoint: genera una TemplateDefinition desde 1-3 imágenes de referencia
// usando el agente Banner Designer. El productor sube las imágenes vía
// /api/production/upload, pasa las URLs públicas acá, y el agente analiza
// cada una con analyze_media (Gemini vision) para extraer composición /
// paleta / jerarquía. Después compone master + variantes aplicando el
// brand kit del cliente.
//
// URL: POST /api/production/ai/generate-from-reference
//   Body: {
//     production_project_id: number,
//     reference_files: [{ filename, publicUrl, mimeType }],  // 1-3
//     intent?: string,
//     instructions?: string,
//     master_dims?: { w, h },         // default 1920x1080
//     secondary_aspects?: [{ w, h }], // default [1080x1080, 1080x1920]
//   }
//
// Devuelve { proposal: { definition, variants[] }, rationale, tokenUsage,
// invocation_id }. NO crea el template — el cliente arma el POST final con
// la proposal cuando el productor confirma.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import {
  BrandKit,
  BrandKitContent,
  EMPTY_KIT_CONTENT,
  brandKitFromApi,
} from "@/lib/production/brand-kit";
import {
  runGenerateFromReference,
  brandKitForAgent,
  BANNER_DESIGNER_AGENT_NAME,
} from "@/lib/production/banner-designer";

interface ProjectRow extends RowDataPacket {
  client_id: number;
}

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
  deleted_at: Date | null;
}

const bodySchema = z.object({
  production_project_id: z.number().int().positive(),
  reference_files: z
    .array(
      z.object({
        filename: z.string().min(1).max(255),
        publicUrl: z.string().url().max(2000),
        mimeType: z.string().min(1).max(100),
      }),
    )
    .min(1)
    .max(3),
  intent: z.string().max(2000).optional(),
  instructions: z.string().max(2000).optional(),
  master_dims: z
    .object({
      w: z.number().int().positive().max(10000),
      h: z.number().int().positive().max(10000),
    })
    .optional(),
  secondary_aspects: z
    .array(
      z.object({
        w: z.number().int().positive().max(10000),
        h: z.number().int().positive().max(10000),
      }),
    )
    .max(5)
    .optional(),
});

// Dims default: igual que CANONICAL_SIZES en lib/production/layout-templates.ts
const DEFAULT_MASTER = { w: 1920, h: 1080 };
const DEFAULT_VARIANTS = [
  { w: 1080, h: 1080 },
  { w: 1080, h: 1920 },
];

export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    if (!session.user.email) {
      return NextResponse.json(
        { error: "Sesión sin email — no se puede invocar practicante" },
        { status: 400 },
      );
    }

    const parsed = await parseBody(request, bodySchema);
    if (parsed.error) return parsed.error;
    const {
      production_project_id,
      reference_files,
      intent,
      instructions,
      master_dims,
      secondary_aspects,
    } = parsed.data;

    // Brand kit del cliente. Mismo patrón que adapt-orientation:
    // client-wide default + project-scoped default, merged. Si el productor
    // tiene un fork project-scoped en uso, se aplica encima. Esto va al
    // CONTEXTO del agente para que use los tokens correctos.
    const [projRows] = await pool.execute<ProjectRow[]>(
      "SELECT client_id FROM production_projects WHERE id = ?",
      [production_project_id],
    );
    if (projRows.length === 0) {
      return NextResponse.json(
        { error: "Proyecto no encontrado" },
        { status: 404 },
      );
    }
    const clientId = projRows[0].client_id;

    let mergedKit: BrandKitContent = EMPTY_KIT_CONTENT;
    const [kitRows] = await pool.execute<BrandKitRow[]>(
      `SELECT id, client_id, production_project_id, name, colors_json,
              typography_json, logos_json, spacing_json, rules_text,
              is_default, deleted_at
         FROM production_brand_kits
        WHERE client_id = ?
          AND (production_project_id IS NULL OR production_project_id = ?)
          AND deleted_at IS NULL`,
      [clientId, production_project_id],
    );
    const parsedKits: BrandKit[] = kitRows.map((r) => brandKitFromApi(r));
    const clientWide = parsedKits.filter((k) => k.production_project_id === null);
    const projectScoped = parsedKits.filter((k) => k.production_project_id != null);
    const baseClient = clientWide.find((k) => k.is_default) ?? clientWide[0];
    const baseProject =
      projectScoped.find((k) => k.is_default) ?? projectScoped[0];
    // Merge manual aquí (mergeKits vive en brand-kit lib, lo replicamos
    // mínimo): project pisa client token-por-token.
    if (baseClient || baseProject) {
      mergedKit = {
        colors: [
          ...(baseClient?.content.colors ?? []),
          ...(baseProject?.content.colors ?? []),
        ],
        fonts: [
          ...(baseClient?.content.fonts ?? []),
          ...(baseProject?.content.fonts ?? []),
        ],
        scales: [
          ...(baseClient?.content.scales ?? []),
          ...(baseProject?.content.scales ?? []),
        ],
        spacing: [
          ...(baseClient?.content.spacing ?? []),
          ...(baseProject?.content.spacing ?? []),
        ],
        logos: [
          ...(baseClient?.content.logos ?? []),
          ...(baseProject?.content.logos ?? []),
        ],
      };
      // Dedupe por name preservando el último (= project gana sobre client).
      mergedKit = {
        colors: dedupeByName(mergedKit.colors),
        fonts: dedupeByName(mergedKit.fonts),
        scales: dedupeByName(mergedKit.scales),
        spacing: dedupeByName(mergedKit.spacing),
        logos: dedupeByName(mergedKit.logos),
      };
    }

    // Llamada al agente.
    const masterDims = master_dims ?? DEFAULT_MASTER;
    const secondaryAspects = secondary_aspects ?? DEFAULT_VARIANTS;
    const result = await runGenerateFromReference({
      masterDims,
      secondaryAspects,
      brandKit: brandKitForAgent(mergedKit),
      intent,
      instructions,
      userEmail: session.user.email,
      referenceFiles: reference_files,
    });

    // Registro de invocación para auditoría / cost tracking.
    const [inv] = await pool.execute<ResultSetHeader>(
      `INSERT INTO production_ai_invocations
         (production_project_id, template_id, target_template_id, operation,
          agent_name, input_tokens, output_tokens, estimated_cost,
          success, error_msg, conversation_id, rationale, created_by)
       VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        production_project_id,
        "GENERATE_FROM_REFERENCE",
        BANNER_DESIGNER_AGENT_NAME,
        result.tokenUsage?.inputTokens ?? null,
        result.tokenUsage?.outputTokens ?? null,
        result.tokenUsage?.estimatedCost ?? null,
        result.ok ? 1 : 0,
        result.ok ? null : result.error,
        result.conversationId ?? null,
        result.ok ? result.rationale : null,
        Number(session.user.id),
      ],
    );

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error,
          invocation_id: inv.insertId,
          tokenUsage: result.tokenUsage,
        },
        { status: 502 },
      );
    }

    return NextResponse.json({
      proposal: {
        definition: result.definition,
        variants: result.variants,
      },
      rationale: result.rationale,
      tokenUsage: result.tokenUsage,
      conversationId: result.conversationId,
      invocation_id: inv.insertId,
    });
  } catch (error) {
    console.error("Error en generate-from-reference:", error);
    return NextResponse.json(
      { error: `Error interno: ${(error as Error).message}` },
      { status: 500 },
    );
  }
}

function dedupeByName<T extends { name: string }>(items: T[]): T[] {
  const map = new Map<string, T>();
  for (const it of items) {
    map.set(it.name, it);
  }
  return Array.from(map.values());
}
