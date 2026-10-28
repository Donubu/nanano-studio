// Planificador de banners con Gemini (llamada directa, sin practicante).
//
// Reemplaza a GENERATE_FROM_PROMPT / GENERATE_FROM_REFERENCE del Banner
// Designer: en vez de escribir el árbol completo (3k–11k tokens), el modelo
// elige plantillas del catálogo y devuelve planes chicos (layout-plan.ts)
// que el motor expande a master + orientaciones. Las referencias visuales
// van como imagen nativa al modelo (sin la ida y vuelta de analyze_media).
//
// Server-only: usa el cliente de Gemini de lib/google-ai.ts.

import { ThinkingLevel, type Part } from "@google/genai";
import { getClient, withRetry } from "@/lib/google-ai";
import { BrandKitContent, makeRef } from "./brand-kit";
import { describeCatalog, sanitizePlan, LayoutPlan } from "./layout-plan";
import { LAYOUT_TEMPLATES } from "./layout-templates";
import { LAYOUT_FIXER_MODEL, LayoutFixUsage } from "./layout-fixer";

export const LAYOUT_PLANNER_MODEL = process.env.PRODUCTION_AI_PLANNER_MODEL || LAYOUT_FIXER_MODEL;
export const LAYOUT_PLANNER_AGENT_NAME = "layout-planner";

const PRICING: Record<string, { input: number; output: number }> = {
  "gemini-3.8-flash": { input: 0.75, output: 3.75 },
};
const FALLBACK_PRICING = PRICING["gemini-3.8-flash"];

const SYSTEM_INSTRUCTION = `Eres director de arte de una agencia de publicidad chilena. Diseñas banners eligiendo una plantilla de un catálogo y completándola: no dibujas capas, decides contenido, jerarquía y color.

Recibes:
- "brief": qué debe comunicar la pieza, tono e instrucciones del productor.
- "catalog": las plantillas disponibles. Cada una trae sus slots de texto (id, nombre, placeholder y max_chars aproximado que cabe), sus slots de imagen y los colores que usa.
- "brand": colores y fuentes de la marca, como tokens. Puede venir vacío.
- Opcionalmente, imágenes de referencia: úsalas para elegir la plantilla cuya composición más se parezca, y para sacar paleta, tono y copy.

Devuelve "proposals": entre 1 y 3 propuestas, cada una con una plantilla DISTINTA (salvo que el brief pida algo muy específico). Ordénalas de mejor a peor.

Por propuesta:
- template_id: id exacto del catálogo.
- texts: contenido para cada slot de texto que uses, en español de Chile (tuteo), corto y publicitario. Topes duros: max_chars en total y line_chars para la palabra más larga (una palabra más larga se corta feo; usa sinónimos o abreviaturas como "DCTO"). Precios en formato chileno ($9.990). CTA de 1 a 3 palabras.
- hidden: ids de slots que sobran para este brief (por ejemplo un badge de descuento si no hay descuento). Nunca ocultes el titular.
- colors: para cada color de la plantilla que quieras cambiar, {from: color de la plantilla, to: nuevo}. Si la marca tiene colores, usa sus tokens exactos (ej. "{color.primary}"); si no, hex. Cuida el contraste del texto sobre su fondo.
- heading_font / body_font: token de fuente de la marca si existe (ej. "{font.heading}"); si no, omítelos.
- image_prompts: para cada slot de imagen, un prompt EN INGLÉS para un generador de imágenes: sujeto, encuadre, luz y estilo, sin texto ni logos dentro de la imagen. Si el slot es full_bleed, pide espacio negativo donde va el texto.
- rationale: una frase en español de Chile explicando por qué esa plantilla y ese enfoque.`;

function responseSchema() {
  return {
    type: "object",
    properties: {
      proposals: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            template_id: { type: "string", enum: LAYOUT_TEMPLATES.map((t) => t.id) },
            texts: {
              type: "array",
              items: {
                type: "object",
                properties: { id: { type: "string" }, content: { type: "string" } },
                required: ["id", "content"],
              },
            },
            hidden: { type: "array", items: { type: "string" } },
            colors: {
              type: "array",
              items: {
                type: "object",
                properties: { from: { type: "string" }, to: { type: "string" } },
                required: ["from", "to"],
              },
            },
            heading_font: { type: "string" },
            body_font: { type: "string" },
            image_prompts: {
              type: "array",
              items: {
                type: "object",
                properties: { id: { type: "string" }, prompt: { type: "string" } },
                required: ["id", "prompt"],
              },
            },
            rationale: { type: "string" },
          },
          required: ["template_id", "texts", "rationale"],
        },
      },
    },
    required: ["proposals"],
  };
}

function brandForModel(kit: BrandKitContent) {
  return {
    colors: kit.colors.map((c) => ({ token: makeRef("color", c.name), label: c.label, value: c.value })),
    fonts: kit.fonts.map((f) => ({ token: makeRef("font", f.name), label: f.label, family: f.fontFamily })),
    ...(kit.rulesText?.trim() ? { rules: kit.rulesText.trim().slice(0, 2000) } : {}),
  };
}

export interface PlanRequest {
  intent?: string;
  tone?: string;
  instructions?: string;
  brandKit: BrandKitContent;
  // Referencias ya descargadas (base64 sin prefijo).
  images?: { mimeType: string; data: string }[];
  count?: number;
}

export interface PlanResponse {
  plans: LayoutPlan[];
  usage: LayoutFixUsage;
  model: string;
}

export async function requestLayoutPlans(req: PlanRequest): Promise<PlanResponse> {
  const context = {
    brief: {
      ...(req.intent?.trim() ? { intent: req.intent.trim() } : {}),
      ...(req.tone?.trim() ? { tone: req.tone.trim() } : {}),
      ...(req.instructions?.trim() ? { instructions: req.instructions.trim() } : {}),
      proposals_wanted: req.count ?? 3,
      ...(req.images?.length ? { reference_images: req.images.length } : {}),
    },
    catalog: describeCatalog(),
    brand: brandForModel(req.brandKit),
  };

  const parts: Part[] = (req.images ?? []).map((img) => ({
    inlineData: { mimeType: img.mimeType, data: img.data },
  }));
  parts.push({ text: JSON.stringify(context) });

  const model = LAYOUT_PLANNER_MODEL;
  const response = await withRetry(
    () =>
      getClient("gemini").models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseJsonSchema: responseSchema(),
          temperature: 0.8,
          maxOutputTokens: 8192,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      }),
    "productionLayoutPlan",
  );

  const um = response.usageMetadata;
  const inputTokens = um?.promptTokenCount ?? 0;
  const outputTokens = (um?.candidatesTokenCount ?? 0) + (um?.thoughtsTokenCount ?? 0);
  const p = PRICING[model] ?? FALLBACK_PRICING;
  const usage: LayoutFixUsage = {
    inputTokens,
    outputTokens,
    estimatedCost: (inputTokens * p.input + outputTokens * p.output) / 1_000_000,
  };

  const text = response.text ?? "";
  if (!text.trim()) {
    const reason =
      response.promptFeedback?.blockReason ?? response.candidates?.[0]?.finishReason ?? "sin texto";
    throw Object.assign(new Error(`Gemini no devolvió propuestas (${reason})`), { usage });
  }
  let parsed: { proposals?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw Object.assign(new Error(`JSON inválido de Gemini: ${(e as Error).message}`), { usage });
  }
  const plans = (Array.isArray(parsed.proposals) ? parsed.proposals : [])
    .map(sanitizePlan)
    .filter((x): x is LayoutPlan => x !== null);
  if (plans.length === 0) {
    throw Object.assign(new Error("Gemini no devolvió ninguna propuesta válida"), { usage });
  }
  return { plans, usage, model };
}
