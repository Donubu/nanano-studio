// Llamada a Gemini con salida JSON por schema, compartida por la IA de
// producción (layout-fixer, layout-planner, animation-planner, edit-planner).
//
// Además del retry de red/429 de withRetry, reintenta UNA vez si la
// respuesta llega vacía o con JSON inválido: Gemini a veces termina sin
// texto (0 tokens de salida) aunque el pedido sea válido. Server-only.

import { ThinkingLevel, type Part } from "@google/genai";
import { getClient, withRetry } from "@/lib/google-ai";

export interface GeminiUsage {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

// USD por millón de tokens. Los tokens de razonamiento se cobran como salida.
const PRICING: Record<string, { input: number; output: number }> = {
  "gemini-3.8-flash": { input: 0.75, output: 3.75 },
};
const FALLBACK_PRICING = PRICING["gemini-3.8-flash"];

export interface GeminiJsonRequest {
  model: string;
  systemInstruction: string;
  schema: object;
  parts: Part[];
  temperature: number;
  maxOutputTokens: number;
  operationName: string;
  abortSignal?: AbortSignal;
}

const ATTEMPTS = 2;

export async function generateJson<T = unknown>(
  req: GeminiJsonRequest,
): Promise<{ data: T; usage: GeminiUsage }> {
  const p = PRICING[req.model] ?? FALLBACK_PRICING;
  const usage: GeminiUsage = { inputTokens: 0, outputTokens: 0, estimatedCost: 0 };
  let lastError = "";
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const response = await withRetry(
      () =>
        getClient("gemini").models.generateContent({
          model: req.model,
          contents: [{ role: "user", parts: req.parts }],
          config: {
            systemInstruction: req.systemInstruction,
            responseMimeType: "application/json",
            responseJsonSchema: req.schema,
            temperature: req.temperature,
            maxOutputTokens: req.maxOutputTokens,
            thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            abortSignal: req.abortSignal,
          },
        }),
      req.operationName,
      undefined,
      req.abortSignal,
    );
    const um = response.usageMetadata;
    const input = um?.promptTokenCount ?? 0;
    const output = (um?.candidatesTokenCount ?? 0) + (um?.thoughtsTokenCount ?? 0);
    usage.inputTokens += input;
    usage.outputTokens += output;
    usage.estimatedCost += (input * p.input + output * p.output) / 1_000_000;

    const blocked = response.promptFeedback?.blockReason;
    if (blocked) {
      throw Object.assign(new Error(`Gemini rechazó el pedido (${blocked})`), { usage });
    }
    const text = response.text ?? "";
    if (text.trim()) {
      try {
        return { data: JSON.parse(text) as T, usage };
      } catch (e) {
        lastError = `JSON inválido de Gemini: ${(e as Error).message}`;
      }
    } else {
      lastError = `Gemini respondió vacío (${response.candidates?.[0]?.finishReason ?? "sin motivo"})`;
    }
    if (req.abortSignal?.aborted) break;
    console.warn(`[gemini-json] ${req.operationName} intento ${attempt}/${ATTEMPTS}: ${lastError}`);
  }
  throw Object.assign(new Error(lastError), { usage });
}
