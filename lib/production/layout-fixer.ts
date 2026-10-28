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

import type { Part } from "@google/genai";
import { generateJson, GeminiUsage } from "./gemini-json";
import { TemplateDefinition, TemplateLayer } from "./types";
import {
  LintIssue,
  effectiveFontSize,
  isBackgroundLayer,
  isVisibleLayer,
  safeMargin,
  lintLayout,
  hasLintErrors,
} from "./layout-lint";
import { LayerPatch, applyLayerPatches } from "./layout-patch";
import { COMPOSITION_RULES } from "./art-direction";
import { ensureTextContrast } from "./layout-plan";
import { keepLayerAspect } from "./reflow";

export const LAYOUT_FIXER_MODEL =
  process.env.PRODUCTION_AI_LAYOUT_MODEL || "gemini-3.8-flash";
export const LAYOUT_FIXER_AGENT_NAME = "layout-fixer";

export type LayoutFixUsage = GeminiUsage;

export interface LayoutFixRequest {
  // Árbol adaptado con tokens resueltos: es lo que el modelo "ve" en números.
  resolvedTree: TemplateDefinition;
  // Orientación de origen (resuelta) para conservar la intención del diseño.
  resolvedSource?: TemplateDefinition | null;
  issues: LintIssue[];
  // Captura (data URI o base64 + mime). Por defecto es el render actual de
  // la pieza adaptada; con imageRole "original" es el diseño de origen.
  image?: { mimeType: string; data: string } | null;
  imageRole?: "current" | "original";
  // Cambio de orientación ("Adaptar con IA"): el modelo puede reubicar todo,
  // no solo corregir lo que marcó el lint.
  recompose?: boolean;
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
- Si viene una imagen: con "image_role": "original" es el diseño de origen; si no, es el render actual de la pieza adaptada.
- Con "task": "recompose" se trata de un cambio de orientación (ej. horizontal → vertical): el armado automático es solo un punto de partida y puedes mover y redimensionar TODAS las capas para lograr la mejor composición en el nuevo formato, conservando la jerarquía y el estilo del original. Ahí la regla 7 no aplica a la geometría.

Reglas:
1. Todo lo importante dentro del formato y del margen de seguridad indicado.
2. Ningún texto encima de otro texto ni de un ícono/logo.
3. El texto tiene que caber en su caja: agranda la caja o baja el fontSize. Ancho aproximado de un carácter = 0.55 × fontSize (0.66 en mayúsculas); alto de línea ≈ 1.2 × fontSize.
4. Tamaños legibles: mínimo 10px en formatos chicos (lado corto < 120px), 12px en el resto. El titular es siempre el texto más grande.
5. En formatos muy chicos o muy alargados puedes ocultar (hidden: true) elementos secundarios: bajadas, textos legales, decoraciones. Nunca ocultes el titular, el CTA, el precio ni el logo.
6. Formatos alargados (tiras): distribuye en fila (horizontal) o columna (vertical) siguiendo el orden de lectura del original.
7. Cambia solo lo necesario. No cambies textos ni colores. Si una capa está bien, no la incluyas. Si las instrucciones del productor piden cambiar colores, fondos o textos, no puedes hacerlo aquí: haz el resto y dilo al final del rationale ("para cambiar colores o textos usa «Pídele a la IA»").

En "recompose", además, compón con este criterio:
${COMPOSITION_RULES.map((r) => `- ${r}`).join("\n")}
- Aprovecha todo el formato: sin franjas vacías grandes (más de ~15% del alto o del ancho sin contenido). Si el formato nuevo es más alto, la imagen principal crece (en vertical, entre 45% y 60% del alto) y los bloques de texto, precio, CTA y logo crecen y se reparten en el resto; si es más ancho, la imagen ocupa un lado completo.
- Mantén los grupos del original juntos (cintillo + nombre arriba, precio + logo como un bloque) y sus proporciones (un logo cuadrado sigue cuadrado).

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
    ...(req.recompose ? { task: "recompose" } : {}),
    ...(req.image && req.imageRole === "original" ? { image_role: "original" } : {}),
    current: describeTree(resolvedTree),
    ...(resolvedSource ? { original: describeTree(resolvedSource) } : {}),
    ...(req.instructions?.trim() ? { instructions: req.instructions.trim() } : {}),
  };

  const parts: Part[] = [];
  const img = parseImage(req.image);
  if (img) parts.push(img);
  parts.push({ text: JSON.stringify(context) });

  const model = LAYOUT_FIXER_MODEL;
  const { data: parsed, usage } = await generateJson<{ patches?: unknown; rationale?: unknown }>({
    model,
    systemInstruction: SYSTEM_INSTRUCTION,
    schema: RESPONSE_SCHEMA,
    parts,
    temperature: 0.2,
    maxOutputTokens: 4096,
    operationName: "productionLayoutFix",
    abortSignal: req.abortSignal,
  });
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

// ---------------------------------------------------------------------------
// Ciclo completo: lint → Gemini → aplicar → lint, hasta `maxPasses`.
// Lo usan "Revisar con IA" (fix-adaptations) y "Adaptar con IA".
// ---------------------------------------------------------------------------

export interface RunLayoutFixParams {
  tree: TemplateDefinition;
  sourceTree: TemplateDefinition | null;
  // Lo que "se ve": tokens resueltos y, si aplica, variables sustituidas.
  view: (t: TemplateDefinition) => TemplateDefinition;
  image?: { mimeType: string; data: string } | null;
  imageRole?: "current" | "original";
  recompose?: boolean;
  instructions?: string;
  abortSignal?: AbortSignal;
  maxPasses?: number;
  onUsage?: (u: LayoutFixUsage) => void;
  // Resuelve tokens de color: si viene, al final se asegura el contraste de
  // los textos (al recomponer, un texto blanco que iba sobre la foto puede
  // quedar sobre el fondo blanco; el modelo no cambia colores).
  resolveColor?: (c: string) => string;
}

export interface RunLayoutFixResult {
  tree: TemplateDefinition;
  patches: LayerPatch[];
  rationale: string;
  issuesBefore: LintIssue[];
  issuesAfter: LintIssue[];
  passes: number;
  usage: LayoutFixUsage;
}

export async function runLayoutFix(p: RunLayoutFixParams): Promise<RunLayoutFixResult> {
  const resolvedSource = p.sourceTree ? p.view(p.sourceTree) : null;
  const issuesBefore = lintLayout(p.view(p.tree));
  const maxPasses = p.maxPasses ?? 2;
  let current = p.tree;
  let issues = issuesBefore;
  let usage = ZERO_USAGE;
  const patches: LayerPatch[] = [];
  const rationales: string[] = [];
  let passes = 0;
  const track = (u: LayoutFixUsage) => {
    usage = sumUsage(usage, u);
    p.onUsage?.(u);
  };
  try {
    while (passes < maxPasses) {
      passes++;
      const res = await requestLayoutFix({
        resolvedTree: p.view(current),
        resolvedSource,
        issues,
        // La imagen del render actual solo describe la primera pasada; la
        // del original sirve en todas.
        image: passes === 1 || p.imageRole === "original" ? p.image : null,
        imageRole: p.imageRole,
        // Recomponer solo en la primera pasada; la segunda corrige lo que quedó.
        recompose: p.recompose && passes === 1,
        instructions: p.instructions,
        abortSignal: p.abortSignal,
      });
      track(res.usage);
      if (res.rationale) rationales.push(res.rationale);
      if (res.patches.length === 0) break;
      current = applyLayerPatches(current, res.patches).definition;
      patches.push(...res.patches);
      issues = lintLayout(p.view(current));
      if (!hasLintErrors(issues)) break;
    }
  } catch (e) {
    const u = (e as { usage?: LayoutFixUsage }).usage;
    if (u) track(u);
    throw Object.assign(e as Error, { usage, passes, issuesBefore });
  }
  // El modelo cambia w y h por separado: lo que tiene proporción fija
  // (logos, íconos, badges redondos) la recupera respecto del original.
  if (p.sourceTree) {
    const src = new Map(p.sourceTree.children.map((c) => [c.id, c]));
    current = { ...current, children: current.children.map((c) => (src.has(c.id) ? keepLayerAspect(c, src.get(c.id)!) : c)) };
  }
  return {
    tree: p.resolveColor ? ensureTextContrast(current, p.resolveColor) : current,
    patches,
    rationale: rationales.join(" "),
    issuesBefore,
    issuesAfter: issues,
    passes,
    usage,
  };
}
