// Cliente del agente "Banner Designer" en practicante.
//
// Esta capa orquesta:
//   1. Armado del payload (operation + master + brand_kit + dims + instructions).
//   2. Llamada a practicante con agentName="Banner Designer".
//   3. Parseo de la respuesta JSON.
//   4. Validación zod + reintento (1 vez) con conversation_id si el JSON
//      devuelto no pasa validación.
//   5. Devuelve { definition, rationale, tokenUsage, conversationId } o un
//      error tipado.
//
// El handler HTTP (endpoint) usa este lib y se encarga de DB + auth + UI
// state. Acá NO sabemos de session ni de DB.

import {
  TemplateDefinition,
  TemplateLayer,
} from "./types";
import {
  validateTemplateDefinition,
  validateAnimationConfig,
  ValidationErr,
} from "./template-schema";
import { BrandKitContent } from "./brand-kit";
import type { AnimationConfig } from "./animation";

export const BANNER_DESIGNER_AGENT_NAME = "Banner Designer";

export interface BrandKitForAgent {
  colors: Array<{ name: string; value: string }>;
  fonts: Array<{ name: string; value: string }>;
  scales: Array<{ name: string; value: number }>;
  spacings: Array<{ name: string; value: number }>;
  logos: Array<{ name: string; value: string }>;
}

// Convierte el BrandKitContent del app shape (con label, fontWeight, etc.) al
// shape simplificado que entiende el agente. El agente solo necesita name +
// value por token; el label es UI-only.
export function brandKitForAgent(kit: BrandKitContent): BrandKitForAgent {
  return {
    colors: kit.colors.map((c) => ({ name: c.name, value: c.value })),
    fonts: kit.fonts.map((f) => ({ name: f.name, value: f.fontFamily })),
    scales: kit.scales.map((s) => ({ name: s.name, value: s.fontSize })),
    spacings: kit.spacing.map((s) => ({ name: s.name, value: s.value })),
    logos: kit.logos.map((l) => ({ name: l.name, value: l.src })),
  };
}

export type AspectFamily = "horizontal" | "square" | "vertical";

export interface AgentReferenceFile {
  filename: string;
  publicUrl: string;
  mimeType: string;
}

export interface AdaptOrientationInput {
  master: TemplateDefinition;
  masterDims: { w: number; h: number };
  targetDims: { w: number; h: number };
  targetAspectFamily: AspectFamily;
  brandKit: BrandKitForAgent;
  instructions?: string;
  // Email del usuario que dispara la acción. Practicante lo usa para
  // identificar / autorizar. El backend del proxy hace fallback al
  // PRACTICANTE_USER_EMAIL si éste no existe en practicante.
  userEmail: string;
  // Imágenes de referencia (típicamente: screenshot del master renderizado a
  // tamaño nativo) que se pasan como `files` a practicante. Sonnet 4.6 las
  // ve y las usa como referencia visual junto al JSON del master. Útil porque
  // un layout puede entenderse mejor visualmente que leyendo coordenadas.
  referenceFiles?: AgentReferenceFile[];
}

// Input para ANIMATE_TEMPLATE: el agente recibe un template existente y
// devuelve un AnimationConfig que se asigna al campo .animation del root.
// No modifica el árbol de capas — solo emite la timeline. Spec completa
// del agente en BANNERS-ANIMATION-IA.md (apéndice al system prompt).
export interface AnimateTemplateInput {
  template: TemplateDefinition;
  templateDims: { w: number; h: number };
  brandKit: BrandKitForAgent;
  intent: string;
  // "subtle" | "balanced" (default) | "energetic". Guía la densidad de la
  // animación que el agente decide.
  complexity?: "subtle" | "balanced" | "energetic";
  // Hint del productor en ms. El agente debería respetar ±20%. Si no
  // viene, decide solo según complexity.
  durationHintMs?: number;
  // Si el template ya tiene una animación previa, se pasa al agente como
  // contexto — útil para "rediseñá esto sin perder la coherencia con lo
  // que ya hay" o "agregale un detalle al CTA". null = arrancar de cero.
  existingAnimation?: AnimationConfig | null;
  instructions?: string;
  userEmail: string;
}

// Output específico para ANIMATE_TEMPLATE: animation + rationale. No
// devuelve definition (el árbol queda sin tocar — el caller fusiona la
// animation en su lado).
export interface AnimateInvocationResult {
  ok: true;
  animation: AnimationConfig;
  rationale: string;
  conversationId?: string;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    estimatedCost?: number;
  };
}

// Input para GENERATE_FROM_REFERENCE: el productor sube imágenes de banners
// que quiere replicar. El agente extrae estilo (paleta, jerarquía, layout)
// vía analyze_media y compone master + variantes con el brand kit del cliente.
export interface GenerateFromReferenceInput {
  masterDims: { w: number; h: number };
  secondaryAspects: Array<{ w: number; h: number }>;
  brandKit: BrandKitForAgent;
  intent?: string;
  instructions?: string;
  userEmail: string;
  // Las imágenes de referencia. En este modo es OBLIGATORIO mandar al menos
  // una — la operación no tiene sentido sin nada que replicar.
  referenceFiles: AgentReferenceFile[];
}

// Output unificado para GENERATE: master + array de variantes por aspect.
// Cada variante trae sus dims así el caller puede mapearlas al endpoint
// POST templates sin recalcular.
export interface AgentGenerateResult {
  ok: true;
  definition: TemplateDefinition;
  variants: Array<{ dims: { w: number; h: number }; definition: TemplateDefinition }>;
  rationale: string;
  conversationId?: string;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    estimatedCost?: number;
  };
}

export interface AgentInvocationResult {
  ok: true;
  definition: TemplateDefinition;
  rationale: string;
  conversationId?: string;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    estimatedCost?: number;
  };
}

export interface AgentInvocationError {
  ok: false;
  error: string;
  // Datos parciales que pudimos extraer pese al error — útiles para registrar
  // en production_ai_invocations aunque haya fallado.
  conversationId?: string;
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    estimatedCost?: number;
  };
}

interface PracticanteRunResponse {
  jobId?: string;
  status?: string;
  response?: string;
  conversationId?: string;
  messageId?: string;
  delegatedTo?: string;
  toolsUsed?: string[];
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    estimatedCost?: number;
  };
  // Cuando practicante intentó parsear la respuesta del modelo como JSON y
  // falló, marca este campo. response trae el texto crudo. Lo tratamos como
  // failure controlado (no llega a zod) y le devolvemos retry al agente.
  parseError?: string;
  // Warnings no críticos (ej: sanitizer aplicado). Los logueamos para
  // observabilidad; no bloquean el flujo.
  warnings?: string[];
  error?: string;
  code?: string;
}

// Llama al endpoint /api/external/run de practicante. Implementa el mismo
// patrón de fallback que el proxy /api/practicante/run (intenta primero con
// el email del usuario; si retorna 404 user_not_found, reintenta con
// PRACTICANTE_USER_EMAIL).
async function callPracticante(payload: {
  message: string;
  promptSuffix: string;
  agentName: string;
  existingConversationId?: string;
  userEmail: string;
  files?: AgentReferenceFile[];
}): Promise<PracticanteRunResponse> {
  const baseUrl = process.env.PRACTICANTE_URL;
  const apiKey = process.env.PRACTICANTE_API_KEY;
  const fallbackEmail = process.env.PRACTICANTE_USER_EMAIL;
  if (!baseUrl || !apiKey) {
    throw new Error(
      "Practicante no configurado (faltan PRACTICANTE_URL o PRACTICANTE_API_KEY)",
    );
  }

  const body: Record<string, unknown> = {
    message: payload.message,
    dryRun: false,
    // normalize:false confirma que el message le llega al agente tal cual
    // — sin pre-procesamiento del orquestador de practicante. Necesario
    // para que el agente reciba el verbo de operación intacto.
    normalize: false,
    returnOnlyFinalText: true,
    context: {
      responseFormat: "json",
      agentName: payload.agentName,
      forceAgent: true,
      promptSuffix: payload.promptSuffix,
    },
  };
  if (payload.existingConversationId) {
    body.existingConversationId = payload.existingConversationId;
  }
  if (payload.files && payload.files.length > 0) {
    body.files = payload.files;
  }

  const doFetch = (email: string) =>
    fetch(`${baseUrl}/api/external/run`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": apiKey,
        "X-User-Email": email,
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });

  let res = await doFetch(payload.userEmail);
  let json = (await res.json().catch(() => ({}))) as PracticanteRunResponse;
  if (
    res.status === 404 &&
    json?.code === "user_not_found" &&
    fallbackEmail &&
    fallbackEmail !== payload.userEmail
  ) {
    res = await doFetch(fallbackEmail);
    json = (await res.json().catch(() => ({}))) as PracticanteRunResponse;
  }
  if (!res.ok) {
    throw new Error(
      `Practicante respondió ${res.status}: ${json?.error || "sin mensaje"}`,
    );
  }
  if (json.status === "failed") {
    throw new Error(json.error || "Ejecución fallida en practicante");
  }
  return json;
}

// Parsea la respuesta del agente. Tolera markdown code fences por si el
// agente se equivoca y los incluye (no debería, pero defendemos).
function parseAgentResponse(raw: string): {
  definition?: unknown;
  variants?: unknown;
  animation?: unknown;
  rationale?: string;
  error?: string;
} {
  let cleaned = raw.trim();
  // Strip ```json ... ``` o ``` ... ``` defensively.
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "");
  }
  try {
    const parsed = JSON.parse(cleaned);
    if (typeof parsed !== "object" || parsed === null) {
      return { error: "Respuesta no es un objeto JSON" };
    }
    const obj = parsed as Record<string, unknown>;
    return {
      definition: obj.definition,
      variants: obj.variants,
      animation: obj.animation,
      rationale: typeof obj.rationale === "string" ? obj.rationale : undefined,
    };
  } catch (e) {
    return { error: `JSON inválido: ${(e as Error).message}` };
  }
}

// Operación principal: ADAPT_ORIENTATION. Llama al agente, valida, reintenta
// 1 vez si la validación falla, registra todo lo necesario para que el
// caller pueda persistir el registro de invocación.
export async function runAdaptOrientation(
  input: AdaptOrientationInput,
): Promise<AgentInvocationResult | AgentInvocationError> {
  const message = `Adapta este master a una orientación ${input.targetDims.w}x${input.targetDims.h} (${input.targetAspectFamily}).`;
  const context = {
    operation: "ADAPT_ORIENTATION" as const,
    master: input.master,
    master_dims: input.masterDims,
    target_dims: input.targetDims,
    target_aspect_family: input.targetAspectFamily,
    brand_kit: input.brandKit,
    instructions: input.instructions ?? null,
  };
  const promptSuffix = JSON.stringify(context);

  // Primera llamada
  let response: PracticanteRunResponse;
  try {
    response = await callPracticante({
      message,
      promptSuffix,
      agentName: BANNER_DESIGNER_AGENT_NAME,
      userEmail: input.userEmail,
      files: input.referenceFiles,
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const validation = validateAgentResponse(response, input.targetDims);
  if (validation.ok) {
    return {
      ok: true,
      definition: validation.definition,
      rationale: validation.rationale,
      conversationId: response.conversationId,
      tokenUsage: response.tokenUsage,
    };
  }

  // Retry una sola vez con feedback del error. No re-mandamos los files
  // (la imagen ya está en el conversation context).
  const retryMessage = `Tu respuesta anterior falló validación: ${validation.error}. Corrige solo ese error y devuelve el JSON completo nuevamente.`;
  let retryResponse: PracticanteRunResponse;
  try {
    retryResponse = await callPracticante({
      message: retryMessage,
      promptSuffix,
      agentName: BANNER_DESIGNER_AGENT_NAME,
      existingConversationId: response.conversationId,
      userEmail: input.userEmail,
    });
  } catch (e) {
    return {
      ok: false,
      error: `Retry falló: ${(e as Error).message}`,
      conversationId: response.conversationId,
      tokenUsage: response.tokenUsage,
    };
  }

  const retryValidation = validateAgentResponse(retryResponse, input.targetDims);
  if (retryValidation.ok) {
    // Sumamos tokens si vinieron en ambas llamadas (best effort).
    const combinedTokens = combineTokenUsage(response.tokenUsage, retryResponse.tokenUsage);
    return {
      ok: true,
      definition: retryValidation.definition,
      rationale: retryValidation.rationale,
      conversationId: retryResponse.conversationId ?? response.conversationId,
      tokenUsage: combinedTokens,
    };
  }

  return {
    ok: false,
    error: `Tras retry: ${retryValidation.error}`,
    conversationId: retryResponse.conversationId ?? response.conversationId,
    tokenUsage: combineTokenUsage(response.tokenUsage, retryResponse.tokenUsage),
  };
}

// Operación ANIMATE_TEMPLATE. Mismo patrón que runAdaptOrientation: llama
// al agente, valida la respuesta contra el schema de AnimationConfig +
// que los layerId referenciados existan en el template, reintenta 1 vez
// si falla la validación. NO modifica el template — solo devuelve la
// animation que el caller asigna a definition.animation.
export async function runAnimateTemplate(
  input: AnimateTemplateInput,
): Promise<AnimateInvocationResult | AgentInvocationError> {
  const complexity = input.complexity ?? "balanced";
  const message =
    `Animá este banner con sensación "${input.intent}" ` +
    `(complexity: ${complexity}${input.durationHintMs ? `, duración ~${input.durationHintMs}ms` : ""}).`;
  const context = {
    operation: "ANIMATE_TEMPLATE" as const,
    template: input.template,
    template_dims: input.templateDims,
    brand_kit: input.brandKit,
    intent: input.intent,
    complexity,
    duration_hint_ms: input.durationHintMs ?? null,
    existing_animation: input.existingAnimation ?? null,
    instructions: input.instructions ?? null,
  };
  const promptSuffix = JSON.stringify(context);

  // Set de layerIds del template para validar que el agente no inventa.
  // Pre-computado una vez fuera del closure de retry.
  const knownLayerIds = collectLayerIds(input.template);

  let response: PracticanteRunResponse;
  try {
    response = await callPracticante({
      message,
      promptSuffix,
      agentName: BANNER_DESIGNER_AGENT_NAME,
      userEmail: input.userEmail,
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const validation = validateAnimationAgentResponse(response, knownLayerIds);
  if (validation.ok) {
    return {
      ok: true,
      animation: validation.animation,
      rationale: validation.rationale,
      conversationId: response.conversationId,
      tokenUsage: response.tokenUsage,
    };
  }

  // Retry una vez con el error específico. Mismo conversationId para que
  // el agente vea el contexto y solo corrija lo que falló.
  const retryMessage = `Tu respuesta anterior falló validación: ${validation.error}. Corrige solo ese error y devuelve el JSON completo nuevamente.`;
  let retryResponse: PracticanteRunResponse;
  try {
    retryResponse = await callPracticante({
      message: retryMessage,
      promptSuffix,
      agentName: BANNER_DESIGNER_AGENT_NAME,
      existingConversationId: response.conversationId,
      userEmail: input.userEmail,
    });
  } catch (e) {
    return {
      ok: false,
      error: `Retry falló: ${(e as Error).message}`,
      conversationId: response.conversationId,
      tokenUsage: response.tokenUsage,
    };
  }

  const retryValidation = validateAnimationAgentResponse(retryResponse, knownLayerIds);
  if (retryValidation.ok) {
    return {
      ok: true,
      animation: retryValidation.animation,
      rationale: retryValidation.rationale,
      conversationId: retryResponse.conversationId ?? response.conversationId,
      tokenUsage: combineTokenUsage(response.tokenUsage, retryResponse.tokenUsage),
    };
  }

  return {
    ok: false,
    error: `Tras retry: ${retryValidation.error}`,
    conversationId: retryResponse.conversationId ?? response.conversationId,
    tokenUsage: combineTokenUsage(response.tokenUsage, retryResponse.tokenUsage),
  };
}

function collectLayerIds(root: TemplateDefinition): Set<string> {
  const out = new Set<string>();
  function walk(l: TemplateLayer) {
    out.add(l.id);
    if (l.type === "frame") for (const c of l.children) walk(c);
  }
  walk(root);
  return out;
}

type AnimationValidated =
  | { ok: true; animation: AnimationConfig; rationale: string }
  | (ValidationErr & { rationale?: string });

function validateAnimationAgentResponse(
  response: PracticanteRunResponse,
  knownLayerIds: Set<string>,
): AnimationValidated {
  if (response.parseError) {
    return {
      ok: false,
      error: `Practicante reportó parseError: ${response.parseError}`,
    };
  }
  if (response.warnings && response.warnings.length > 0) {
    console.warn("[banner-designer/animate] warnings:", response.warnings);
  }
  if (!response.response) {
    return { ok: false, error: "Practicante no devolvió texto de respuesta" };
  }
  const parsed = parseAgentResponse(response.response);
  if (parsed.error || !parsed.animation) {
    return {
      ok: false,
      error: parsed.error || "La respuesta no contiene 'animation'",
    };
  }
  const v = validateAnimationConfig(parsed.animation, knownLayerIds);
  if (!v.ok) {
    return { ok: false, error: v.error };
  }
  return {
    ok: true,
    animation: v.animation,
    rationale: parsed.rationale ?? "",
  };
}

function combineTokenUsage(
  a?: PracticanteRunResponse["tokenUsage"],
  b?: PracticanteRunResponse["tokenUsage"],
): PracticanteRunResponse["tokenUsage"] | undefined {
  if (!a && !b) return undefined;
  return {
    inputTokens: (a?.inputTokens ?? 0) + (b?.inputTokens ?? 0),
    outputTokens: (a?.outputTokens ?? 0) + (b?.outputTokens ?? 0),
    estimatedCost: (a?.estimatedCost ?? 0) + (b?.estimatedCost ?? 0),
  };
}

type Validated =
  | { ok: true; definition: TemplateDefinition; rationale: string }
  | (ValidationErr & { rationale?: string });

function validateAgentResponse(
  response: PracticanteRunResponse,
  expectedSize: { w: number; h: number },
): Validated {
  if (response.parseError) {
    return {
      ok: false,
      error: `Practicante reportó parseError: ${response.parseError}`,
    };
  }
  if (response.warnings && response.warnings.length > 0) {
    console.warn("[banner-designer] warnings:", response.warnings);
  }
  if (!response.response) {
    return { ok: false, error: "Practicante no devolvió texto de respuesta" };
  }
  const parsed = parseAgentResponse(response.response);
  if (parsed.error || !parsed.definition) {
    return {
      ok: false,
      error: parsed.error || "La respuesta no contiene 'definition'",
    };
  }
  const v = validateTemplateDefinition(parsed.definition, expectedSize);
  if (!v.ok) {
    return { ok: false, error: v.error };
  }
  return {
    ok: true,
    definition: v.definition,
    rationale: parsed.rationale ?? "",
  };
}

// Operación GENERATE_FROM_REFERENCE: el productor sube imágenes que quiere
// replicar de estilo. El agente las analiza con analyze_media (obligatorio
// en este modo) y genera master + variants aplicando el brand kit del cliente.
// El brand_kit es OBLIGATORIO en el contexto — el agente lo necesita para
// reemplazar la paleta de la referencia con los tokens del cliente.
export async function runGenerateFromReference(
  input: GenerateFromReferenceInput,
): Promise<AgentGenerateResult | AgentInvocationError> {
  if (input.referenceFiles.length === 0) {
    return {
      ok: false,
      error: "GENERATE_FROM_REFERENCE requiere al menos una imagen de referencia",
    };
  }
  const refList = input.referenceFiles.map((f) => f.filename).join(", ");
  const message = `Genera un banner ${input.masterDims.w}x${input.masterDims.h} replicando el estilo de las referencias adjuntas (${refList}). Aplicá el brand kit del cliente. Si vienen secondary_aspects, generá también esas variantes.`;
  const context = {
    operation: "GENERATE_FROM_REFERENCE" as const,
    master_dims: input.masterDims,
    secondary_aspects: input.secondaryAspects,
    brand_kit: input.brandKit,
    intent: input.intent ?? null,
    instructions: input.instructions ?? null,
  };
  const promptSuffix = JSON.stringify(context);

  let response: PracticanteRunResponse;
  try {
    response = await callPracticante({
      message,
      promptSuffix,
      agentName: BANNER_DESIGNER_AGENT_NAME,
      userEmail: input.userEmail,
      files: input.referenceFiles,
    });
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const validation = validateGenerateResponse(
    response,
    input.masterDims,
    input.secondaryAspects,
  );
  if (validation.ok) {
    return {
      ok: true,
      definition: validation.definition,
      variants: validation.variants,
      rationale: validation.rationale,
      conversationId: response.conversationId,
      tokenUsage: response.tokenUsage,
    };
  }

  // Retry una sola vez con feedback. Mismo patrón que adapt.
  const retryMessage = `Tu respuesta anterior falló validación: ${validation.error}. Corrige solo ese error y devuelve el JSON completo nuevamente.`;
  let retryResponse: PracticanteRunResponse;
  try {
    retryResponse = await callPracticante({
      message: retryMessage,
      promptSuffix,
      agentName: BANNER_DESIGNER_AGENT_NAME,
      existingConversationId: response.conversationId,
      userEmail: input.userEmail,
    });
  } catch (e) {
    return {
      ok: false,
      error: `Retry falló: ${(e as Error).message}`,
      conversationId: response.conversationId,
      tokenUsage: response.tokenUsage,
    };
  }

  const retryValidation = validateGenerateResponse(
    retryResponse,
    input.masterDims,
    input.secondaryAspects,
  );
  if (retryValidation.ok) {
    const combinedTokens = combineTokenUsage(
      response.tokenUsage,
      retryResponse.tokenUsage,
    );
    return {
      ok: true,
      definition: retryValidation.definition,
      variants: retryValidation.variants,
      rationale: retryValidation.rationale,
      conversationId: retryResponse.conversationId ?? response.conversationId,
      tokenUsage: combinedTokens,
    };
  }
  return {
    ok: false,
    error: `Tras retry: ${retryValidation.error}`,
    conversationId: retryResponse.conversationId ?? response.conversationId,
    tokenUsage: combineTokenUsage(response.tokenUsage, retryResponse.tokenUsage),
  };
}

type GenerateValidated =
  | {
      ok: true;
      definition: TemplateDefinition;
      variants: Array<{ dims: { w: number; h: number }; definition: TemplateDefinition }>;
      rationale: string;
    }
  | ValidationErr;

// Valida la respuesta de un GENERATE_* — master + variants. Las variants
// son opcionales en el output del agente (si no vienen secondary_aspects
// nadie las espera) pero si vienen tienen que matchear las dims esperadas.
function validateGenerateResponse(
  response: PracticanteRunResponse,
  masterSize: { w: number; h: number },
  expectedVariants: Array<{ w: number; h: number }>,
): GenerateValidated {
  if (response.parseError) {
    return {
      ok: false,
      error: `Practicante reportó parseError: ${response.parseError}`,
    };
  }
  if (response.warnings && response.warnings.length > 0) {
    console.warn("[banner-designer] warnings:", response.warnings);
  }
  if (!response.response) {
    return { ok: false, error: "Practicante no devolvió texto de respuesta" };
  }
  const parsed = parseAgentResponse(response.response);
  if (parsed.error || !parsed.definition) {
    return {
      ok: false,
      error: parsed.error || "La respuesta no contiene 'definition'",
    };
  }
  const masterValidation = validateTemplateDefinition(parsed.definition, masterSize);
  if (!masterValidation.ok) {
    return { ok: false, error: `master: ${masterValidation.error}` };
  }

  // Validamos cada variant. Si secondary_aspects está vacío, ignoramos
  // variants aunque el agente las haya mandado. Si tiene aspects, exigimos
  // que el agente devuelva uno por cada uno.
  const validatedVariants: Array<{
    dims: { w: number; h: number };
    definition: TemplateDefinition;
  }> = [];

  if (expectedVariants.length > 0) {
    if (!Array.isArray(parsed.variants)) {
      return {
        ok: false,
        error: `Se esperaban ${expectedVariants.length} variantes pero variants no es array`,
      };
    }
    for (const expected of expectedVariants) {
      const match = (parsed.variants as Array<Record<string, unknown>>).find((v) => {
        const dims = v.dims as { w?: number; h?: number } | undefined;
        return dims?.w === expected.w && dims?.h === expected.h;
      });
      if (!match) {
        return {
          ok: false,
          error: `Falta la variante ${expected.w}x${expected.h}`,
        };
      }
      const v = validateTemplateDefinition(match.definition, expected);
      if (!v.ok) {
        return {
          ok: false,
          error: `variant ${expected.w}x${expected.h}: ${v.error}`,
        };
      }
      validatedVariants.push({ dims: expected, definition: v.definition });
    }
  }

  return {
    ok: true,
    definition: masterValidation.definition,
    variants: validatedVariants,
    rationale: parsed.rationale ?? "",
  };
}

// Decide la familia de aspect ratio según las dimensiones. Mismo criterio
// que el resto del proyecto (~5% tolerancia para "square").
export function aspectFamilyFromDims(w: number, h: number): AspectFamily {
  const r = w / h;
  if (Math.abs(r - 1) < 0.05) return "square";
  return r > 1 ? "horizontal" : "vertical";
}
