// Zod schema para validar TemplateDefinition cuando viene de fuente externa
// (típicamente el agente Banner Designer). El motor del editor es tolerante
// con definiciones malformadas pero el roundtrip IA → guardar → render no
// puede aceptar JSON inválido sin riesgo de romper la UI.
//
// La validación tiene dos capas:
//   1. Forma estructural via z.parse (tipos, requeridos, formato de IDs).
//   2. Reglas semánticas via validateSemantics (IDs únicos, capas dentro del
//      canvas, root con id "tpl_root", etc.).
//
// Devuelve { ok: true, definition } o { ok: false, error } con un mensaje
// específico que se le devuelve al agente en el retry para que corrija.

import { z } from "zod";
import { TemplateDefinition, TemplateLayer } from "./types";

// IDs: alfanuméricos + - + _. No permitimos espacios ni caracteres raros
// para que sean usables como keys, anchors HTML, etc.
const idSchema = z.string().regex(/^[a-zA-Z0-9_-]+$/, {
  message: "ids deben ser alfanuméricos con - o _ (sin espacios)",
});

const positionSchema = z.object({
  x: z.number().int().min(0),
  y: z.number().int().min(0),
});

const sizeSchema = z.object({
  w: z.number().int().min(1).max(10000),
  h: z.number().int().min(1).max(10000),
});

const constraintH = z.enum(["left", "right", "center", "stretch", "scale"]);
const constraintV = z.enum(["top", "bottom", "center", "stretch", "scale"]);
const constraintsSchema = z
  .object({ h: constraintH, v: constraintV })
  .optional();

// Base de toda capa.
const baseLayerSchema = z.object({
  id: idSchema,
  name: z.string().max(255).optional(),
  position: positionSchema,
  size: sizeSchema,
  rotation: z.number().optional(),
  opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(),
  locked: z.boolean().optional(),
  constraints: constraintsSchema,
});

// Color: hex con o sin alfa, rgb(a), o token "{kind.name}". No validamos a
// fondo (el renderer es tolerante con cualquier CSS color); solo descartamos
// strings vacíos.
const cssColorSchema = z
  .string()
  .min(1, { message: "color string vacío" })
  .max(200);

// fontSize puede ser número, token string "{scale.X}", o FontSizeRange.
const fontSizeRangeSchema = z.object({
  min: z.number().int().min(1).max(2000),
  max: z.number().int().min(1).max(2000),
});
const fontSizeSchema = z.union([
  z.number().min(1),
  z.string().min(1).max(100),
  fontSizeRangeSchema,
]);

const textStyleSchema = z.object({
  fontFamily: z.string().max(200).optional(),
  fontSize: fontSizeSchema,
  fontWeight: z.union([z.number(), z.string().max(100)]).optional(),
  color: cssColorSchema,
  lineHeight: z.number().optional(),
  letterSpacing: z.number().optional(),
  align: z.enum(["left", "center", "right"]).optional(),
  verticalAlign: z.enum(["top", "middle", "bottom"]).optional(),
  italic: z.boolean().optional(),
});

const textLayerSchema = baseLayerSchema.extend({
  type: z.literal("text"),
  content: z.string().max(5000),
  style: textStyleSchema,
});

const imageLayerSchema = baseLayerSchema.extend({
  type: z.literal("image"),
  src: z.string().max(2000).nullable(),
  fit: z.enum(["cover", "contain", "fill"]).optional(),
  cornerRadius: z.number().int().min(0).max(2000).optional(),
});

const shapeLayerSchema = baseLayerSchema.extend({
  type: z.literal("shape"),
  shape: z.enum(["rect", "ellipse"]),
  fill: cssColorSchema,
  stroke: z
    .object({
      color: cssColorSchema,
      width: z.number().min(0).max(100),
    })
    .nullable()
    .optional(),
  cornerRadius: z.number().int().min(0).max(2000).optional(),
});

const stackLayoutSchema = z.object({
  mode: z.literal("stack"),
  direction: z.enum(["vertical", "horizontal"]),
  padding: z.tuple([
    z.union([z.number(), z.string()]),
    z.union([z.number(), z.string()]),
    z.union([z.number(), z.string()]),
    z.union([z.number(), z.string()]),
  ]),
  gap: z.union([z.number(), z.string()]),
  align: z.enum(["start", "center", "end", "stretch"]),
  justify: z.enum([
    "start",
    "center",
    "end",
    "space-between",
    "space-around",
    "space-evenly",
  ]),
});
const freeLayoutSchema = z.object({ mode: z.literal("free") });
const layoutSchema = z.discriminatedUnion("mode", [
  freeLayoutSchema,
  stackLayoutSchema,
]);

// Frame es recursivo: contiene children que son TemplateLayer (incluyendo
// otros frames). zod soporta esto con z.lazy.
const frameLayerSchema: z.ZodType<TemplateLayer> = z.lazy(() =>
  baseLayerSchema.extend({
    type: z.literal("frame"),
    background: z
      .union([
        z.object({ type: z.literal("color"), value: cssColorSchema }),
        z.object({ type: z.literal("transparent") }),
      ])
      .optional(),
    layout: layoutSchema,
    cornerRadius: z.number().int().min(0).max(2000).optional(),
    children: z.array(layerSchema),
  }),
);

// La union recursiva no se puede expresar con discriminatedUnion (necesita
// schemas no-lazy en sus opciones). Usamos union normal: en runtime es
// equivalente, solo cambia la inferencia de TS — que de todos modos casteamos
// a TemplateLayer.
const layerSchema: z.ZodType<TemplateLayer> = z.lazy(() =>
  z.union([frameLayerSchema, textLayerSchema, imageLayerSchema, shapeLayerSchema]),
);

// Root definition: frame con id "tpl_root" exacto y layout = free (los
// banners se componen con posición libre por default; stack está permitido
// pero el renderer del producir page asume free root).
const definitionSchema = z
  .object({
    id: z.literal("tpl_root"),
    type: z.literal("frame"),
    position: positionSchema,
    size: sizeSchema,
    background: z
      .union([
        z.object({ type: z.literal("color"), value: cssColorSchema }),
        z.object({ type: z.literal("transparent") }),
      ])
      .optional(),
    layout: layoutSchema,
    cornerRadius: z.number().int().min(0).max(2000).optional(),
    children: z.array(layerSchema),
    name: z.string().max(255).optional(),
    rotation: z.number().optional(),
    opacity: z.number().min(0).max(1).optional(),
    visible: z.boolean().optional(),
    locked: z.boolean().optional(),
    constraints: constraintsSchema,
  })
  .strict();

// ---------- Semantic validation ----------

export interface ValidationOk {
  ok: true;
  definition: TemplateDefinition;
}
export interface ValidationErr {
  ok: false;
  error: string;
}
export type ValidationResult = ValidationOk | ValidationErr;

// Reglas:
//  - Todos los ids son únicos en el árbol.
//  - Cada capa cabe dentro de su padre (position + size <= padre.size).
//  - El root tiene size = canvasW × canvasH si se pasa.
export function validateTemplateDefinition(
  raw: unknown,
  expectedSize?: { w: number; h: number },
): ValidationResult {
  const parsed = definitionSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first.path.length > 0 ? first.path.join(".") : "(root)";
    return {
      ok: false,
      error: `Schema inválido en ${path}: ${first.message}`,
    };
  }
  const def = parsed.data as TemplateDefinition;

  if (expectedSize) {
    if (def.size.w !== expectedSize.w || def.size.h !== expectedSize.h) {
      return {
        ok: false,
        error: `El root.size es ${def.size.w}x${def.size.h} pero target_dims dice ${expectedSize.w}x${expectedSize.h}. Ajustá el size del root.`,
      };
    }
  }

  // IDs únicos
  const seen = new Set<string>();
  const collectIds = (layer: TemplateLayer): string | null => {
    if (seen.has(layer.id)) return layer.id;
    seen.add(layer.id);
    if (layer.type === "frame") {
      for (const c of layer.children) {
        const dup = collectIds(c);
        if (dup) return dup;
      }
    }
    return null;
  };
  const dup = collectIds(def);
  if (dup) {
    return {
      ok: false,
      error: `id duplicado: "${dup}". Cada capa debe tener un id único en todo el árbol.`,
    };
  }

  // Bounds: cada hijo del root cabe dentro del root. (No bajamos recursivamente
  // a frames anidados porque ahí la convención es que children son relativos al
  // frame contenedor — el motor lo maneja. El root sí valida.)
  for (const child of def.children) {
    if (child.position.x + child.size.w > def.size.w) {
      return {
        ok: false,
        error: `Capa "${child.id}" excede ancho del canvas: position.x=${child.position.x} + size.w=${child.size.w} = ${child.position.x + child.size.w} > canvas.w=${def.size.w}.`,
      };
    }
    if (child.position.y + child.size.h > def.size.h) {
      return {
        ok: false,
        error: `Capa "${child.id}" excede alto del canvas: position.y=${child.position.y} + size.h=${child.size.h} = ${child.position.y + child.size.h} > canvas.h=${def.size.h}.`,
      };
    }
  }

  // FontSizeRange consistencia
  const validateRange = (layer: TemplateLayer): string | null => {
    if (layer.type === "text" && typeof layer.style.fontSize === "object") {
      const r = layer.style.fontSize;
      if ("min" in r && "max" in r && r.min > r.max) {
        return `Capa "${layer.id}" tiene FontSizeRange con min=${r.min} > max=${r.max}.`;
      }
    }
    if (layer.type === "frame") {
      for (const c of layer.children) {
        const e = validateRange(c);
        if (e) return e;
      }
    }
    return null;
  };
  const rangeErr = validateRange(def);
  if (rangeErr) return { ok: false, error: rangeErr };

  return { ok: true, definition: def };
}
