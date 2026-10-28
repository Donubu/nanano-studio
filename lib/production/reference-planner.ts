// "Fiel a la referencia": Gemini mira la imagen de referencia del productor y
// la describe como bloques (reference-layout.ts) para reconstruirla con
// capas editables, con los textos y el logo de la marca. Server-only.

import { generateJson } from "./gemini-json";
import type { Part } from "@google/genai";
import { BrandKitContent, makeRef } from "./brand-kit";
import { BrandGuide, brandGuideForModel } from "./brand-guide";
import { LayoutFixUsage } from "./layout-fixer";
import { LAYOUT_PLANNER_MODEL } from "./layout-planner";
import { REFERENCE_ROLES, REFERENCE_SHAPES, ReferenceLayout, sanitizeReferenceLayout } from "./reference-layout";

const SYSTEM_INSTRUCTION = `Eres diseñador senior de una agencia chilena. El productor te da una imagen de REFERENCIA y quiere una pieza que se le parezca de verdad: la misma composición, la misma jerarquía y el mismo estilo, pero con su marca y su mensaje.

Describe la referencia como bloques, en orden de atrás hacia adelante (primero fondos y fotos, al final textos y botones):
- role: ${REFERENCE_ROLES.join(", ")}.
  · headline = titular; subtitle = bajada; price = precio; cta = botón o llamado; badge = etiqueta o sello; legal = letra chica; text = otro texto; logo = donde la referencia tiene un logo (ahí va el de nuestra marca); image = cada foto o render; shape = bloques de color, franjas, marcos o fondos de color.
- x, y, w, h: caja en PORCENTAJE del formato (0-100), medida sobre la imagen de referencia. Sé preciso: es lo que hace que se parezca.
- color (texto) y background_color (relleno de shapes, botones y etiquetas): hex #RRGGBB que ves en la referencia.
- shape: rect, rounded, pill o circle (forma de botones, etiquetas y bloques).
- align, weight (100-900), uppercase: como se ve la tipografía.
- text: el texto para NUESTRA pieza, no el de la referencia: escríbelo desde el brief y la marca, en español de Chile, con el mismo largo aproximado que el de la referencia para que calce en la caja. Si la referencia tiene un precio y el brief o la marca no traen uno, usa role text con un mensaje sin precio; nunca inventes precios, ubicaciones, fechas ni condiciones (solo salen del brief o de brand_guide). El legal solo con textos de brand_guide.legales o del brief; si no hay, omite ese bloque.
- image_prompt (solo image): prompt EN INGLÉS para generar una foto equivalente para nuestra marca (mismo encuadre, luz y estilo que la foto de la referencia, sin texto ni logos).

aspect: la proporción de la referencia (horizontal si es más ancha que alta, square si es casi cuadrada, vertical si es más alta).
background: el color de fondo general (hex).

Colores: los de la referencia, salvo que las instrucciones pidan los de la marca; si la referencia tiene el logo o colores de otra marca reconocible, usa los de brand en esos roles. Si hay brand_guide, su voz, tratamiento, nombres y reglas mandan en los textos.
Máximo 14 bloques: junta textos que en la referencia son un mismo bloque. Responde solo con el JSON.`;

const SCHEMA = {
  type: "object",
  properties: {
    aspect: { type: "string", enum: ["horizontal", "square", "vertical"] },
    background: { type: "string" },
    blocks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          role: { type: "string", enum: [...REFERENCE_ROLES] },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
          text: { type: "string", maxLength: 200 },
          color: { type: "string" },
          background_color: { type: "string" },
          shape: { type: "string", enum: [...REFERENCE_SHAPES] },
          align: { type: "string", enum: ["left", "center", "right"] },
          weight: { type: "number" },
          uppercase: { type: "boolean" },
          image_prompt: { type: "string", maxLength: 600 },
        },
        required: ["role", "x", "y", "w", "h"],
      },
    },
  },
  required: ["aspect", "background", "blocks"],
};

export async function requestReferenceLayout(req: {
  images: { mimeType: string; data: string }[];
  intent?: string;
  instructions?: string;
  brandKit: BrandKitContent;
  brandGuide?: BrandGuide | null;
}): Promise<{ layout: ReferenceLayout; usage: LayoutFixUsage }> {
  const parts: Part[] = [];
  req.images.forEach((img, i) => {
    parts.push({ text: `Referencia ${i + 1} del productor (replica esta composición${i > 0 ? "; usa la primera como principal" : ""}):` });
    parts.push({ inlineData: { mimeType: img.mimeType, data: img.data } });
  });
  parts.push({
    text: JSON.stringify({
      brief: {
        ...(req.intent?.trim() ? { intent: req.intent.trim() } : {}),
        ...(req.instructions?.trim() ? { instructions: req.instructions.trim() } : {}),
      },
      brand: {
        colors: req.brandKit.colors.map((c) => ({ token: makeRef("color", c.name), label: c.label, value: c.value })),
        has_logo: req.brandKit.logos.length > 0,
      },
      ...(req.brandGuide ? { brand_guide: brandGuideForModel(req.brandGuide) } : {}),
    }),
  });
  const { data, usage } = await generateJson({
    model: LAYOUT_PLANNER_MODEL,
    systemInstruction: SYSTEM_INSTRUCTION,
    schema: SCHEMA,
    parts,
    temperature: 0.3,
    maxOutputTokens: 6144,
    operationName: "productionReferenceLayout",
  });
  const layout = sanitizeReferenceLayout(data);
  if (!layout) throw Object.assign(new Error("La IA no pudo describir la referencia"), { usage });
  return { layout, usage };
}
