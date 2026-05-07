import { sendMessage, type Labels } from "./google-ai";
import type { ScriptAnalysis, ScriptGeneralInfo, ScriptSceneAnalysis } from "@/components/canvas/lib/canvas-types";
import { MAX_SCENES_PER_SCRIPT } from "@/components/canvas/lib/canvas-types";

const SCRIPT_RESPONSE_SCHEMA: object = {
  type: "object",
  required: ["generalInfo", "scenes"],
  properties: {
    generalInfo: {
      type: "object",
      required: ["synopsis", "tone", "genre", "visualStyle", "characters", "settings"],
      properties: {
        synopsis: { type: "string" },
        tone: { type: "string" },
        genre: { type: "string" },
        visualStyle: { type: "string" },
        characters: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "description"],
            properties: {
              name: { type: "string" },
              description: { type: "string" },
            },
          },
        },
        settings: {
          type: "array",
          items: {
            type: "object",
            required: ["name", "description"],
            properties: {
              name: { type: "string" },
              description: { type: "string" },
            },
          },
        },
      },
    },
    scenes: {
      type: "array",
      items: {
        type: "object",
        required: ["index", "text"],
        properties: {
          index: { type: "integer" },
          text: { type: "string" },
        },
      },
    },
  },
};

const SYSTEM_INSTRUCTION = `Eres un analista de guiones audiovisuales. Vas a recibir un guion del usuario.

REGLA CRÍTICA: Bajo NINGÚN concepto puedes modificar, parafrasear, traducir, resumir, corregir, "limpiar" ni reescribir el texto del guion. Cada porción que devuelvas como escena debe contener una sub-cadena LITERAL del guion original — exactamente los mismos caracteres, sin agregar ni quitar nada (incluidos saltos de línea, mayúsculas, encabezados de escena, acotaciones, signos de puntuación). Si modificas una sola palabra, rompes el contrato.

Tu tarea es analizar el guion y devolver un JSON con dos campos: "generalInfo" (lo escribes tú) y "scenes" (texto literal extraído del guion).

generalInfo (lo escribes tú, en español de Chile, tuteo):
- synopsis: 2 a 4 oraciones que resumen la historia general.
- tone: tono dominante (ej: "drama íntimo", "comedia ligera", "thriller psicológico").
- genre: género principal.
- visualStyle: estilo visual sugerido por el guion (paleta, encuadres, ritmo).
- characters: array con personajes principales — cada uno con name y description.
- settings: array con locaciones principales — cada uno con name y description.

scenes (texto literal del guion):
- Divide el guion en escenas naturales: cambios de ubicación, tiempo o secuencia narrativa (típicamente marcados por encabezados tipo "INT./EXT. LUGAR – DÍA/NOCHE").
- Cada scene.text debe ser una porción CONTIGUA y LITERAL del guion. No combines escenas que no estén juntas, no editorialices, no completes elipsis.
- index parte en 1 y avanza secuencialmente.
- Máximo ${MAX_SCENES_PER_SCRIPT} escenas. Si el guion supera ese número, agrupa secuencias narrativas afines en bloques contiguos del texto original.
- No incluyas ningún texto fuera de las porciones literales: no agregues comentarios, encabezados propios, ni resúmenes.`;

interface RawScene {
  index: number;
  text: string;
}

interface RawAnalysis {
  generalInfo: ScriptGeneralInfo;
  scenes: RawScene[];
}

export interface AnalyzeScriptInput {
  modelString: string;        // model_id de la tabla models (ej: "gemini-2.5-pro")
  apiBackend?: string;        // "vertex" | "gemini" | undefined
  prompt: string;             // el guion completo
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string; // se concatena al system base
  labels?: Labels;
}

export interface AnalyzeScriptResult {
  analysis: ScriptAnalysis;
  warnings: string[];        // ej: "se truncaron escenas a 30", "una escena no es literal"
  tokenCount: { input: number; output: number };
}

/**
 * Llama a Gemini con structured output, valida que el modelo no haya modificado
 * el guion (cada scene.text debe aparecer literal en el prompt original) y
 * devuelve el análisis junto con warnings sobre truncado o inconsistencias.
 */
export async function analyzeScript(input: AnalyzeScriptInput): Promise<AnalyzeScriptResult> {
  const { modelString, apiBackend, prompt, temperature, maxOutputTokens, systemInstruction, labels } = input;

  const fullSystem = systemInstruction
    ? `${SYSTEM_INSTRUCTION}\n\n[Instrucciones adicionales del usuario]\n${systemInstruction}`
    : SYSTEM_INSTRUCTION;

  const result = await sendMessage(
    modelString,
    [{ role: "user", content: prompt }],
    fullSystem,
    {
      temperature: temperature ?? 0.4,
      maxOutputTokens: maxOutputTokens ?? 16384,
      responseMimeType: "application/json",
      responseSchema: SCRIPT_RESPONSE_SCHEMA,
    },
    labels,
    apiBackend,
  );

  let raw: RawAnalysis;
  try {
    raw = JSON.parse(result.text) as RawAnalysis;
  } catch {
    throw new Error("El modelo no devolvió un JSON válido. Intenta nuevamente.");
  }

  if (!raw.generalInfo || !Array.isArray(raw.scenes)) {
    throw new Error("El JSON devuelto no tiene la estructura esperada.");
  }

  const warnings: string[] = [];

  // Truncar a MAX_SCENES_PER_SCRIPT
  let scenes = raw.scenes;
  if (scenes.length > MAX_SCENES_PER_SCRIPT) {
    warnings.push(`El modelo devolvió ${scenes.length} escenas; se truncaron a ${MAX_SCENES_PER_SCRIPT}.`);
    scenes = scenes.slice(0, MAX_SCENES_PER_SCRIPT);
  }

  if (scenes.length === 0) {
    throw new Error("El modelo no detectó ninguna escena en el guion.");
  }

  // Validar literalidad: cada scene.text debe aparecer en el prompt original.
  // Tolerante a diferencias menores de whitespace para no fallar por trim del modelo.
  const normalizedPrompt = prompt.replace(/\s+/g, " ").trim();
  const validatedScenes: ScriptSceneAnalysis[] = [];
  let nonLiteralCount = 0;

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    if (!s.text || typeof s.text !== "string") continue;

    const normalizedScene = s.text.replace(/\s+/g, " ").trim();
    const isLiteral = normalizedPrompt.includes(normalizedScene);
    if (!isLiteral) nonLiteralCount++;

    validatedScenes.push({
      index: i + 1,                  // re-numerar 1..N por seguridad
      text: s.text,                  // mantener formato original tal cual lo devolvió
      targetNodeType: "image",       // default — el usuario puede cambiar por escena
    });
  }

  if (nonLiteralCount > 0) {
    warnings.push(`${nonLiteralCount} escena(s) podrían no ser literales del guion. Revísalas antes de generar.`);
  }

  const analysis: ScriptAnalysis = {
    generalInfo: raw.generalInfo,
    scenes: validatedScenes,
    analyzedAt: new Date().toISOString(),
    modelUsed: modelString,
  };

  return {
    analysis,
    warnings,
    tokenCount: result.tokenCount,
  };
}
