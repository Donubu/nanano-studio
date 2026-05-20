// Constructors de capas pre-armadas que el productor inserta de un click.
// Cada función devuelve UNA capa (o un array para casos compuestos
// inevitables) lista para insertar.
//
// Botón / Badge / Ribbon ahora usan UNA SOLA TextLayer con backgroundColor
// + backgroundCornerRadius (campos nuevos del schema). Esto reemplaza el
// patrón viejo de "shape de fondo + text encima" que era engorroso de
// mover/editar (el productor tenía que seleccionar las 2 capas para
// modificar como conjunto).
//
// Divider sigue como ShapeLayer porque no lleva texto.

import { TextLayer, ShapeLayer } from "./types";

function uid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

// Botón / CTA: TextLayer con backgroundColor + cornerRadius = h/2 (pill).
// Texto centrado horizontal y vertical. Una sola capa.
export function newButtonLayer(cx: number, cy: number): TextLayer {
  const w = 280;
  const h = 80;
  return {
    id: uid(),
    type: "text",
    name: "Botón",
    position: { x: cx - w / 2, y: cy - h / 2 },
    size: { w, h },
    content: "Comprar ahora",
    style: {
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: 28,
      fontWeight: 700,
      color: "#ffffff",
      lineHeight: 1,
      align: "center",
      verticalAlign: "middle",
      backgroundColor: "#0F172A",
      backgroundCornerRadius: h / 2,
    },
  };
}

// Divider / línea: rect chato. Se mantiene como ShapeLayer porque no
// lleva texto (no se beneficia del colapso).
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

// Badge circular de descuento: TextLayer cuadrada con cornerRadius = w/2
// (círculo perfecto) + backgroundColor amarillo. Una sola capa.
export function newBadgeLayer(cx: number, cy: number): TextLayer {
  const w = 200;
  const h = 200;
  return {
    id: uid(),
    type: "text",
    name: "Badge",
    position: { x: cx - w / 2, y: cy - h / 2 },
    size: { w, h },
    content: "-50%",
    style: {
      fontFamily: "Inter, system-ui, sans-serif",
      fontSize: 56,
      fontWeight: 900,
      color: "#0F172A",
      lineHeight: 1,
      align: "center",
      verticalAlign: "middle",
      backgroundColor: "#FACC15",
      backgroundCornerRadius: w / 2,
    },
  };
}

// Ribbon / cinta diagonal: TextLayer rotada con backgroundColor rojo.
// Una sola capa que rota como bloque (no más shape + text que había que
// rotar por separado).
export function newRibbonLayer(cx: number, cy: number): TextLayer {
  const w = 360;
  const h = 64;
  return {
    id: uid(),
    type: "text",
    name: "Ribbon",
    position: { x: cx - w / 2, y: cy - h / 2 },
    size: { w, h },
    rotation: -25,
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
      backgroundColor: "#DC2626",
    },
  };
}

