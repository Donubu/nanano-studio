import { sendMessage, type Labels } from "./google-ai";
import type {
  ScriptAnalysis,
  ScriptAnalysisAlt,
  ScriptGeneralInfo,
  ScriptSceneAnalysis,
} from "@/components/canvas/lib/canvas-types";
import { MAX_SCENES_PER_SCRIPT } from "@/components/canvas/lib/canvas-types";

const generalInfoSchema = {
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
};

const scenesSchema = {
  type: "array",
  items: {
    type: "object",
    required: ["index", "text"],
    properties: {
      index: { type: "integer" },
      text: { type: "string" },
    },
  },
};

const SCRIPT_RESPONSE_SCHEMA: object = {
  type: "object",
  required: ["alternatives"],
  properties: {
    alternatives: {
      type: "array",
      items: {
        type: "object",
        required: ["label", "approach", "generalInfo", "scenes"],
        properties: {
          label: { type: "string" },
          approach: { type: "string" },
          generalInfo: generalInfoSchema,
          scenes: scenesSchema,
        },
      },
    },
  },
};

const SYSTEM_INSTRUCTION = `Eres un analista de guiones audiovisuales. Vas a recibir del usuario un texto que puede ser:
- un guion formal (con encabezados tipo "INT./EXT. LUGAR - DÍA/NOCHE"),
- prosa narrativa libre (cuento, narración, brief publicitario),
- o algo mixto.

REGLA CRÍTICA: Bajo NINGÚN concepto puedes modificar, parafrasear, traducir, resumir, corregir, "limpiar" ni reescribir el texto del guion. Cada porción que devuelvas como "scene.text" debe ser una sub-cadena LITERAL del texto original — exactamente los mismos caracteres (incluidos saltos de línea, mayúsculas, encabezados de escena, acotaciones, signos de puntuación). Si modificas una sola palabra, rompes el contrato.

Tu tarea es analizar el texto y devolver EXACTAMENTE 3 ALTERNATIVAS de análisis del MISMO texto, cada una con un criterio de segmentación distinto. El JSON tiene la forma { "alternatives": [Alt1, Alt2, Alt3] }.

ALTERNATIVA 1 — label: "Detallada"
- Segmentación fina: cada cambio sutil cuenta como nueva escena.
- Inicia escena en cualquier cambio de ubicación, salto temporal (incluso pequeño), entrada/salida de personajes que cambia la dinámica, cambio de modalidad (interior/exterior, sueño, recuerdo, flashback).
- Tiende a producir más escenas, más cortas.

ALTERNATIVA 2 — label: "Equilibrada"
- Segmentación clásica: cada beat narrativo completo es una escena.
- Inicia escena en encabezados formales (si los hay), cambios significativos de lugar/tiempo, transiciones narrativas claras.
- Equilibrio entre detalle y agrupación.

ALTERNATIVA 3 — label: "Compacta"
- Segmentación amplia: bloques narrativos sustanciales que agrupan secuencias afines del mismo arco.
- Tiende a producir menos escenas, más extensas.

Para cada alternativa devuelve:
- "label": exactamente "Detallada", "Equilibrada" o "Compacta".
- "approach": una oración en español de Chile (tuteo) que describe el criterio de segmentación aplicado.
- "generalInfo": (lo escribes tú, en español de Chile, tuteo)
  - synopsis: 2 a 4 oraciones que resumen la historia general.
  - tone: tono dominante (ej: "drama íntimo", "comedia ligera", "thriller psicológico").
  - genre: género principal.
  - visualStyle: estilo visual sugerido (paleta, encuadres, ritmo).
  - characters: array con personajes principales (name, description).
  - settings: array con locaciones principales (name, description).
- "scenes": array donde cada escena es una porción CONTIGUA y LITERAL del texto original.
  - "index" parte en 1 y avanza secuencialmente.
  - "text" es la porción literal.
  - Máximo ${MAX_SCENES_PER_SCRIPT} escenas por alternativa.

Reglas de segmentación que aplican a las 3 alternativas:
- NO requieras encabezados formales para detectar escenas. Si el texto es prosa libre, segmenta por los criterios narrativos descritos arriba.
- Si tienes dudas sobre cortar un beat, prefiere escena más larga que más corta — NO partas un beat narrativo a la mitad.
- Si el texto es muy corto y describe una sola unidad de acción contigua, está bien que las 3 alternativas devuelvan UNA sola escena. No fuerces divisiones artificiales.
- "generalInfo" puede coincidir entre las 3 alternativas (es el mismo guion). Lo que VARÍA realmente es la granularidad de "scenes".
- NO dejes ninguna parte del texto fuera de las escenas. La concatenación de scene.text de cualquier alternativa debe poder reconstruir el contenido relevante del guion (puede haber whitespace de transición entre escenas).`;

interface RawScene {
  index: number;
  text: string;
}

interface RawAlternative {
  label: string;
  approach: string;
  generalInfo: ScriptGeneralInfo;
  scenes: RawScene[];
}

interface RawAnalysis {
  alternatives: RawAlternative[];
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
  analyses: ScriptAnalysisAlt[]; // hasta 3 alternativas
  warnings: string[];
  tokenCount: { input: number; output: number };
}

/**
 * Llama a Gemini con structured output, valida que el modelo no haya modificado
 * el guion (cada scene.text debe aparecer literal en el prompt original) y
 * devuelve hasta 3 alternativas de análisis junto con warnings sobre truncado
 * o inconsistencias.
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
      // Three alternatives need more output room than a single analysis.
      maxOutputTokens: maxOutputTokens ?? 32768,
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

  if (!raw.alternatives || !Array.isArray(raw.alternatives) || raw.alternatives.length === 0) {
    throw new Error("El JSON devuelto no tiene la estructura esperada (sin alternatives).");
  }

  const warnings: string[] = [];
  const normalizedPrompt = prompt.replace(/\s+/g, " ").trim();
  const analyses: ScriptAnalysisAlt[] = [];
  const analyzedAt = new Date().toISOString();

  for (let aIdx = 0; aIdx < raw.alternatives.length; aIdx++) {
    const alt = raw.alternatives[aIdx];
    if (!alt.generalInfo || !Array.isArray(alt.scenes)) {
      warnings.push(`Alternativa ${aIdx + 1} ignorada (estructura inválida).`);
      continue;
    }

    let scenes = alt.scenes;
    if (scenes.length > MAX_SCENES_PER_SCRIPT) {
      warnings.push(`Alternativa "${alt.label || aIdx + 1}" devolvió ${scenes.length} escenas; se truncaron a ${MAX_SCENES_PER_SCRIPT}.`);
      scenes = scenes.slice(0, MAX_SCENES_PER_SCRIPT);
    }
    if (scenes.length === 0) {
      warnings.push(`Alternativa "${alt.label || aIdx + 1}" no detectó ninguna escena, se omite.`);
      continue;
    }

    const validatedScenes: ScriptSceneAnalysis[] = [];
    let nonLiteralCount = 0;
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      if (!s.text || typeof s.text !== "string") continue;
      const normalizedScene = s.text.replace(/\s+/g, " ").trim();
      if (!normalizedPrompt.includes(normalizedScene)) nonLiteralCount++;
      validatedScenes.push({
        index: i + 1,
        text: s.text,
        targetNodeType: "image",
      });
    }
    if (nonLiteralCount > 0) {
      warnings.push(`Alternativa "${alt.label || aIdx + 1}": ${nonLiteralCount} escena(s) podrían no ser literales del guion.`);
    }

    analyses.push({
      label: alt.label,
      approach: alt.approach,
      generalInfo: alt.generalInfo,
      scenes: validatedScenes,
      analyzedAt,
      modelUsed: modelString,
    });
  }

  if (analyses.length === 0) {
    throw new Error("Ninguna alternativa válida fue devuelta por el modelo.");
  }

  return {
    analyses,
    warnings,
    tokenCount: result.tokenCount,
  };
}
