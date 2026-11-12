// Guías inteligentes del canvas (como en Figma): al arrastrar, el bloque que
// se mueve (uno o varios nodos) se pega a los bordes o al centro de otros
// nodos cuando queda a menos de `threshold` (en unidades del canvas), y se
// devuelven las líneas a dibujar. Puro: sin React ni xyflow.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Guide {
  // "v" = línea vertical en x (de y1 a y2); "h" = horizontal en y (de x1 a x2).
  orientation: "v" | "h";
  pos: number;
  from: number;
  to: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: Guide[];
}

// Bordes y centro de una caja en un eje.
function anchors(start: number, size: number): number[] {
  return [start, start + size / 2, start + size];
}

// Mejor ajuste en un eje: el menor desplazamiento que alinea alguna línea
// del bloque con alguna línea de otro nodo, dentro del umbral.
function bestOffset(moving: number[], targets: number[][], threshold: number): number | null {
  let best: number | null = null;
  for (const t of targets) {
    for (const tv of t) {
      for (const mv of moving) {
        const d = tv - mv;
        if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
      }
    }
  }
  return best;
}

const EPS = 0.5;

/**
 * Ajuste del bloque `moving` contra `others`. Con un eje sin coincidencias
 * dentro del umbral ese desplazamiento es 0 (queda donde lo dejó el puntero o
 * la cuadrícula). Las guías cubren el bloque y todos los nodos alineados.
 */
export function computeSnap(moving: Box, others: Box[], threshold: number): SnapResult {
  const dx = bestOffset(anchors(moving.x, moving.w), others.map((o) => anchors(o.x, o.w)), threshold) ?? 0;
  const dy = bestOffset(anchors(moving.y, moving.h), others.map((o) => anchors(o.y, o.h)), threshold) ?? 0;
  const snapped: Box = { x: moving.x + dx, y: moving.y + dy, w: moving.w, h: moving.h };
  const guides: Guide[] = [];

  if (dx !== 0 || others.some((o) => anchors(o.x, o.w).some((a) => anchors(snapped.x, snapped.w).some((m) => Math.abs(a - m) < EPS)))) {
    for (const mx of anchors(snapped.x, snapped.w)) {
      const aligned = others.filter((o) => anchors(o.x, o.w).some((a) => Math.abs(a - mx) < EPS));
      if (aligned.length === 0) continue;
      const ys = [snapped.y, snapped.y + snapped.h, ...aligned.flatMap((o) => [o.y, o.y + o.h])];
      guides.push({ orientation: "v", pos: mx, from: Math.min(...ys), to: Math.max(...ys) });
    }
  }
  if (dy !== 0 || others.some((o) => anchors(o.y, o.h).some((a) => anchors(snapped.y, snapped.h).some((m) => Math.abs(a - m) < EPS)))) {
    for (const my of anchors(snapped.y, snapped.h)) {
      const aligned = others.filter((o) => anchors(o.y, o.h).some((a) => Math.abs(a - my) < EPS));
      if (aligned.length === 0) continue;
      const xs = [snapped.x, snapped.x + snapped.w, ...aligned.flatMap((o) => [o.x, o.x + o.w])];
      guides.push({ orientation: "h", pos: my, from: Math.min(...xs), to: Math.max(...xs) });
    }
  }
  return { dx, dy, guides };
}

/** Caja que envuelve varias cajas (el grupo seleccionado que se arrastra). */
export function unionBox(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  const x1 = Math.min(...boxes.map((b) => b.x));
  const y1 = Math.min(...boxes.map((b) => b.y));
  const x2 = Math.max(...boxes.map((b) => b.x + b.w));
  const y2 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** true si dos cajas se tocan (para quedarse solo con los nodos a la vista). */
export function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
