// Endpoint: "Animar con IA". Gemini directo, sin practicante: el modelo
// devuelve una coreografía por capa (entrada, inicio, duración, énfasis;
// lib/production/animation-plan.ts) y el motor la traduce a tracks.
//
// URL: /api/production/templates/[id]/ai/animate
//   - [id] = id del template a animar (master o variante linked).
//   - Body: { intent: string, complexity?, durationHintMs?, instructions? }
//
// Devuelve { animation, rationale, tokenUsage, invocation_id }.
//
// IMPORTANTE: NO escribe la animation al template. El cliente muestra
// preview/aplica directamente y persiste con el PUT estándar al template.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, ResultSetHeader } from "mysql2";
import { z } from "zod";
import { parseBody } from "@/lib/api-utils";
import { TemplateDefinition } from "@/lib/production/types";
import { EMPTY_KIT_CONTENT } from "@/lib/production/brand-kit";
import { resolveTemplateBrandKit } from "@/lib/production/project-brand-kit";
import { checkProductionAiQuota, quotaBlockedBody } from "@/lib/production/ai-rate-limit";
import { resolveTreeTokens } from "@/lib/production/brand-kit";
import { validateAnimationConfig } from "@/lib/production/template-schema";
import { buildAnimationFromPlan } from "@/lib/production/animation-plan";
import {
  requestAnimationPlan,
  ANIMATION_PLANNER_AGENT_NAME,
  ANIMATION_PLANNER_MODEL,
} from "@/lib/production/animation-planner";
import type { LayoutFixUsage } from "@/lib/production/layout-fixer";
import type { AnimationConfig } from "@/lib/production/animation";
import type { TemplateLayer } from "@/lib/production/types";

interface TemplateRow extends RowDataPacket {
  id: number;
  production_project_id: number;
  design_id: number | null;
  base_width: number;
  base_height: number;
  definition_json: string;
  brand_kit_id: number | null;
}

interface ProjectRow extends RowDataPacket {
  client_id: number;
}

const bodySchema = z.object({
  intent: z.string().min(1).max(1000),
  complexity: z.enum(["subtle", "balanced", "energetic"]).optional(),
  durationHintMs: z.number().int().min(300).max(60000).optional(),
  instructions: z.string().max(2000).optional(),
});

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user || session.user.role !== "admin") {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }
    const { id: rawId } = await params;
    const templateId = Number(rawId);
    if (!Number.isFinite(templateId)) {
      return NextResponse.json({ error: "Template inválido" }, { status: 400 });
    }

    const parsed = await parseBody(request, bodySchema);
    if (parsed.error) return parsed.error;
    const { intent, complexity, durationHintMs, instructions } = parsed.data;

    // 1. Template
    const [tplRows] = await pool.execute<TemplateRow[]>(
      `SELECT id, production_project_id, design_id, base_width, base_height, definition_json, brand_kit_id
         FROM production_templates
        WHERE id = ? AND deleted_at IS NULL`,
      [templateId],
    );
    if (tplRows.length === 0) {
      return NextResponse.json(
        { error: "Template no encontrado" },
        { status: 404 },
      );
    }
    const tpl = tplRows[0];
    let definition: TemplateDefinition;
    try {
      definition = JSON.parse(tpl.definition_json) as TemplateDefinition;
    } catch {
      return NextResponse.json(
        { error: "Template tiene definition_json corrupto" },
        { status: 500 },
      );
    }

    // 2. Tope de uso + brand kit efectivo del template.
    const quota = await checkProductionAiQuota({
      projectId: tpl.production_project_id,
      userId: Number(session.user.id),
    });
    if (!quota.ok) {
      return NextResponse.json(quotaBlockedBody(quota), { status: 429 });
    }
    const [projRows] = await pool.execute<ProjectRow[]>(
      "SELECT client_id FROM production_projects WHERE id = ?",
      [tpl.production_project_id],
    );
    const resolvedKit =
      projRows.length > 0
        ? await resolveTemplateBrandKit({
            brandKitId: tpl.brand_kit_id,
            clientId: projRows[0].client_id,
            productionProjectId: tpl.production_project_id,
          })
        : null;
    const mergedKit = resolvedKit?.content ?? EMPTY_KIT_CONTENT;

    // 3. Coreografía (Gemini) → tracks (motor) → validación de schema.
    const startedAt = Date.now();
    let usage: LayoutFixUsage | null = null;
    let result:
      | { ok: true; animation: AnimationConfig; rationale: string }
      | { ok: false; error: string };
    try {
      const res = await requestAnimationPlan({
        resolvedTree: resolveTreeTokens(definition, mergedKit),
        intent,
        complexity: complexity ?? "balanced",
        durationHintMs,
        instructions,
      });
      usage = res.usage;
      const animation = buildAnimationFromPlan(definition, res.plan);
      const known = new Set<string>(["tpl_root"]);
      const walk = (nodes: TemplateLayer[]) =>
        nodes.forEach((n) => {
          known.add(n.id);
          if (n.type === "frame") walk(n.children);
        });
      walk(definition.children);
      const v = validateAnimationConfig(animation, known);
      result = v.ok
        ? { ok: true, animation: v.animation, rationale: res.plan.rationale }
        : { ok: false, error: v.error };
    } catch (e) {
      usage = (e as { usage?: LayoutFixUsage }).usage ?? null;
      result = { ok: false, error: (e as Error).message };
    }

    // 4. Registrar invocación (pase lo que pase, para auditoría de costo).
    const [inv] = await pool.execute<ResultSetHeader>(
      `INSERT INTO production_ai_invocations
         (production_project_id, template_id, target_template_id, operation,
          agent_name, model, input_tokens, output_tokens, estimated_cost, duration_ms,
          success, error_msg, conversation_id, rationale, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
      [
        tpl.production_project_id,
        tpl.id,
        tpl.id, // no hay distinción master/target acá; el target ES el template
        "ANIMATE_TEMPLATE",
        ANIMATION_PLANNER_AGENT_NAME,
        ANIMATION_PLANNER_MODEL,
        usage?.inputTokens ?? null,
        usage?.outputTokens ?? null,
        usage?.estimatedCost ?? null,
        Date.now() - startedAt,
        result.ok ? 1 : 0,
        result.ok ? null : result.error,
        result.ok ? result.rationale : null,
        Number(session.user.id),
      ],
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, invocation_id: inv.insertId, tokenUsage: usage },
        { status: 502 },
      );
    }

    return NextResponse.json({
      animation: result.animation,
      rationale: result.rationale,
      tokenUsage: usage,
      invocation_id: inv.insertId,
    });
  } catch (error) {
    console.error("Error en ai/animate:", error);
    return NextResponse.json(
      { error: `Error interno: ${(error as Error).message}` },
      { status: 500 },
    );
  }
}
