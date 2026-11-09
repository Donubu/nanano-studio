/**
 * Modelos de texto que aceptan thinkingConfig (presupuesto de razonamiento e
 * includeThoughts). La UI muestra el selector de razonamiento solo para estos.
 * Gemini 3.1 Pro (legado) y la familia Flash 3.5+ (actual: gemini-3.8-flash);
 * los -lite y -tts quedan fuera.
 */
export function supportsTextThinking(modelId: string | null | undefined): boolean {
  if (!modelId) return false;
  const id = modelId.replace(/^models\//, "");
  if (id.startsWith("gemini-3.1-pro")) return true;
  return /^gemini-(3\.[5-9]|[4-9](\.\d+)?)-flash(?!-lite)(?!.*-tts)/.test(id);
}
