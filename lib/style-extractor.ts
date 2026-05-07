import { sendMessage, type AttachedFile, type Labels } from "./google-ai";

const SYSTEM_INSTRUCTION = `Vas a recibir una o varias imágenes de referencia. Tu tarea es extraer SOLO los rasgos visuales y técnicos para usarlos como modificador de estilo en un prompt de imagen/video.

REGLAS ESTRICTAS:
- Describe ÚNICAMENTE: paleta de colores, iluminación, contraste, técnica fotográfica/audiovisual, encuadre, ángulos, tipos de plano (close-up, plano medio, plano general, picado, contrapicado, etc.), profundidad de campo, lente equivalente sugerido, grano/textura, tono, mood visual, estilo gráfico (fotográfico, ilustrado, 3D, anime, comic, etc.), tratamiento de imagen, atmósfera.
- NO menciones: locaciones específicas (ej. "una calle de París"), identidades de personas, objetos narrativos, eventos o acciones, personajes (sus rasgos identitarios), contenido temático ni argumento.
- Si hay personas, describe SOLO su tratamiento visual (encuadre, iluminación sobre ellas, etc.), no su identidad ni rol.

FORMATO DE SALIDA:
- Un PROMPT compacto y denso de estilo, en español de Chile (tuteo).
- 2 a 4 oraciones, separadas por punto seguido o coma.
- Sin markdown, sin listas con bullets, sin headers, sin code fences, sin etiquetas tipo "Estilo:".
- Solo la descripción cruda lista para concatenar a un prompt.`;

export interface ExtractStyleInput {
  modelString: string;        // model_id text+vision (ej: "gemini-2.5-flash" o pro)
  apiBackend?: string;
  imageUrls: string[];
  temperature?: number;
  labels?: Labels;
}

export interface ExtractStyleResult {
  stylePrompt: string;
  tokenCount: { input: number; output: number };
}

async function fetchImageAsDataUrl(url: string): Promise<{ dataUrl: string; mimeType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`No se pudo descargar imagen: ${res.status}`);
  const mimeType = res.headers.get("content-type") || "image/png";
  const buf = Buffer.from(await res.arrayBuffer());
  const base64 = buf.toString("base64");
  return {
    dataUrl: `data:${mimeType};base64,${base64}`,
    mimeType,
  };
}

/**
 * Llama a un modelo multimodal con las imágenes como input. Devuelve un prompt
 * de estilo compacto, listo para concatenar como modificador en un Params Escena.
 */
export async function extractStyleFromImages(input: ExtractStyleInput): Promise<ExtractStyleResult> {
  const { modelString, apiBackend, imageUrls, temperature, labels } = input;

  if (!imageUrls || imageUrls.length === 0) {
    throw new Error("Se requiere al menos una imagen de referencia.");
  }

  // Fetch + base64 each image. Limit to first 10 to keep request manageable.
  const limit = Math.min(imageUrls.length, 10);
  const files: AttachedFile[] = [];
  for (let i = 0; i < limit; i++) {
    const { dataUrl, mimeType } = await fetchImageAsDataUrl(imageUrls[i]);
    files.push({
      dataUrl,
      mimeType,
      type: "image",
      name: `ref-${i + 1}`,
    });
  }

  const result = await sendMessage(
    modelString,
    [
      {
        role: "user",
        content:
          "Analiza estas imágenes y devuelve solo el prompt de estilo según las reglas del system prompt. No agregues prefijos, comentarios ni etiquetas — solo el prompt crudo.",
        files,
      },
    ],
    SYSTEM_INSTRUCTION,
    {
      temperature: temperature ?? 0.5,
      maxOutputTokens: 1024,
    },
    labels,
    apiBackend,
  );

  const stylePrompt = result.text.trim();
  if (!stylePrompt) {
    throw new Error("El modelo no devolvió un prompt de estilo.");
  }

  return {
    stylePrompt,
    tokenCount: result.tokenCount,
  };
}
