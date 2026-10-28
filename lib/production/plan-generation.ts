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
import { ResultSetHeader, RowDataPacket } from "mysql2";
import { BrandGuide } from "./brand-guide";
import { BrandKitContent, resolveTreeTokens, resolveColor } from "./brand-kit";
import { expandPlan, ensureTextContrast, LayoutPlan } from "./layout-plan";
import { requestLayoutPlans, LAYOUT_PLANNER_AGENT_NAME, LAYOUT_PLANNER_MODEL } from "./layout-planner";
import { LayoutFixUsage } from "./layout-fixer";
import { topPieceImages } from "./brand-pieces";
import { resolveBrandLogo } from "./project-brand-kit";
import { requestReferenceLayout } from "./reference-planner";
import { buildReferenceDefinition, type ReferenceLayout } from "./reference-layout";
import { adaptTree } from "./adapt";

export const DEFAULT_MASTER_DIMS = { w: 1920, h: 1080 };
export const DEFAULT_VARIANT_DIMS = [
  { w: 1080, h: 1080 },
  { w: 1080, h: 1920 },
];

// Guía de marca sincronizada desde practicante (null si el cliente no tiene).
export async function loadClientBrandGuide(clientId: number): Promise<BrandGuide | null> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    "SELECT brand_guide_json FROM clients WHERE id = ?",
    [clientId],
  );
  const raw = rows[0]?.brand_guide_json;
  if (raw == null) return null;
  try {
    return (typeof raw === "string" ? JSON.parse(raw) : raw) as BrandGuide;
  } catch {
    return null;
  }
}

export interface PlanGenerationParams {
  operation: "GENERATE_FROM_PROMPT" | "GENERATE_FROM_REFERENCE";
  productionProjectId: number;
  clientId: number;
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
  const fromReference = p.operation === "GENERATE_FROM_REFERENCE" && (p.images?.length ?? 0) > 0;
  let referenceLayout: ReferenceLayout | null = null;
  const addUsage = (u?: LayoutFixUsage) => {
    if (!u) return;
    usage = usage
      ? {
          inputTokens: usage.inputTokens + u.inputTokens,
          outputTokens: usage.outputTokens + u.outputTokens,
          estimatedCost: usage.estimatedCost + u.estimatedCost,
        }
      : u;
  };
  const brandGuide = await loadClientBrandGuide(p.clientId);
  // Con referencia: una propuesta "Fiel a la referencia" (bloques medidos
  // sobre la imagen) y 2 del catálogo como alternativas. Las piezas reales de
  // la marca no van en este modo: competían con la referencia y el modelo
  // terminaba copiando las piezas de la marca.
  const [catalog, reference] = await Promise.allSettled([
    requestLayoutPlans({
      brandGuide,
      brandPieces: fromReference ? [] : await topPieceImages(brandGuide),
      intent: p.intent,
      tone: p.tone,
      instructions: p.instructions,
      brandKit: p.brandKit,
      images: p.images,
      count: fromReference ? 2 : undefined,
    }),
    fromReference
      ? requestReferenceLayout({
          images: p.images!,
          intent: p.intent,
          instructions: p.instructions,
          brandKit: p.brandKit,
          brandGuide,
        })
      : Promise.resolve(null),
  ]);
  if (catalog.status === "fulfilled") {
    plans = catalog.value.plans;
    addUsage(catalog.value.usage);
  } else {
    error = (catalog.reason as Error).message;
    addUsage((catalog.reason as { usage?: LayoutFixUsage }).usage);
  }
  if (reference.status === "fulfilled" && reference.value) {
    referenceLayout = reference.value.layout;
    addUsage(reference.value.usage);
  } else if (reference.status === "rejected") {
    console.warn("[plan-generation] referencia sin bloques:", (reference.reason as Error).message);
    addUsage((reference.reason as { usage?: LayoutFixUsage }).usage);
  }
  if (referenceLayout) error = null;

  // La plantilla nueva se crea con brand_kit_id = p.brandKitId: token solo si hay kit.
  const logo =
    plans.length > 0 || referenceLayout
      ? await resolveBrandLogo(p.brandKit, p.clientId, { useToken: p.brandKitId != null })
      : null;
  const resolveC = (c: string) => resolveColor(c, p.brandKit, c);
  const referenceProposal = (() => {
    if (!referenceLayout) return null;
    const built = buildReferenceDefinition(referenceLayout, logo?.src ?? null);
    const fit = (dims: { w: number; h: number }) =>
      ensureTextContrast(
        built.definition.size.w === dims.w && built.definition.size.h === dims.h ? built.definition : adaptTree(built.definition, dims),
        resolveC,
      );
    // El master va en la proporción de la referencia (una referencia cuadrada
    // armada en 16:9 se ve estirada); las otras orientaciones salen de ahí.
    const refDims = built.definition.size;
    const sameAspect = (a: { w: number; h: number }) => Math.abs(a.w / a.h - refDims.w / refDims.h) < 0.05;
    const otherDims = [masterDims, ...variantDims].filter((d) => !sameAspect(d));
    const definition = fit(refDims);
    return {
      template_id: "reference",
      rationale: "Fiel a la referencia: misma composición, jerarquía y colores, con los textos y el logo de la marca.",
      image_prompts: built.imagePrompts,
      definition,
      variants: otherDims.map((dims) => ({ dims, definition: fit(dims) })),
      preview: resolveTreeTokens(definition, p.brandKit),
    };
  })();
  const catalogProposals = plans
    .map((plan) => {
      const raw = expandPlan(plan, masterDims, variantDims, logo?.src ?? null);
      if (!raw) return null;
      const resolve = (c: string) => resolveColor(c, p.brandKit, c);
      const expanded = {
        definition: ensureTextContrast(raw.definition, resolve),
        variants: raw.variants.map((v) => ({ ...v, definition: ensureTextContrast(v.definition, resolve) })),
      };
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
  const proposals = referenceProposal ? [referenceProposal, ...catalogProposals] : catalogProposals;
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
