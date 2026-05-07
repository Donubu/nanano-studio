import { sendMessage, type Labels } from "./google-ai";

const SYSTEM_INSTRUCTION = `Eres guionista de spots audiovisuales. Vas a recibir un texto que puede ser un claim publicitario, una narración, ideas sueltas, o un guion ya estructurado.

Tu tarea: TRANSFORMAR ese texto en un guion escenificado, listo para producción audiovisual. Donde el original solo tiene texto narrado o copy publicitario, tienes que proponer escenas concretas (locación, acción visual, encuadre) que acompañen ese texto.

FORMATO DE SALIDA (texto plano, una escena tras otra, separadas por una línea en blanco):

ESCENA 1 - INT./EXT. LUGAR - DÍA/NOCHE
ACCIÓN: <qué se ve. Describe el encuadre, los gestos, la ambientación, los detalles visuales relevantes. Sé concreto y cinemático, no abstracto.>
VO: <texto narrado en off, EXACTO del original cuando corresponda>
DIÁLOGO PERSONAJE: <texto dialogado de un personaje cuando corresponda>
S.I: <super impuesto / texto en pantalla, si el original lo trae>

ESCENA 2 - INT./EXT. ...
...

REGLAS DURAS:
- CONSERVA el copy del original. Si el original dice "Hay superpoderes que solo tiene una super mamá", esa frase aparece tal cual como VO o diálogo, NO la reescribas ni la parafrasees.
- Si el original trae "S.I:" o "SUPER" o texto en mayúscula sostenida que claramente es un super impuesto, mantenlo en la escena correspondiente como "S.I:".
- Cada beat narrativo del original = una escena. Si el original tiene 4 ideas, devuelves 4 escenas.
- Para CADA escena INVENTA la parte visual: locación concreta (ej: "INT. CASA - LIVING - DÍA"), acción específica (ej: "Mamá recibe a su hija con una rodilla raspada y le da un beso en la frente"), encuadre si aporta (ej: "Plano detalle del beso en la frente").
- Si el original ya tiene encabezados formales o ya está escenificado, mejóralo levemente y devuélvelo. NO inviertas el orden ni omitas partes.

REGLAS DE ESTILO:
- Idioma: español de Chile (tuteo). NO uses voseo ("decime", "podés", "querés"). Usa "dice", "puedes", "quieres".
- NO uses markdown, NO uses **negrita**, NO uses headers tipo "## ESCENA 1". Solo texto plano con las etiquetas literales "ESCENA N -", "ACCIÓN:", "VO:", "DIÁLOGO X:", "S.I:".
- NO agregues introducciones del tipo "Aquí está el guion:" ni cierres tipo "Espero que te guste". Solo el guion crudo, listo para usar.
- NO inventes copy nuevo que no esté implícito en el original. Tu trabajo es la parte visual, no el copywriting.
- Si el original tiene una marca o producto explícito (ej: "Super 10"), mantenlo intacto.

Tu salida será reemplazada directamente en el campo de guion para que después se pueda segmentar en escenas y generar imágenes/videos por escena. Hazla utilizable.`;

export interface StageScriptInput {
  modelString: string;        // model_id (ej: "gemini-2.5-pro")
  apiBackend?: string;
  prompt: string;             // texto bruto a escenificar
  temperature?: number;
  maxOutputTokens?: number;
  systemInstruction?: string; // instrucciones extra del usuario
  thinkingLevel?: "none" | "low" | "medium" | "high";
  labels?: Labels;
}

export interface StageScriptResult {
  stagedPrompt: string;
  tokenCount: { input: number; output: number };
}

/**
 * Transforma un texto bruto (claim, narración, ideas) en un guion escenificado
 * con locaciones, acción visual, VO/diálogo y super impuestos. No es JSON;
 * devuelve texto plano listo para volver a alimentar a "Leer guion".
 */
export async function stageScript(input: StageScriptInput): Promise<StageScriptResult> {
  const { modelString, apiBackend, prompt, temperature, maxOutputTokens, systemInstruction, thinkingLevel, labels } = input;

  if (!prompt || !prompt.trim()) {
    throw new Error("El texto del guion está vacío.");
  }

  const fullSystem = systemInstruction
    ? `${SYSTEM_INSTRUCTION}\n\n[Instrucciones adicionales del usuario]\n${systemInstruction}`
    : SYSTEM_INSTRUCTION;

  const result = await sendMessage(
    modelString,
    [{ role: "user", content: prompt }],
    fullSystem,
    {
      // More creative than literal segmentation — needs to invent visuals.
      temperature: temperature ?? 0.85,
      maxOutputTokens: maxOutputTokens ?? 8192,
      thinkingLevel: thinkingLevel ?? "none",
    },
    labels,
    apiBackend,
  );

  const stagedPrompt = result.text.trim();
  if (!stagedPrompt) {
    throw new Error("El modelo no devolvió un guion escenificado.");
  }

  return {
    stagedPrompt,
    tokenCount: result.tokenCount,
  };
}
