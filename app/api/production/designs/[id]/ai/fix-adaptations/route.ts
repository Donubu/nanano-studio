// Endpoint: corrige con IA un lote de adaptaciones de un design.
//
// URL: POST /api/production/designs/[id]/ai/fix-adaptations
// Body: {
//   items: [{ adaptation_id, tree, source_tree?, image? }],  // 1..24
//   instructions?: string
// }
//   - tree: el árbol que hoy muestra la card (adaptTree / fit), SIN resolver
//     tokens. Es la base sobre la que se aplican las correcciones, así lo
//     que se guarda conserva las referencias a la marca.
//   - source_tree: la orientación de origen (intención del diseño).
//   - image: captura del render actual (data URI webp/jpeg), opcional.
//
// Respuesta: SSE. Un evento por formato a medida que terminan (corren en
// paralelo, hasta FIX_CONCURRENCY a la vez):
//   { type: "item", adaptation_id, ok, tree?, patches?, rationale?,
//     issues_before, issues_after?, passes, duration_ms, error? }
//   { type: "done", invocation_id, usage, duration_ms }
//
// Por formato: lint → Gemini → aplicar correcciones → lint de nuevo; si
// siguen quedando errores, una segunda pasada con los problemas restantes.
// El lote cuenta como UNA invocación para el rate limiting y queda en
// production_ai_invocations con tokens, costo y latencia sumados.
//
// IMPORTANTE: no persiste nada. El cliente muestra antes/después y guarda
// como manual_layout (PATCH de la adaptación) solo lo que el productor acepte.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import { TemplateDefinition } from "@/lib/production/types";
import { EMPTY_KIT_CONTENT, resolveTreeTokens, resolveColor, BrandKitContent } from "@/lib/production/brand-kit";
import { resolveTemplateBrandKit } from "@/lib/production/project-brand-kit";
import { adaptationSafeZone, type SafeZone } from "@/lib/production/safe-zone";
import { checkProductionAiQuota, quotaBlockedBody } from "@/lib/production/ai-rate-limit";
import { LintIssue } from "@/lib/production/layout-lint";
import { LayerPatch } from "@/lib/production/layout-patch";
import { DataRow, substituteVariables } from "@/lib/production/variables";
import {
  runLayoutFix,
  sumUsage,
  ZERO_USAGE,
  LayoutFixUsage,
  LAYOUT_FIXER_MODEL,
  LAYOUT_FIXER_AGENT_NAME,
} from "@/lib/production/layout-fixer";

export const maxDuration = 300;

const FIX_CONCURRENCY = 4;
const MAX_PASSES = 2;
const HEARTBEAT_MS = 15_000;

const bodySchema = z.object({
  items: z
    .array(
      z.object({
        adaptation_id: z.number().int().positive(),
        tree: z.unknown(),
        source_tree: z.unknown().optional(),
        image: z.string().max(4_000_000).optional(),
      }),
    )
    .min(1)
    .max(24),
  instructions: z.string().max(1000).optional(),
  // Fila activa del dataset: lint y modelo miden los textos con valores
  // reales. Las correcciones se aplican sobre el árbol con {{var}}.
  data_row: z.record(z.string(), z.union([z.string(), z.number(), z.null()])).optional(),
});

interface DesignRow extends RowDataPacket {
  id: number;
  production_project_id: number;
  client_id: number;
}
interface AdaptationRow extends RowDataPacket {
  id: number;
  width: number;
  height: number;
  preset_channel: string | null;
  preset_safe_zone: unknown;
}
interface PrincipalRow extends RowDataPacket {
  id: number;
  brand_kit_id: number | null;
}

// Chequeo liviano de forma: el árbol de entrada TIENE problemas (por eso se
// manda), así que no pasa validateTemplateDefinition (que exige que cada
// capa quepa en su padre). Solo verificamos que sea un root frame del
// tamaño de la adaptación.
function asRootTree(raw: unknown, size?: { w: number; h: number }): TemplateDefinition | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as Partial<TemplateDefinition>;
  if (t.type !== "frame" || !Array.isArray(t.children) || !t.size || !t.layout) return null;
  if (size && (Math.round(t.size.w) !== size.w || Math.round(t.size.h) !== size.h)) return null;
  return t as TemplateDefinition;
}

interface ItemResult {
  type: "item";
  adaptation_id: number;
  ok: boolean;
  tree?: TemplateDefinition;
  patches?: LayerPatch[];
  rationale?: string;
  issues_before: LintIssue[];
  issues_after?: LintIssue[];
  passes: number;
  duration_ms: number;
  error?: string;
}

async function fixOne(params: {
  adaptationId: number;
  tree: TemplateDefinition;
  sourceTree: TemplateDefinition | null;
  image?: string;
  kit: BrandKitContent;
  dataRow: DataRow | null;
  instructions?: string;
  safe: SafeZone | null;
  signal: AbortSignal;
  onUsage: (u: LayoutFixUsage) => void;
}): Promise<ItemResult> {
  const startedAt = Date.now();
  const { kit, dataRow } = params;
  // Lo que "se ve": variables sustituidas y tokens resueltos.
  const view = (t: TemplateDefinition) =>
    resolveTreeTokens(dataRow ? substituteVariables(t, dataRow) : t, kit);
  try {
    const res = await runLayoutFix({
      tree: params.tree,
      sourceTree: params.sourceTree,
      view,
      safe: params.safe,
      image: params.image ? { mimeType: "image/webp", data: params.image } : null,
      instructions: params.instructions,
      abortSignal: params.signal,
      maxPasses: MAX_PASSES,
      onUsage: params.onUsage,
      resolveColor: (c) => resolveColor(c, kit, c),
    });
    return {
      type: "item",
      adaptation_id: params.adaptationId,
      ok: true,
      tree: res.tree,
      patches: res.patches,
      rationale: res.rationale,
      issues_before: res.issuesBefore,
      issues_after: res.issuesAfter,
      passes: res.passes,
      duration_ms: Date.now() - startedAt,
    };
  } catch (e) {
    const err = e as Error & { passes?: number; issuesBefore?: LintIssue[] };
    return {
      type: "item",
      adaptation_id: params.adaptationId,
      ok: false,
      issues_before: err.issuesBefore ?? [],
      passes: err.passes ?? 0,
      duration_ms: Date.now() - startedAt,
      error: err.message,
    };
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const userId = Number(session.user.id);
    const { id: rawId } = await params;
    const designId = Number(rawId);
    if (!Number.isFinite(designId)) {
      return NextResponse.json({ error: "Design inválido" }, { status: 400 });
    }

    const parsed = await parseBody(request, bodySchema);
    if (parsed.error) return parsed.error;
    const { items, instructions } = parsed.data;
    const dataRow: DataRow | null = parsed.data.data_row ?? null;

    const [designRows] = await pool.execute<DesignRow[]>(
      `SELECT d.id, d.production_project_id, p.client_id
         FROM production_designs d
         JOIN production_projects p ON p.id = d.production_project_id
        WHERE d.id = ? AND d.deleted_at IS NULL`,
      [designId],
    );
    if (designRows.length === 0) {
      return NextResponse.json({ error: "Design no encontrado" }, { status: 404 });
    }
    const design = designRows[0];

    const ids = [...new Set(items.map((i) => i.adaptation_id))];
    const [adaptRows] = await pool.query<AdaptationRow[]>(
      `SELECT a.id, a.width, a.height, fp.channel AS preset_channel, fp.safe_zone_json AS preset_safe_zone
         FROM production_template_adaptations a
         LEFT JOIN production_format_presets fp ON fp.id = a.format_preset_id
        WHERE a.design_id = ? AND a.id IN (?)`,
      [designId, ids],
    );
    const adaptById = new Map(adaptRows.map((a) => [a.id, a]));
    const missing = ids.filter((id) => !adaptById.has(id));
    if (missing.length > 0) {
      return NextResponse.json(
        { error: `Adaptaciones fuera de este design: ${missing.join(", ")}` },
        { status: 400 },
      );
    }

    const prepared: {
      adaptationId: number;
      tree: TemplateDefinition;
      sourceTree: TemplateDefinition | null;
      image?: string;
      safe: SafeZone | null;
    }[] = [];
    for (const item of items) {
      const a = adaptById.get(item.adaptation_id)!;
      const tree = asRootTree(item.tree, { w: a.width, h: a.height });
      if (!tree) {
        return NextResponse.json(
          { error: `Árbol inválido para la adaptación ${a.id} (${a.width}×${a.height})` },
          { status: 400 },
        );
      }
      prepared.push({
        safe: adaptationSafeZone(a),
        adaptationId: a.id,
        tree,
        sourceTree: asRootTree(item.source_tree),
        image: item.image,
      });
    }

    const quota = await checkProductionAiQuota({
      projectId: design.production_project_id,
      userId,
    });
    if (!quota.ok) {
      return NextResponse.json(quotaBlockedBody(quota), { status: 429 });
    }

    // Brand kit efectivo del principal del design (mismo resolver que el
    // editor): el lint necesita los tamaños de letra resueltos.
    const [principalRows] = await pool.execute<PrincipalRow[]>(
      `SELECT id, brand_kit_id FROM production_templates
        WHERE design_id = ? AND linked_to_template_id IS NULL AND deleted_at IS NULL
        ORDER BY id ASC LIMIT 1`,
      [designId],
    );
    const principal = principalRows[0] ?? null;
    const resolvedKit = await resolveTemplateBrandKit({
      brandKitId: principal?.brand_kit_id ?? null,
      clientId: design.client_id,
      productionProjectId: design.production_project_id,
    });
    const kit = resolvedKit?.content ?? EMPTY_KIT_CONTENT;

    const encoder = new TextEncoder();
    const signal = request.signal;
    const startedAt = Date.now();

    const stream = new ReadableStream({
      async start(controller) {
        let closed = false;
        const send = (ev: unknown) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
          } catch {
            closed = true;
          }
        };
        const heartbeat = setInterval(() => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(": ping\n\n"));
          } catch {
            closed = true;
          }
        }, HEARTBEAT_MS);

        let usage = ZERO_USAGE;
        const results: ItemResult[] = [];
        let next = 0;
        const worker = async () => {
          while (next < prepared.length && !signal.aborted) {
            const p = prepared[next++];
            send({ type: "start", adaptation_id: p.adaptationId });
            const res = await fixOne({
              ...p,
              kit,
              dataRow,
              instructions,
              signal,
              onUsage: (u) => {
                usage = sumUsage(usage, u);
              },
            });
            results.push(res);
            send(res);
          }
        };

        try {
          await Promise.all(
            Array.from({ length: Math.min(FIX_CONCURRENCY, prepared.length) }, worker),
          );
        } finally {
          clearInterval(heartbeat);
          const durationMs = Date.now() - startedAt;
          const failed = results.filter((r) => !r.ok);
          const sizeOf = (id: number) => {
            const a = adaptById.get(id);
            return a ? `${a.width}×${a.height}` : `#${id}`;
          };
          let invocationId: number | null = null;
          try {
            const [inv] = await pool.execute<ResultSetHeader>(
              `INSERT INTO production_ai_invocations
                 (production_project_id, template_id, target_template_id, operation,
                  agent_name, model, input_tokens, output_tokens, estimated_cost, duration_ms,
                  success, error_msg, conversation_id, rationale, created_by)
               VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
              [
                design.production_project_id,
                principal?.id ?? null,
                "FIX_ADAPTATIONS",
                LAYOUT_FIXER_AGENT_NAME,
                LAYOUT_FIXER_MODEL,
                usage.inputTokens,
                usage.outputTokens,
                usage.estimatedCost,
                durationMs,
                results.some((r) => r.ok) ? 1 : 0,
                failed.length > 0
                  ? failed.map((r) => `${sizeOf(r.adaptation_id)}: ${r.error}`).join("\n").slice(0, 4000)
                  : signal.aborted
                    ? "Cancelado por el cliente"
                    : null,
                results
                  .filter((r) => r.ok && r.rationale)
                  .map((r) => `${sizeOf(r.adaptation_id)}: ${r.rationale}`)
                  .join("\n")
                  .slice(0, 8000) || null,
                userId,
              ],
            );
            invocationId = inv.insertId;
          } catch (e) {
            console.error("[fix-adaptations] no se pudo registrar la invocación:", e);
          }
          send({ type: "done", invocation_id: invocationId, usage, duration_ms: durationMs });
          closed = true;
          try {
            controller.close();
          } catch {
            // el cliente ya cerró
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("Error en fix-adaptations:", error);
    return NextResponse.json(
      { error: `Error interno: ${(error as Error).message}` },
      { status: 500 },
    );
  }
}
