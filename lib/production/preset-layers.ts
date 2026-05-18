// Constructors de capas pre-armadas que el productor inserta de un click.
// Cada función devuelve una o más TemplateLayer listas para insertar via
// addLayersToFrame. La idea es darle al productor "building blocks"
// compuestos comunes en banners (botón CTA, línea divider, badge circular,
// ribbon) sin que tenga que combinar shape + text manualmente.
//
// Si el banner se va a editar en el editor manual, las capas son siblings
// (no agrupadas en un frame interno) — más fácil de ajustar después que
// un grupo. El precio es que pueden separarse si el productor borra una
// pieza accidentalmente.

import {
  TemplateLayer,
  TextLayer,
  ShapeLayer,
} from "./types";

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

// Botón / CTA: shape rect con cornerRadius alto (pill) + text encima
// centrado. Posicionado de tal forma que el text quede idéntico a la shape
// y el verticalAlign:middle lo centre verticalmente sin importar el tamaño
// del texto.
export function newButtonLayers(cx: number, cy: number): TemplateLayer[] {
  const w = 280;
  const h = 80;
  const pos = { x: cx - w / 2, y: cy - h / 2 };
  const size = { w, h };
  const bg: ShapeLayer = {
    id: uid(),
    type: "shape",
    name: "Botón fondo",
    position: pos,
    size,
    shape: "rect",
    fill: "#0F172A",
    cornerRadius: h / 2,
  };
  const label: TextLayer = {
    id: uid(),
    type: "text",
    name: "Botón texto",
    position: pos,
    size,
    content: "Comprar ahora",
    style: {
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: 28,
      fontWeight: 700,
      color: "#ffffff",
      lineHeight: 1,
      align: "center",
      verticalAlign: "middle",
    },
  };
  return [bg, label];
}

// Divider / línea: rect chato. Por default horizontal de ancho razonable.
// El productor luego ajusta dims y rotación.
export function newDividerLayer(cx: number, cy: number): ShapeLayer {
  const w = 480;
  const h = 4;
  return {
    id: uid(),
    type: "shape",
    name: "Divider",
    position: { x: cx - w / 2, y: cy - h / 2 },
    size: { w, h },
    shape: "rect",
    fill: "#94A3B8",
    cornerRadius: 2,
  };
}

// Badge circular de descuento: ellipse + text "-50%". Tamaño tipo sello
// pegado a una esquina. Color amarillo (highlight) con texto oscuro.
export function newBadgeLayers(cx: number, cy: number): TemplateLayer[] {
  const w = 200;
  const h = 200;
  const pos = { x: cx - w / 2, y: cy - h / 2 };
  const size = { w, h };
  const circle: ShapeLayer = {
    id: uid(),
    type: "shape",
    name: "Badge fondo",
    position: pos,
    size,
    shape: "ellipse",
    fill: "#FACC15",
  };
  const label: TextLayer = {
    id: uid(),
    type: "text",
    name: "Badge texto",
    position: pos,
    size,
    content: "-50%",
    style: {
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: 56,
      fontWeight: 900,
      color: "#0F172A",
      lineHeight: 1,
      align: "center",
      verticalAlign: "middle",
    },
  };
  return [circle, label];
}

// Ribbon / cinta diagonal: rect rotado -25° tipo "cinta de oferta" sobre
// la esquina del banner. Color rojo accent + texto blanco. El productor
// luego mueve a la esquina deseada.
export function newRibbonLayers(cx: number, cy: number): TemplateLayer[] {
  const w = 360;
  const h = 64;
  const pos = { x: cx - w / 2, y: cy - h / 2 };
  const size = { w, h };
  const bg: ShapeLayer = {
    id: uid(),
    type: "shape",
    name: "Ribbon fondo",
    position: pos,
    size,
    shape: "rect",
    fill: "#DC2626",
    rotation: -25,
  };
  const label: TextLayer = {
    id: uid(),
    type: "text",
    name: "Ribbon texto",
    position: pos,
    size,
    content: "¡OFERTA!",
    style: {
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: 36,
      fontWeight: 900,
      color: "#ffffff",
      lineHeight: 1,
      align: "center",
      verticalAlign: "middle",
      letterSpacing: 2,
    },
    rotation: -25,
  };
  return [bg, label];
}
