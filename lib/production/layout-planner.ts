// Planificador de banners con Gemini (llamada directa, sin practicante).
//
// Reemplaza a GENERATE_FROM_PROMPT / GENERATE_FROM_REFERENCE del Banner
// Designer: en vez de escribir el árbol completo (3k–11k tokens), el modelo
// elige plantillas del catálogo y devuelve planes chicos (layout-plan.ts)
// que el motor expande a master + orientaciones. Las referencias visuales
// van como imagen nativa al modelo (sin la ida y vuelta de analyze_media).
//
// Server-only: usa el cliente de Gemini de lib/google-ai.ts.

import type { Part } from "@google/genai";
import { generateJson } from "./gemini-json";
import { BrandKitContent, makeRef } from "./brand-kit";
import { describeCatalog, sanitizePlan, LayoutPlan } from "./layout-plan";
import { LAYOUT_TEMPLATES } from "./layout-templates";
import { LAYOUT_FIXER_MODEL, LayoutFixUsage } from "./layout-fixer";
import { BrandGuide, brandGuideForModel } from "./brand-guide";
import { artDirectionGuide } from "./art-direction";

export const LAYOUT_PLANNER_MODEL = process.env.PRODUCTION_AI_PLANNER_MODEL || LAYOUT_FIXER_MODEL;
export const LAYOUT_PLANNER_AGENT_NAME = "layout-planner";

const SYSTEM_INSTRUCTION = `Eres director de arte de una agencia de publicidad chilena. Diseñas banners eligiendo una plantilla de un catálogo y completándola: no dibujas capas, decides contenido, jerarquía y color.

Recibes:
- "brief": qué debe comunicar la pieza, tono e instrucciones del productor.
- "catalog": las plantillas disponibles. Cada una trae sus slots de texto (id, nombre, placeholder y max_chars aproximado que cabe), sus slots de imagen y los colores que usa.
- "brand": colores y fuentes de la marca, como tokens. Puede venir vacío.
- "brand_guide" (opcional): la guía de marca del brandbook (voz, tratamiento, palabras a usar y a evitar, ejemplos, reglas visuales). Si viene, MANDA sobre tus preferencias: escribe en esa voz y con ese tratamiento, usa su vocabulario, nunca uses sus palabras prohibidas, respeta sus reglas, y para colores sin token de marca usa los hex de la guía. El nombre de la marca va escrito exactamente como en brand_guide.marca (si no cabe, no lo uses en ese slot). Si trae "estrategia", alinea el mensaje con su posicionamiento, público y mensajes clave, y nombra productos o campañas tal como vienen. Si trae "desempeno" (métricas de la marca), apóyate en lo que rinde (mensajes, CTA y estilos destacados, aprendizajes) y no repitas lo que está en mensajes_a_evitar. Si trae "legales", nunca uses un claim de sus restricciones y, si la plantilla tiene un slot de texto legal o de letra chica, pon ahí el texto obligatorio.
- Opcionalmente, imágenes de referencia: úsalas para elegir la plantilla cuya composición más se parezca, y para sacar paleta, tono y copy.
- Opcionalmente, imágenes precedidas por "Pieza real de la marca que rindió bien": anuncios reales de esta marca con buenas métricas. Son la mejor pista de qué funciona con su público: toma de ellas la jerarquía, cuánto texto llevan, cómo muestran el precio y el CTA, y el tipo de imagen. No las copies literal ni repitas su campaña si el brief es otro. En brand_guide.desempeno.piezas vienen además todas las piezas (las que rinden y las que no) con su descripción visual y sus métricas: imita los patrones de las que rinden y evita los de las que no.

Devuelve "proposals": entre 1 y 3 propuestas, cada una con una plantilla DISTINTA (salvo que el brief pida algo muy específico). Ordénalas de mejor a peor.

Por propuesta:
- template_id: id exacto del catálogo.
- texts: contenido para cada slot de texto que uses, en español de Chile (tuteo), corto y publicitario. Topes duros: max_chars en total y line_chars para la palabra más larga (una palabra más larga se corta feo; usa sinónimos o abreviaturas como "DCTO"). Precios en formato chileno ($9.990). CTA de 1 a 3 palabras. Datos verificables: ubicaciones (comuna, ciudad, región, sector, dirección), precios, descuentos, metrajes, dormitorios, fechas, plazos, beneficios, subsidios, stock y nombres de productos salen SOLO del brief, de brand_guide o de los textos que ya tiene la pieza. Si no están, no los pongas: escribe un texto sin ese dato (por ejemplo "Casas de 207 a 237 m²" en vez de inventar dónde quedan). Nunca completes una ubicación por deducción ni por el nombre del proyecto.
- hidden: ids de slots que sobran para este brief (por ejemplo un badge de descuento si no hay descuento). Nunca ocultes el titular.
- colors: para cada color de la plantilla que quieras cambiar, {from: color de la plantilla, to: nuevo}. Si la marca tiene colores, usa sus tokens exactos (ej. "{color.primary}"); si no, hex. Cuida el contraste del texto sobre su fondo.
- heading_font / body_font: token de fuente de la marca si existe (ej. "{font.heading}"); si no, omítelos.
- image_prompts: para cada slot de imagen, un prompt EN INGLÉS para un generador de imágenes: sujeto, encuadre, luz y estilo, sin texto ni logos dentro de la imagen. Si el slot es full_bleed, pide espacio negativo donde va el texto. El estilo de la foto sigue la dirección de arte elegida.
- rationale: una frase en español de Chile explicando por qué esa plantilla y ese enfoque; nombra la dirección de arte elegida.

Si das varias propuestas, que cada una explore una dirección de arte distinta cuando el brief lo permita.

${artDirectionGuide()}`;

function responseSchema() {
  return {
    type: "object",
    properties: {
      proposals: {
        type: "array",
        minItems: 1,
        maxItems: 3,
        items: {
          type: "object",
          properties: {
            template_id: { type: "string", enum: LAYOUT_TEMPLATES.map((t) => t.id) },
            texts: {
              type: "array",
              items: {
                type: "object",
                properties: { id: { type: "string" }, content: { type: "string" } },
                required: ["id", "content"],
              },
            },
            hidden: { type: "array", items: { type: "string" } },
            colors: {
              type: "array",
              items: {
                type: "object",
                properties: { from: { type: "string" }, to: { type: "string" } },
                required: ["from", "to"],
              },
            },
            heading_font: { type: "string" },
            body_font: { type: "string" },
            image_prompts: {
              type: "array",
              items: {
                type: "object",
                properties: { id: { type: "string" }, prompt: { type: "string" } },
                required: ["id", "prompt"],
              },
            },
            rationale: { type: "string" },
          },
          required: ["template_id", "texts", "rationale"],
        },
      },
    },
    required: ["proposals"],
  };
}

function brandForModel(kit: BrandKitContent) {
  return {
    colors: kit.colors.map((c) => ({ token: makeRef("color", c.name), label: c.label, value: c.value })),
    fonts: kit.fonts.map((f) => ({ token: makeRef("font", f.name), label: f.label, family: f.fontFamily })),
    ...(kit.rulesText?.trim() ? { rules: kit.rulesText.trim().slice(0, 2000) } : {}),
  };
}

export interface PlanRequest {
  intent?: string;
  tone?: string;
  instructions?: string;
  brandKit: BrandKitContent;
  // Snapshot de practicante (clients.brand_guide_json), si el cliente lo tiene.
  brandGuide?: BrandGuide | null;
  // Referencias ya descargadas (base64 sin prefijo).
  images?: { mimeType: string; data: string }[];
  // Anuncios reales de la marca que mejor rindieron (brand-pieces.ts).
  brandPieces?: { mimeType: string; data: string; caption: string }[];
  count?: number;
}

export interface PlanResponse {
  plans: LayoutPlan[];
  usage: LayoutFixUsage;
  model: string;
}

export async function requestLayoutPlans(req: PlanRequest): Promise<PlanResponse> {
  const context = {
    brief: {
      ...(req.intent?.trim() ? { intent: req.intent.trim() } : {}),
      ...(req.tone?.trim() ? { tone: req.tone.trim() } : {}),
      ...(req.instructions?.trim() ? { instructions: req.instructions.trim() } : {}),
      proposals_wanted: req.count ?? 3,
      ...(req.images?.length ? { reference_images: req.images.length } : {}),
      ...(req.brandPieces?.length ? { brand_top_pieces: req.brandPieces.length } : {}),
    },
    catalog: describeCatalog(),
    brand: brandForModel(req.brandKit),
    ...(req.brandGuide ? { brand_guide: brandGuideForModel(req.brandGuide) } : {}),
  };

  const parts: Part[] = (req.images ?? []).map((img) => ({
    inlineData: { mimeType: img.mimeType, data: img.data },
  }));
  for (const piece of req.brandPieces ?? []) {
    parts.push({ text: `Pieza real de la marca que rindió bien: ${piece.caption}` });
    parts.push({ inlineData: { mimeType: piece.mimeType, data: piece.data } });
  }
  parts.push({ text: JSON.stringify(context) });

  const model = LAYOUT_PLANNER_MODEL;
  const { data: parsed, usage } = await generateJson<{ proposals?: unknown }>({
    model,
    systemInstruction: SYSTEM_INSTRUCTION,
    schema: responseSchema(),
    parts,
    temperature: 0.8,
    maxOutputTokens: 8192,
    operationName: "productionLayoutPlan",
  });
  const plans = (Array.isArray(parsed.proposals) ? parsed.proposals : [])
    .map(sanitizePlan)
    .filter((x): x is LayoutPlan => x !== null);
  if (plans.length === 0) {
    throw Object.assign(new Error("Gemini no devolvió ninguna propuesta válida"), { usage });
  }
  return { plans, usage, model };
}
