// Pedido a Gemini de la verificación visual de "Fiel a la referencia":
// ve la referencia y nuestro render, y devuelve fidelidad + correcciones
// chicas por capa (reference-verify.ts las aplica con topes). Server-only.

import { generateJson } from "./gemini-json";
import type { Part } from "@google/genai";
import { LAYOUT_PLANNER_MODEL } from "./layout-planner";
import type { LayoutFixUsage } from "./layout-fixer";
import { sanitizeVerification, type ReferenceVerification, type VerifyLayer } from "./reference-verify";

const SYSTEM_INSTRUCTION = `Eres director de arte. Comparas una REFERENCIA con nuestro RENDER (una pieza armada en capas para parecerse a la referencia) y dices qué ajustar para que el render sea fiel.

Mides sobre la referencia y comparas con las capas del render (cada una con su caja en % del formato, 0-100). Para cada capa que esté corrida, de otro tamaño, con otro color o que la referencia no tenga, devuelve una corrección:
- x, y, w, h: la caja donde ESA capa está en la referencia (en % del formato). Solo los campos que cambian. Precisión de 1%.
- color (textos) y background_color (bloques, botones, etiquetas, fondos de texto): hex #RRGGBB que ves en la referencia.
- font_scale: multiplicador del tamaño de letra si en la referencia el texto se ve claramente más grande o más chico (0.6 a 1.6).
- hidden: true si la referencia no tiene nada en esa posición (un elemento que sobra).
No inventes capas nuevas ni cambies textos. Si una capa ya calza (±2%), no la incluyas.

fidelity: 0-100, cuánto se parece el render a la referencia en composición, tamaños, colores y jerarquía ANTES de tus correcciones (100 = indistinguible).
summary: una frase en español de Chile con lo principal que corregiste.
Responde solo con el JSON.`;

const SCHEMA = {
  type: "object",
  properties: {
    fidelity: { type: "number" },
    summary: { type: "string", maxLength: 300 },
    corrections: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
          color: { type: "string" },
          background_color: { type: "string" },
          font_scale: { type: "number" },
          hidden: { type: "boolean" },
        },
        required: ["id"],
      },
    },
  },
  required: ["fidelity", "summary", "corrections"],
};

export async function requestReferenceVerification(req: {
  reference: { mimeType: string; data: string };
  render: { mimeType: string; data: string };
  layers: VerifyLayer[];
  pass: number;
  abortSignal?: AbortSignal;
}): Promise<{ verification: ReferenceVerification; usage: LayoutFixUsage }> {
  const parts: Part[] = [
    { text: "REFERENCIA (la pieza original del productor):" },
    { inlineData: { mimeType: req.reference.mimeType, data: req.reference.data } },
    { text: `RENDER (nuestra pieza, pasada ${req.pass}):` },
    { inlineData: { mimeType: req.render.mimeType, data: req.render.data } },
    { text: JSON.stringify({ layers: req.layers }) },
  ];
  const { data, usage } = await generateJson({
    model: LAYOUT_PLANNER_MODEL,
    systemInstruction: SYSTEM_INSTRUCTION,
    schema: SCHEMA,
    parts,
    temperature: 0.2,
    maxOutputTokens: 4096,
    operationName: "productionReferenceVerify",
    abortSignal: req.abortSignal,
  });
  const verification = sanitizeVerification(data);
  if (!verification) throw Object.assign(new Error("La IA no pudo comparar con la referencia"), { usage });
  return { verification, usage };
}
