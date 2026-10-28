// "Animar con IA" con Gemini (llamada directa, sin practicante). El modelo
// devuelve una coreografía por capa (animation-plan.ts) con JSON schema
// forzado; el motor la traduce a tracks. Server-only.

import { generateJson } from "./gemini-json";
import type { TemplateDefinition } from "./types";
import { describeTree, LAYOUT_FIXER_MODEL, LayoutFixUsage } from "./layout-fixer";
import { ENTRANCES, EMPHASES, AnimationPlan, sanitizeAnimationPlan } from "./animation-plan";

export const ANIMATION_PLANNER_MODEL = process.env.PRODUCTION_AI_ANIMATION_MODEL || LAYOUT_FIXER_MODEL;
export const ANIMATION_PLANNER_AGENT_NAME = "animation-planner";

const SYSTEM_INSTRUCTION = `Eres motion designer de banners publicitarios (display HTML5 y redes). Recibes las capas de un banner y la intención del productor, y decides la coreografía: qué capa entra, cómo, cuándo y si después tiene un énfasis.

Entradas disponibles: ${ENTRANCES.join(", ")}. ("slide-left" entra desde la izquierda; "slide-up" sube desde abajo; "none" = la capa está desde el inicio.)
Énfasis disponibles (después de la entrada, en ciclos suaves): ${EMPHASES.join(", ")}.

Reglas:
1. Orden de lectura: fondo/imagen primero (o "none"), después titular, bajada y al final precio/CTA. El CTA es lo último en entrar y es el único con "pulse" (salvo que el productor pida otra cosa).
2. Las capas con "background": true usan "none" o "fade" corto; nunca slides.
3. Escalona: separa los inicios 150–400 ms. Entradas de 400–900 ms.
4. Deja la pieza completa y quieta al menos 1.5 s antes del final del loop: duration_ms ≥ fin de la última entrada + 1500.
5. Intensidad: "subtle" = fades y slides cortos, nada de pop ni blur; "balanced" = mezcla moderada; "energetic" = pop, blur-in y escalonado rápido.
6. loop: 1 a 3 (estándar IAB). Solo "infinite" si el productor lo pide.
7. Incluye todas las capas visibles que quieras animar; las que no incluyas quedan quietas.

Responde solo con el JSON pedido. "rationale": una frase en español de Chile (tuteo) explicando la coreografía.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    duration_ms: { type: "number" },
    loop: { type: "number" },
    layers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          entrance: { type: "string", enum: [...ENTRANCES] },
          start_ms: { type: "number" },
          duration_ms: { type: "number" },
          emphasis: { type: "string", enum: [...EMPHASES] },
        },
        required: ["id", "entrance", "start_ms", "duration_ms", "emphasis"],
      },
    },
    rationale: { type: "string" },
  },
  required: ["duration_ms", "loop", "layers", "rationale"],
};

export interface AnimationPlanRequest {
  // Árbol con tokens resueltos (para describirlo en números).
  resolvedTree: TemplateDefinition;
  intent: string;
  complexity: "subtle" | "balanced" | "energetic";
  durationHintMs?: number;
  instructions?: string;
}

export async function requestAnimationPlan(
  req: AnimationPlanRequest,
): Promise<{ plan: AnimationPlan; usage: LayoutFixUsage; model: string }> {
  const context = {
    intent: req.intent,
    complexity: req.complexity,
    ...(req.durationHintMs ? { duration_hint_ms: req.durationHintMs } : {}),
    ...(req.instructions?.trim() ? { instructions: req.instructions.trim() } : {}),
    banner: describeTree(req.resolvedTree),
  };
  const model = ANIMATION_PLANNER_MODEL;
  const { data: parsed, usage } = await generateJson({
    model,
    systemInstruction: SYSTEM_INSTRUCTION,
    schema: RESPONSE_SCHEMA,
    parts: [{ text: JSON.stringify(context) }],
    temperature: 0.6,
    maxOutputTokens: 4096,
    operationName: "productionAnimationPlan",
  });
  const plan = sanitizeAnimationPlan(parsed, req.resolvedTree);
  if (!plan) throw Object.assign(new Error("Gemini no devolvió una coreografía válida"), { usage });
  return { plan, usage, model };
}
