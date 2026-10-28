// Compuestos "fondo + texto" como una sola capa.
//
// El schema soporta botones / badges / ribbons como UN TextLayer con
// style.backgroundColor + backgroundCornerRadius. El patrón viejo (ShapeLayer
// abajo + TextLayer encima con las mismas dims) sigue apareciendo: las
// plantillas de layout-templates.ts lo usan y hay templates históricos (del
// antiguo Banner Designer) armados así. Dos capas sueltas son molestas de mover, animar y
// leer en el panel. Este módulo las colapsa:
//
//   - collapseShapeTextPairs(def): normalización automática sobre un árbol
//     completo (se aplica a lo que devuelve el agente antes de mostrarlo).
//   - mergeShapeAndText(shape, text): fusión explícita de un par elegido por
//     el productor (acción "Fusionar en botón" del editor).

import {
  TemplateDefinition,
  TemplateLayer,
  TextLayer,
  ShapeLayer,
} from "@/lib/production/types";

// Tolerancia en px para considerar que shape y text comparten caja. El
// agente a veces redondea distinto en cada capa (862.5 vs 863).
const BOUNDS_TOLERANCE = 2;

export function sameBounds(a: TemplateLayer, b: TemplateLayer, tol = BOUNDS_TOLERANCE) {
  return (
    Math.abs(a.position.x - b.position.x) <= tol &&
    Math.abs(a.position.y - b.position.y) <= tol &&
    Math.abs(a.size.w - b.size.w) <= tol &&
    Math.abs(a.size.h - b.size.h) <= tol
  );
}

// Un shape es "fusionable" si puede representarse como fondo de un
// TextLayer: sin stroke (el text background no tiene borde). Rotación y
// opacidad se preservan desde el texto (que es la capa que queda).
export function isMergeableShape(layer: TemplateLayer): layer is ShapeLayer {
  if (layer.type !== "shape") return false;
  if (layer.stroke && layer.stroke.width > 0) return false;
  return typeof layer.fill === "string" && layer.fill.length > 0;
}

export function isMergeableText(layer: TemplateLayer): layer is TextLayer {
  if (layer.type !== "text") return false;
  // Si ya tiene fondo propio, es un compuesto hecho; no lo pisamos.
  return !layer.style.backgroundColor;
}

// Devuelve el TextLayer resultante. Conserva el id del texto (así los
// tracks de animación y las referencias a ese id siguen válidos) y toma
// la caja del shape (el fondo define el área clickeable).
export function mergeShapeAndText(shape: ShapeLayer, text: TextLayer): TextLayer {
  const w = shape.size.w;
  const h = shape.size.h;
  const radius =
    shape.shape === "ellipse"
      ? Math.round(Math.min(w, h) / 2)
      : Math.max(0, Math.round(shape.cornerRadius ?? 0));
  return {
    ...text,
    name: text.name ?? shape.name,
    position: { ...shape.position },
    size: { w, h },
    shadow: text.shadow ?? shape.shadow,
    opacity: text.opacity ?? shape.opacity,
    rotation: text.rotation ?? shape.rotation,
    constraints: text.constraints ?? shape.constraints,
    style: {
      ...text.style,
      align: text.style.align ?? "center",
      verticalAlign: text.style.verticalAlign ?? "middle",
      backgroundColor: shape.fill,
      backgroundCornerRadius: radius,
    },
  };
}

export interface CollapseResult {
  definition: TemplateDefinition;
  merged: number;
}

// Recorre todos los frames. Dentro de cada lista de hijos, por cada shape
// fusionable busca el primer text fusionable POR ENCIMA (índice mayor, es
// decir, más arriba en z) con la misma caja. Si lo encuentra, reemplaza el
// text por el merge y elimina el shape. Un shape solo se fusiona con un
// texto; un texto solo con un shape.
export function collapseShapeTextPairs(def: TemplateDefinition): CollapseResult {
  let merged = 0;

  const walk = (children: TemplateLayer[]): TemplateLayer[] => {
    const out: TemplateLayer[] = children.map((c) =>
      c.type === "frame" ? { ...c, children: walk(c.children) } : c,
    );
    const consumedShapes = new Set<string>();
    const consumedTexts = new Set<string>();
    const replacements = new Map<string, TextLayer>();

    for (let i = 0; i < out.length; i++) {
      const shape = out[i];
      if (!isMergeableShape(shape) || consumedShapes.has(shape.id)) continue;
      for (let j = i + 1; j < out.length; j++) {
        const text = out[j];
        if (!isMergeableText(text) || consumedTexts.has(text.id)) continue;
        if (!sameBounds(shape, text)) continue;
        replacements.set(text.id, mergeShapeAndText(shape, text));
        consumedShapes.add(shape.id);
        consumedTexts.add(text.id);
        merged++;
        break;
      }
    }

    if (replacements.size === 0) return out;
    return out
      .filter((c) => !consumedShapes.has(c.id))
      .map((c) => replacements.get(c.id) ?? c);
  };

  const children = walk(def.children);
  if (merged === 0) return { definition: def, merged };
  return { definition: { ...def, children }, merged };
}
