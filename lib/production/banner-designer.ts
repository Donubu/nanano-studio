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
} from "./types";
import {
  validateTemplateDefinition,
  ValidationErr,
} from "./template-schema";
import { BrandKitContent } from "./brand-kit";

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
  status?: string;
  response?: string;
  conversationId?: string;
  delegatedTo?: string;
  toolsUsed?: string[];
  tokenUsage?: {
    inputTokens?: number;
    outputTokens?: number;
    estimatedCost?: number;
  };
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
function parseAgentResponse(raw: string): { definition?: unknown; rationale?: string; error?: string } {
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
    return {
      definition: (parsed as Record<string, unknown>).definition,
      rationale:
        typeof (parsed as Record<string, unknown>).rationale === "string"
          ? ((parsed as Record<string, unknown>).rationale as string)
          : undefined,
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

// Decide la familia de aspect ratio según las dimensiones. Mismo criterio
// que el resto del proyecto (~5% tolerancia para "square").
export function aspectFamilyFromDims(w: number, h: number): AspectFamily {
  const r = w / h;
  if (Math.abs(r - 1) < 0.05) return "square";
  return r > 1 ? "horizontal" : "vertical";
}
