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
import { BrandKitContent, resolveTreeTokens, resolveColor, makeRef } from "./brand-kit";
import sharp from "sharp";
import { uploadToS3 } from "@/lib/s3";
import { cleanPhotoOverlays, imageCostPerImage } from "./image-generator";
import { expandPlan, ensureTextContrast, ensureLogoVisible, logoColorsOf, nearestImageRatio, LayoutPlan } from "./layout-plan";
import { requestLayoutPlans, LAYOUT_PLANNER_AGENT_NAME, LAYOUT_PLANNER_MODEL } from "./layout-planner";
import { LayoutFixUsage, runLayoutFix } from "./layout-fixer";
import { lintLayout, hasLintErrors } from "./layout-lint";
import { topPieceImages } from "./brand-pieces";
import { resolveBrandLogo } from "./project-brand-kit";
import { requestReferenceLayout } from "./reference-planner";
import { buildReferenceDefinition, type ReferenceLayout } from "./reference-layout";
import { adaptTree } from "./adapt";
import type { TemplateDefinition } from "./types";

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
  // Con referencia: copia íntegra (mismos textos, fuentes, colores, fotos y
  // logo recortados de la referencia) en vez de adaptarla a la marca.
  integral?: boolean;
}

// Recorta de la referencia las cajas de fotos y logo (copia íntegra) y las
// sube al bucket. Devuelve la URL por índice de bloque.
// Las fotos que tienen textos, formas o el logo encima se limpian con el
// modelo de imágenes (si no, el texto original se ve doble bajo la capa).
async function cropReference(
  image: { mimeType: string; data: string },
  layout: ReferenceLayout,
  clientId: number,
): Promise<{ crops: Map<number, string>; cleaned: number }> {
  const buf = Buffer.from(image.data, "base64");
  const meta = await sharp(buf).metadata();
  const W = meta.width ?? 0;
  const H = meta.height ?? 0;
  const crops = new Map<number, string>();
  let cleaned = 0;
  if (!W || !H) return { crops, cleaned };
  const covers = (b: ReferenceLayout["blocks"][number], o: ReferenceLayout["blocks"][number]) =>
    o !== b &&
    o.role !== "image" &&
    o.x < b.x + b.w &&
    b.x < o.x + o.w &&
    o.y < b.y + b.h &&
    b.y < o.y + o.h;
  await Promise.all(
    layout.blocks.map(async (b, i) => {
      if (b.role !== "image" && b.role !== "logo") return;
      const left = Math.max(0, Math.round((b.x / 100) * W));
      const top = Math.max(0, Math.round((b.y / 100) * H));
      const width = Math.min(W - left, Math.round((b.w / 100) * W));
      const height = Math.min(H - top, Math.round((b.h / 100) * H));
      if (width < 4 || height < 4) return;
      try {
        const isLogo = b.role === "logo";
        const region = sharp(buf).extract({ left, top, width, height });
        let out = isLogo ? await region.png().toBuffer() : await region.jpeg({ quality: 88 }).toBuffer();
        if (!isLogo && layout.blocks.some((o) => covers(b, o))) {
          try {
            const clean = await cleanPhotoOverlays({ data: out, mimeType: "image/jpeg" }, nearestImageRatio(width, height));
            // Mismo tamaño que la caja: el modelo devuelve su propia proporción.
            out = await sharp(clean.data).resize(width, height, { fit: "cover" }).jpeg({ quality: 88 }).toBuffer();
            cleaned++;
          } catch (e) {
            console.warn("[plan-generation] no se pudo limpiar la foto:", (e as Error).message);
          }
        }
        const name = `ref_${Date.now()}_${i}_${Math.random().toString(36).slice(2, 7)}.${isLogo ? "png" : "jpg"}`;
        const up = await uploadToS3(out, name, isLogo ? "image/png" : "image/jpeg", `templates/${clientId}/ref`);
        crops.set(i, up.url);
      } catch (e) {
        console.warn("[plan-generation] recorte de referencia falló:", (e as Error).message);
      }
    }),
  );
  return { crops, cleaned };
}

// Fuentes de la marca para el armado desde referencia (tokens del kit).
function brandFonts(kit: BrandKitContent): { heading?: string; body?: string } | undefined {
  if (kit.fonts.length === 0) return undefined;
  const find = (re: RegExp) => kit.fonts.find((f) => re.test(f.name) || re.test(f.label));
  const heading = find(/head|t[ií]tul|display/i) ?? kit.fonts[0];
  const body = find(/body|texto|cuerpo|base/i) ?? kit.fonts[kit.fonts.length - 1];
  return { heading: makeRef("font", heading.name), body: makeRef("font", body.name) };
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
  const integral = fromReference && !!p.integral;
  const [catalog, reference] = await Promise.allSettled([
    // En copia íntegra no hay alternativas del catálogo: se pidió la misma pieza.
    integral
      ? Promise.resolve({ plans: [] as LayoutPlan[], usage: undefined as LayoutFixUsage | undefined })
      : requestLayoutPlans({
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
          integral,
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
  const logoColors = logoColorsOf(p.brandKit);
  const finish = (d: TemplateDefinition) => ensureLogoVisible(ensureTextContrast(d, resolveC), resolveC, logoColors);
  const referenceProposal = await (async () => {
    if (!referenceLayout) return null;
    let crops: Map<number, string> | undefined;
    if (integral) {
      const res = await cropReference(p.images![0], referenceLayout, p.clientId);
      crops = res.crops;
      if (res.cleaned > 0) {
        const perImage = await imageCostPerImage();
        addUsage({ inputTokens: 0, outputTokens: 0, estimatedCost: perImage * res.cleaned });
      }
    }
    const built = buildReferenceDefinition(referenceLayout, logo, {
      integral,
      crops,
      fonts: integral ? undefined : brandFonts(p.brandKit),
    });
    // El master va en la proporción de la referencia (una referencia cuadrada
    // armada en 16:9 se ve estirada); las otras orientaciones salen de ahí,
    // recompuestas con IA como "Adaptar con IA" (el reajuste solo deja
    // franjas vacías y textos sobre fondos donde no se leen).
    // En copia íntegra el logo es el recorte de la referencia (ya trae su
    // fondo): sin placa. El contraste sí se asegura.
    const finishRef = (d: TemplateDefinition) => (integral ? ensureTextContrast(d, resolveC) : finish(d));
    const definition = finishRef(built.definition);
    const refDims = definition.size;
    const sameAspect = (a: { w: number; h: number }) => Math.abs(a.w / a.h - refDims.w / refDims.h) < 0.05;
    const otherDims = [masterDims, ...variantDims].filter((d) => !sameAspect(d));
    const view = (t: TemplateDefinition) => resolveTreeTokens(t, p.brandKit);
    const variants = await Promise.all(
      otherDims.map(async (dims) => {
        // Misma estructura que el master (anclajes, paneles y grupos); la IA
        // solo corrige si el chequeo encuentra errores.
        const base = adaptTree(definition, dims);
        if (!hasLintErrors(lintLayout(view(base)))) return { dims, definition: finishRef(base) };
        try {
          const res = await runLayoutFix({
            tree: base,
            sourceTree: definition,
            view,
            image: p.images?.[0] ?? null,
            imageRole: "original",
            maxPasses: 1,
          });
          addUsage(res.usage);
          return { dims, definition: finishRef(res.tree) };
        } catch (e) {
          addUsage((e as { usage?: LayoutFixUsage }).usage);
          return { dims, definition: finishRef(base) };
        }
      }),
    );
    return {
      template_id: integral ? "reference-integral" : "reference",
      rationale: integral
        ? "Copia íntegra: la misma pieza en capas editables, con sus textos, fuentes, colores y fotos."
        : "Fiel a la referencia: misma composición, jerarquía, tipografía y colores, con los textos y el logo de la marca.",
      image_prompts: built.imagePrompts,
      definition,
      variants,
      preview: resolveTreeTokens(definition, p.brandKit),
    };
  })();
  const catalogProposals = plans
    .map((plan) => {
      const raw = expandPlan(plan, masterDims, variantDims, logo?.src ?? null);
      if (!raw) return null;
      const expanded = {
        definition: finish(raw.definition),
        variants: raw.variants.map((v) => ({ ...v, definition: finish(v.definition) })),
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
