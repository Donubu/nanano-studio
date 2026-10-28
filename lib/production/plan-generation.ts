// Flujo compartido de "Crear desde texto" y "Crear desde referencia":
// planificador (Gemini) → expandPlan por propuesta → registro en
// production_ai_invocations. Las rutas solo validan el body, chequean
// permisos/tope y arman las referencias.
//
// Contrato de respuesta (compatible con el picker anterior):
//   proposal   — la primera propuesta { definition, variants }
//   proposals  — todas, con template_id, rationale, image_prompts y un
//                `preview` con tokens resueltos para dibujarla sin brand kit
//   rationale, tokenUsage, invocation_id, brand_kit_id

import pool from "@/lib/db";
import { ResultSetHeader } from "mysql2";
import { BrandKitContent, resolveTreeTokens } from "./brand-kit";
import { expandPlan, LayoutPlan } from "./layout-plan";
import { requestLayoutPlans, LAYOUT_PLANNER_AGENT_NAME, LAYOUT_PLANNER_MODEL } from "./layout-planner";
import { LayoutFixUsage } from "./layout-fixer";

export const DEFAULT_MASTER_DIMS = { w: 1920, h: 1080 };
export const DEFAULT_VARIANT_DIMS = [
  { w: 1080, h: 1080 },
  { w: 1080, h: 1920 },
];

export interface PlanGenerationParams {
  operation: "GENERATE_FROM_PROMPT" | "GENERATE_FROM_REFERENCE";
  productionProjectId: number;
  userId: number;
  brandKit: BrandKitContent;
  brandKitId: number | null;
  intent?: string;
  tone?: string;
  instructions?: string;
  images?: { mimeType: string; data: string }[];
  masterDims?: { w: number; h: number };
  variantDims?: { w: number; h: number }[];
}

export async function generateFromPlans(
  p: PlanGenerationParams,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const masterDims = p.masterDims ?? DEFAULT_MASTER_DIMS;
  const variantDims = p.variantDims ?? DEFAULT_VARIANT_DIMS;
  const startedAt = Date.now();

  let plans: LayoutPlan[] = [];
  let usage: LayoutFixUsage | undefined;
  let error: string | null = null;
  try {
    const res = await requestLayoutPlans({
      intent: p.intent,
      tone: p.tone,
      instructions: p.instructions,
      brandKit: p.brandKit,
      images: p.images,
    });
    plans = res.plans;
    usage = res.usage;
  } catch (e) {
    error = (e as Error).message;
    usage = (e as { usage?: LayoutFixUsage }).usage;
  }

  const proposals = plans
    .map((plan) => {
      const expanded = expandPlan(plan, masterDims, variantDims);
      if (!expanded) return null;
      return {
        template_id: plan.template_id,
        rationale: plan.rationale,
        image_prompts: plan.image_prompts,
        definition: expanded.definition,
        variants: expanded.variants,
        preview: resolveTreeTokens(expanded.definition, p.brandKit),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  if (!error && proposals.length === 0) error = "Ninguna propuesta se pudo armar";

  const [inv] = await pool.execute<ResultSetHeader>(
    `INSERT INTO production_ai_invocations
       (production_project_id, template_id, target_template_id, operation,
        agent_name, model, input_tokens, output_tokens, estimated_cost, duration_ms,
        success, error_msg, conversation_id, rationale, created_by)
     VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
    [
      p.productionProjectId,
      p.operation,
      LAYOUT_PLANNER_AGENT_NAME,
      LAYOUT_PLANNER_MODEL,
      usage?.inputTokens ?? null,
      usage?.outputTokens ?? null,
      usage?.estimatedCost ?? null,
      Date.now() - startedAt,
      error ? 0 : 1,
      error,
      proposals.length > 0
        ? proposals.map((x) => `${x.template_id}: ${x.rationale}`).join("\n").slice(0, 8000)
        : null,
      p.userId,
    ],
  );

  const tokenUsage = usage ?? null;
  if (error) {
    return { status: 502, body: { error, invocation_id: inv.insertId, tokenUsage } };
  }
  return {
    status: 200,
    body: {
      proposal: { definition: proposals[0].definition, variants: proposals[0].variants },
      proposals,
      rationale: proposals[0].rationale,
      tokenUsage,
      invocation_id: inv.insertId,
      brand_kit_id: p.brandKitId,
    },
  };
}
