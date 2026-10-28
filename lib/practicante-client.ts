// Cliente de practicante (/api/external/run). Practicante es la fuente del
// conocimiento de marca (brandbook, voz) por cliente/slug; nanano lo usa
// para sincronizar la guía de marca (app/api/clients/[id]/brand-guide).
// Armar, adaptar y animar piezas NO pasa por acá: lo hace nanano con Gemini
// (lib/production/layout-*.ts, animation-plan*.ts).
//
// Server-only.

export interface AgentReferenceFile {
  filename: string;
  publicUrl: string;
  mimeType: string;
}

export interface PracticanteRunResponse {
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
// Sin agentName va al orquestador de practicante (lo usa la sincronización
// de guía de marca, que necesita las tools brandbook_<slug> del cliente).
export async function callPracticante(payload: {
  message: string;
  promptSuffix: string;
  agentName?: string;
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
      ...(payload.agentName ? { agentName: payload.agentName, forceAgent: true } : {}),
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
