// "Pídele a la IA" del editor: Gemini traduce una instrucción en lenguaje
// natural a operaciones de edición (edit-ops.ts) sobre la pieza actual.
// Server-only.

import { generateJson } from "./gemini-json";
import type { TemplateDefinition, TemplateLayer } from "./types";
import { isVisibleLayer, isBackgroundLayer, effectiveFontSize, safeMargin } from "./layout-lint";
import { LAYOUT_FIXER_MODEL, LayoutFixUsage } from "./layout-fixer";
import { BrandKitContent, makeRef } from "./brand-kit";
import { BrandGuide, brandGuideForModel } from "./brand-guide";
import { ICON_NAMES } from "./icon-catalog";
import { EDIT_OPS, ADD_KINDS, EditOp } from "./edit-ops";

export const EDIT_PLANNER_MODEL = process.env.PRODUCTION_AI_EDIT_MODEL || LAYOUT_FIXER_MODEL;
export const EDIT_PLANNER_AGENT_NAME = "edit-planner";

const SYSTEM_INSTRUCTION = `Eres el asistente de diseño dentro del editor de banners de una agencia chilena. El productor te pide un cambio en lenguaje natural sobre la pieza abierta y tú lo traduces a operaciones concretas. No dibujas: devuelves operaciones que el editor aplica.

Operaciones ("op"):
- set_text {id, content}: cambia el texto de una capa de texto.
- update {id, x?, y?, w?, h?, font_size?, font_weight?, color?, background_color?, align?, hidden?, icon_name?, focal_x?, focal_y?, fit?}: mueve, redimensiona o cambia estilo de una capa existente. background_color en un texto lo vuelve botón/badge. En imágenes, focal_x/focal_y (0-100, porcentaje del ancho y alto DE LA FOTO) es el punto que queda visible cuando la foto se recorta para llenar su caja (fit "cover"); "contain" la muestra completa sin recortar.
- add {kind, x, y, w, h, content?, font_size?, font_weight?, color?, background_color?, align?, icon_name?, image_prompt?}: agrega una capa. kind: ${ADD_KINDS.join(", ")}. "button" y "badge" son textos con fondo (pastilla y círculo). Para "image" incluye image_prompt si hay que generarla; una imagen que cubre todo el formato queda de fondo.
- remove {id}: quita una capa.
- set_background {color}: color de fondo de la pieza.
- generate_image {id, image_prompt}: genera con IA la imagen de una capa de imagen existente.
- frame_subject {id, subject_x, subject_y, target_x?, target_y?}: reencuadra una foto para que su sujeto quede en un punto de la pieza. subject_x/subject_y = dónde está el sujeto DENTRO DE LA FOTO adjunta (0-100 del ancho y alto de la foto; mira la imagen). target_x/target_y = dónde debe quedar en la pieza (0-100 del formato; default 50/50 = centro). El editor calcula zoom, posición y punto focal exactos: úsala siempre para "centra a la persona", "que se vea el producto", "corre la foto"; no calcules x/y/focal a mano.

Imágenes adjuntas: las fotos de las capas de imagen vienen como imágenes, cada una precedida por el texto "Capa <id>". Míralas para entender qué muestran (dónde está la persona o el producto, qué tan clara u oscura es cada zona) antes de reencuadrar, poner texto encima o elegir colores. Para reencuadrar usa frame_subject con la posición del sujeto que ves en la foto. Si el sujeto debe quedar al lado del texto, elige un target que no choque con los textos (por ejemplo target_x 70 si los textos están a la izquierda).

Reglas:
1. Haz exactamente lo que se pide, nada más. Si piden "una imagen" o "una foto" y no hay capa de imagen adecuada, agrégala con add kind image + image_prompt; si ya hay una capa de imagen que calza, usa generate_image.
2. Si hay capas seleccionadas ("selected"), "esto", "este texto", "la imagen" se refieren a ellas.
3. Coordenadas en px, origen arriba a la izquierda. Todo lo nuevo dentro del formato y del margen de seguridad, sin tapar el titular ni el CTA salvo que lo pidan. Busca espacio libre mirando las cajas existentes.
4. Textos en español de Chile (tuteo), cortos y publicitarios. Precios en formato chileno ($9.990). Si hay brand_guide, respeta su voz, vocabulario y reglas, y escribe el nombre de la marca tal cual.
5. Colores: tokens de "brand" (ej. "{color.primary}") cuando existan; si no, hex. En toda capa nueva de texto, ícono o forma indica "color" pensando en lo que tiene detrás (sobre una foto oscura, claro; sobre fondo claro, oscuro).
6. image_prompt EN INGLÉS para un generador de imágenes: sujeto, encuadre, luz y estilo; sin texto, letras ni logos dentro de la imagen. Si la imagen va de fondo, pide espacio negativo donde está el texto.
7. icon_name solo de esta lista: ${ICON_NAMES.join(", ")}.
8. Si el pedido no se puede hacer con estas operaciones, devuelve ops vacío y explícalo en rationale.

"rationale": una frase en español de Chile explicando qué hiciste.`;

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    // Sin maxItems: con este schema Gemini responde 400 (el tope se aplica
    // en código, abajo).
    ops: {
      type: "array",
      items: {
        type: "object",
        properties: {
          op: { type: "string", enum: [...EDIT_OPS] },
          id: { type: "string" },
          kind: { type: "string", enum: [...ADD_KINDS] },
          x: { type: "number" },
          y: { type: "number" },
          w: { type: "number" },
          h: { type: "number" },
          content: { type: "string", maxLength: 300 },
          font_size: { type: "number" },
          font_weight: { type: "number" },
          color: { type: "string" },
          background_color: { type: "string" },
          align: { type: "string", enum: ["left", "center", "right"] },
          hidden: { type: "boolean" },
          icon_name: { type: "string" },
          image_prompt: { type: "string", maxLength: 800 },
          focal_x: { type: "number" },
          focal_y: { type: "number" },
          fit: { type: "string", enum: ["cover", "contain"] },
          subject_x: { type: "number" },
          subject_y: { type: "number" },
          target_x: { type: "number" },
          target_y: { type: "number" },
        },
        required: ["op"],
      },
    },
    rationale: { type: "string", maxLength: 400 },
  },
  required: ["ops", "rationale"],
};

const r = (n: number) => Math.round(n);

function describe(l: TemplateLayer, frame: { w: number; h: number }): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: l.id,
    type: l.type,
    ...(l.name ? { name: l.name } : {}),
    x: r(l.position.x),
    y: r(l.position.y),
    w: r(l.size.w),
    h: r(l.size.h),
  };
  if (!isVisibleLayer(l)) out.hidden = true;
  if (isBackgroundLayer(l, frame)) out.background = true;
  if (l.type === "text") {
    out.text = l.content.replace(/\s+/g, " ").trim().slice(0, 200);
    const fs = effectiveFontSize(l);
    if (fs != null) out.font_size = r(fs);
    out.color = l.style.color;
    if (l.style.backgroundColor) out.background_color = l.style.backgroundColor;
  }
  if (l.type === "shape") out.fill = l.fill;
  if (l.type === "icon") {
    out.icon_name = l.iconName;
    out.color = l.color;
  }
  if (l.type === "image") {
    out.has_image = l.src != null;
    out.fit = l.fit ?? "cover";
    out.focal = { x: l.focalX ?? 50, y: l.focalY ?? 50 };
  }
  if (l.type === "frame") out.children = l.children.map((c) => describe(c, l.size));
  return out;
}

export interface EditPlanRequest {
  // Árbol tal cual (con tokens, sin resolver): así el modelo conserva las
  // referencias de marca al editar colores.
  tree: TemplateDefinition;
  instruction: string;
  selectedIds: string[];
  brandKit: BrandKitContent;
  brandGuide?: BrandGuide | null;
  // Fotos de capas de imagen (ya descargadas), para que el modelo las vea.
  layerImages?: { layerId: string; mimeType: string; data: string }[];
}

export async function requestEditPlan(
  req: EditPlanRequest,
): Promise<{ ops: EditOp[]; rationale: string; usage: LayoutFixUsage; model: string }> {
  const context = {
    instruction: req.instruction,
    ...(req.selectedIds.length ? { selected: req.selectedIds } : {}),
    format: { w: r(req.tree.size.w), h: r(req.tree.size.h), safe_margin: safeMargin(req.tree.size) },
    background: req.tree.background?.type === "color" ? req.tree.background.value : null,
    layers: req.tree.children.map((l) => describe(l, req.tree.size)),
    brand: {
      colors: req.brandKit.colors.map((c) => ({ token: makeRef("color", c.name), label: c.label, value: c.value })),
      fonts: req.brandKit.fonts.map((f) => ({ token: makeRef("font", f.name), family: f.fontFamily })),
    },
    ...(req.brandGuide ? { brand_guide: brandGuideForModel(req.brandGuide) } : {}),
  };
  const model = EDIT_PLANNER_MODEL;
  const { data: parsed, usage } = await generateJson<{ ops?: unknown; rationale?: unknown }>({
    model,
    systemInstruction: SYSTEM_INSTRUCTION,
    schema: RESPONSE_SCHEMA,
    parts: [
      ...(req.layerImages ?? []).flatMap((img) => [
        { text: `Capa ${img.layerId}` },
        { inlineData: { mimeType: img.mimeType, data: img.data } },
      ]),
      { text: JSON.stringify(context) },
    ],
    temperature: 0.4,
    // Tope bajo: si el modelo entra en un bucle de texto, falla rápido y
    // generateJson reintenta, en vez de gastar 30 s escribiendo basura.
    maxOutputTokens: 2048,
    operationName: "productionEditPlan",
  });
  const ops = (Array.isArray(parsed.ops) ? parsed.ops : [])
    .filter((o): o is EditOp => !!o && typeof o === "object" && (EDIT_OPS as readonly string[]).includes((o as EditOp).op))
    .slice(0, 20);
  return { ops, rationale: typeof parsed.rationale === "string" ? parsed.rationale : "", usage, model };
}
