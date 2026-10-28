// Corrector de adaptaciones con Gemini (llamada directa, sin practicante).
//
// Recibe una adaptación ya armada por el motor (adaptTree) junto con los
// problemas que detectó el lint y, opcionalmente, una captura del resultado.
// El modelo devuelve SOLO correcciones por capa (layout-patch.ts) en JSON
// con schema forzado: no reescribe el árbol, no puede inventar capas ni
// romper el formato del output. Una llamada por formato, ~1-2k tokens de
// entrada y unos cientos de salida.
//
// Server-only: usa el cliente de Gemini de lib/google-ai.ts.

import { ThinkingLevel, type Part } from "@google/genai";
import { getClient, withRetry } from "@/lib/google-ai";
import { TemplateDefinition, TemplateLayer } from "./types";
import { LintIssue, effectiveFontSize, isBackgroundLayer, isVisibleLayer, safeMargin } from "./layout-lint";
import { LayerPatch } from "./layout-patch";

export const LAYOUT_FIXER_MODEL =
  process.env.PRODUCTION_AI_LAYOUT_MODEL || "gemini-3.8-flash";
export const LAYOUT_FIXER_AGENT_NAME = "layout-fixer";

// USD por millón de tokens. Los tokens de razonamiento se cobran como salida.
const PRICING: Record<string, { input: number; output: number }> = {
  "gemini-3.8-flash": { input: 0.75, output: 3.75 },
};
const FALLBACK_PRICING = PRICING["gemini-3.8-flash"];

export interface LayoutFixUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

export interface LayoutFixRequest {
  // Árbol adaptado con tokens resueltos: es lo que el modelo "ve" en números.
  resolvedTree: TemplateDefinition;
  // Orientación de origen (resuelta) para conservar la intención del diseño.
  resolvedSource?: TemplateDefinition | null;
  issues: LintIssue[];
  // Captura del resultado actual (data URI o base64 + mime).
  image?: { mimeType: string; data: string } | null;
  instructions?: string;
  abortSignal?: AbortSignal;
}

export interface LayoutFixResponse {
  patches: LayerPatch[];
  rationale: string;
  usage: LayoutFixUsage;
  model: string;
}

const SYSTEM_INSTRUCTION = `Eres un diseñador senior de banners publicitarios. Recibes una pieza que un motor automático adaptó a un formato nuevo desde un diseño original, y la lista de problemas que detectó un chequeo automático. Tu trabajo es corregir la composición con cambios mínimos por capa.

Cómo leer el input:
- Coordenadas en px, origen arriba a la izquierda. x,y es la esquina superior izquierda de la caja; w,h su tamaño.
- "background: true" marca fondos a pantalla completa: no los muevas.
- "original" es la misma pieza en su formato de origen: respeta su jerarquía (qué es titular, qué es CTA, qué es logo) y el orden de lectura.
- Si viene una imagen, es el render actual de la pieza adaptada.

Reglas:
1. Todo lo importante dentro del formato y del margen de seguridad indicado.
2. Ningún texto encima de otro texto ni de un ícono/logo.
3. El texto tiene que caber en su caja: agranda la caja o baja el fontSize. Ancho aproximado de un carácter = 0.55 × fontSize (0.66 en mayúsculas); alto de línea ≈ 1.2 × fontSize.
4. Tamaños legibles: mínimo 10px en formatos chicos (lado corto < 120px), 12px en el resto. El titular es siempre el texto más grande.
5. En formatos muy chicos o muy alargados puedes ocultar (hidden: true) elementos secundarios: bajadas, textos legales, decoraciones. Nunca ocultes el titular, el CTA, el precio ni el logo.
6. Formatos alargados (tiras): distribuye en fila (horizontal) o columna (vertical) siguiendo el orden de lectura del original.
7. Cambia solo lo necesario. No cambies textos ni colores. Si una capa está bien, no la incluyas.

Responde solo con el JSON pedido: "patches" (una entrada por capa a cambiar, con su id y solo los campos que cambian) y "rationale" (una frase en español de Chile, tuteo, que explique qué corregiste).`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    patches: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
          fontSize: { type: "number" },
          hidden: { type: "boolean" },
          align: { type: "string", enum: ["left", "center", "right"] },
        },
        required: ["id"],
      },
    },
    rationale: { type: "string" },
  },
  required: ["patches", "rationale"],
};

const r = (n: number) => Math.round(n);

function describeLayer(l: TemplateLayer, frame: { w: number; h: number }): Record<string, unknown> {
  const base: Record<string, unknown> = {
    id: l.id,
    type: l.type,
    ...(l.name ? { name: l.name } : {}),
    x: r(l.position.x),
    y: r(l.position.y),
    w: r(l.size.w),
    h: r(l.size.h),
  };
  if (isBackgroundLayer(l, frame)) base.background = true;
  if (l.type === "text") {
    const content = l.content.replace(/\s+/g, " ").trim();
    base.text = content.length > 140 ? `${content.slice(0, 139)}…` : content;
    const fs = effectiveFontSize(l);
    if (fs != null) base.fontSize = r(fs);
    if (l.style.align) base.align = l.style.align;
    if (l.style.backgroundColor) base.button = true;
    if (l.style.textTransform === "uppercase") base.uppercase = true;
  }
  if (l.type === "frame") {
    base.children = l.children.filter(isVisibleLayer).map((c) => describeLayer(c, l.size));
  }
  return base;
}

export function describeTree(def: TemplateDefinition): Record<string, unknown> {
  return {
    size: { w: r(def.size.w), h: r(def.size.h) },
    layout: def.layout.mode,
    layers: def.children.filter(isVisibleLayer).map((l) => describeLayer(l, def.size)),
  };
}

function parseImage(image: LayoutFixRequest["image"]): Part | null {
  if (!image?.data) return null;
  const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(image.data);
  return {
    inlineData: {
      mimeType: m ? m[1] : image.mimeType,
      data: m ? m[2] : image.data,
    },
  };
}

function costOf(model: string, input: number, output: number): number {
  const p = PRICING[model] ?? FALLBACK_PRICING;
  return (input * p.input + output * p.output) / 1_000_000;
}

function sanitizePatches(raw: unknown): LayerPatch[] {
  if (!Array.isArray(raw)) return [];
  const out: LayerPatch[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const p = item as Record<string, unknown>;
    if (typeof p.id !== "string" || !p.id) continue;
    const patch: LayerPatch = { id: p.id };
    for (const k of ["x", "y", "w", "h", "fontSize"] as const) {
      if (typeof p[k] === "number" && Number.isFinite(p[k])) patch[k] = p[k] as number;
    }
    if (typeof p.hidden === "boolean") patch.hidden = p.hidden;
    if (p.align === "left" || p.align === "center" || p.align === "right") patch.align = p.align;
    out.push(patch);
  }
  return out;
}

export async function requestLayoutFix(req: LayoutFixRequest): Promise<LayoutFixResponse> {
  const { resolvedTree, resolvedSource, issues } = req;
  const context = {
    format: {
      w: r(resolvedTree.size.w),
      h: r(resolvedTree.size.h),
      safeMargin: safeMargin(resolvedTree.size),
    },
    problems: issues.map((i) => ({
      kind: i.kind,
      severity: i.severity,
      layers: i.layerIds,
      detail: i.detail,
    })),
    current: describeTree(resolvedTree),
    ...(resolvedSource ? { original: describeTree(resolvedSource) } : {}),
    ...(req.instructions?.trim() ? { instructions: req.instructions.trim() } : {}),
  };

  const parts: Part[] = [];
  const img = parseImage(req.image);
  if (img) parts.push(img);
  parts.push({ text: JSON.stringify(context) });

  const model = LAYOUT_FIXER_MODEL;
  const response = await withRetry(
    () =>
      getClient("gemini").models.generateContent({
        model,
        contents: [{ role: "user", parts }],
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseJsonSchema: RESPONSE_SCHEMA,
          temperature: 0.2,
          maxOutputTokens: 4096,
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
          abortSignal: req.abortSignal,
        },
      }),
    "productionLayoutFix",
    undefined,
    req.abortSignal,
  );

  const um = response.usageMetadata;
  const inputTokens = um?.promptTokenCount ?? 0;
  const outputTokens = (um?.candidatesTokenCount ?? 0) + (um?.thoughtsTokenCount ?? 0);
  const usage: LayoutFixUsage = {
    inputTokens,
    outputTokens,
    estimatedCost: costOf(model, inputTokens, outputTokens),
  };

  const text = response.text ?? "";
  if (!text.trim()) {
    const reason =
      response.promptFeedback?.blockReason ?? response.candidates?.[0]?.finishReason ?? "sin texto";
    throw Object.assign(new Error(`Gemini no devolvió correcciones (${reason})`), { usage });
  }
  let parsed: { patches?: unknown; rationale?: unknown };
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw Object.assign(new Error(`JSON inválido de Gemini: ${(e as Error).message}`), { usage });
  }
  return {
    patches: sanitizePatches(parsed.patches),
    rationale: typeof parsed.rationale === "string" ? parsed.rationale : "",
    usage,
    model,
  };
}

export function sumUsage(a: LayoutFixUsage, b: LayoutFixUsage): LayoutFixUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    estimatedCost: a.estimatedCost + b.estimatedCost,
  };
}

export const ZERO_USAGE: LayoutFixUsage = { inputTokens: 0, outputTokens: 0, estimatedCost: 0 };
