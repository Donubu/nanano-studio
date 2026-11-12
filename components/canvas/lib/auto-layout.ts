import type { Node, Edge } from "@xyflow/react";

const COLUMN_GAP = 80;
const ROW_GAP = 60;
const COMPONENT_GAP = 220;
const DEFAULT_W = 300;
const DEFAULT_H = 220;
const ORIGIN_X = 100;
const ORIGIN_Y = 100;
// Proporción (ancho/alto) objetivo de cada flujo y del canvas completo.
const TARGET_RATIO = 1.8;

interface Box {
  id: string;
  w: number;
  h: number;
  origX: number;
  origY: number;
}

interface Line {
  ids: string[];
  y: number;
  h: number;
}

/**
 * Layout de timeline vertical: el tiempo corre de arriba hacia abajo.
 *
 * - Cada flujo conectado (componente) se ordena por capas: un nodo queda
 *   debajo de todos los que lo alimentan. Los nodos sin entradas (imágenes de
 *   referencia, textos fijos, params) bajan hasta quedar justo encima del
 *   primer nodo que los usa, en vez de amontonarse en la primera fila.
 * - Dentro de cada capa el orden sigue al de los padres (o al de los hijos,
 *   para las entradas), y cada nodo se centra bajo sus padres.
 * - Una capa demasiado ancha para la proporción del flujo (una imagen con 12
 *   variaciones) se parte en varias líneas en vez de estirar el canvas.
 * - Los flujos sueltos se acomodan como bloques en filas, del más grande al
 *   más chico, con un ancho que deja el canvas completo cerca de 16:9.
 *
 * Devuelve nodeId → {x, y}; los demás campos del nodo no se tocan.
 */
export function autoLayoutPositions(
  nodes: Node[],
  edges: Edge[]
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return positions;

  const boxes = new Map<string, Box>();
  for (const n of nodes) {
    boxes.set(n.id, {
      id: n.id,
      w: (typeof n.width === "number" ? n.width : undefined) ?? n.measured?.width ?? DEFAULT_W,
      // Colapsado: cuenta su alto real (solo el encabezado), no el tamaño fijo.
      h: (n.data as { collapsed?: unknown } | undefined)?.collapsed === true
        ? n.measured?.height ?? 44
        : (typeof n.height === "number" ? n.height : undefined) ?? n.measured?.height ?? DEFAULT_H,
      origX: n.position?.x ?? 0,
      origY: n.position?.y ?? 0,
    });
  }

  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  for (const id of boxes.keys()) {
    parents.set(id, []);
    children.set(id, []);
  }
  const seenPair = new Set<string>();
  for (const e of edges) {
    if (!boxes.has(e.source) || !boxes.has(e.target) || e.source === e.target) continue;
    const key = `${e.source}>${e.target}`;
    if (seenPair.has(key)) continue; // varias conexiones entre el mismo par
    seenPair.add(key);
    children.get(e.source)!.push(e.target);
    parents.get(e.target)!.push(e.source);
  }

  // Componentes conexos (sin dirección).
  const compOf = new Map<string, number>();
  const components: string[][] = [];
  for (const id of boxes.keys()) {
    if (compOf.has(id)) continue;
    const idx = components.length;
    const members: string[] = [];
    const stack = [id];
    compOf.set(id, idx);
    while (stack.length) {
      const cur = stack.pop()!;
      members.push(cur);
      for (const nb of [...parents.get(cur)!, ...children.get(cur)!]) {
        if (!compOf.has(nb)) {
          compOf.set(nb, idx);
          stack.push(nb);
        }
      }
    }
    components.push(members);
  }

  const laidOut = components.map((ids) => layoutComponent(ids, boxes, parents, children));

  // Bloques: del más grande al más chico (a igual tamaño, en el orden en que
  // estaban en el canvas), en filas de ancho limitado.
  const order = laidOut
    .map((c, i) => ({ c, i, size: components[i].length, top: Math.min(...components[i].map((id) => boxes.get(id)!.origY)), left: Math.min(...components[i].map((id) => boxes.get(id)!.origX)) }))
    .sort((a, b) => b.size - a.size || a.top - b.top || a.left - b.left);
  const area = order.reduce((s, o) => s + (o.c.width + COMPONENT_GAP) * (o.c.height + COMPONENT_GAP), 0);
  const maxRowWidth = Math.max(Math.max(...order.map((o) => o.c.width)), Math.sqrt(area * TARGET_RATIO));

  let x = ORIGIN_X;
  let y = ORIGIN_Y;
  let rowH = 0;
  for (const { c } of order) {
    if (x > ORIGIN_X && x - ORIGIN_X + c.width > maxRowWidth) {
      x = ORIGIN_X;
      y += rowH + COMPONENT_GAP;
      rowH = 0;
    }
    for (const [id, p] of c.positions) positions.set(id, { x: Math.round(x + p.x), y: Math.round(y + p.y) });
    x += c.width + COMPONENT_GAP;
    rowH = Math.max(rowH, c.height);
  }
  return positions;
}

function layoutComponent(
  ids: string[],
  boxes: Map<string, Box>,
  parents: Map<string, string[]>,
  children: Map<string, string[]>,
): { positions: Map<string, { x: number; y: number }>; width: number; height: number } {
  const inComp = new Set(ids);
  const par = (id: string) => parents.get(id)!.filter((p) => inComp.has(p));
  const chi = (id: string) => children.get(id)!.filter((c) => inComp.has(c));

  // --- Capas: camino más largo desde las raíces (Kahn). Los nodos que quedan
  // en un ciclo (no debería pasar: las reglas de conexión los impiden) van
  // después de sus padres ya ubicados.
  const rank = new Map<string, number>();
  const indeg = new Map(ids.map((id) => [id, par(id).length]));
  let queue = ids.filter((id) => indeg.get(id) === 0);
  for (const id of queue) rank.set(id, 0);
  while (queue.length) {
    const next: string[] = [];
    for (const id of queue) {
      for (const c of chi(id)) {
        rank.set(c, Math.max(rank.get(c) ?? 0, rank.get(id)! + 1));
        indeg.set(c, indeg.get(c)! - 1);
        if (indeg.get(c) === 0) next.push(c);
      }
    }
    queue = next;
  }
  for (const id of ids) {
    if (!rank.has(id)) {
      const ranked = par(id).filter((p) => rank.has(p));
      rank.set(id, ranked.length ? Math.max(...ranked.map((p) => rank.get(p)!)) + 1 : 0);
    }
  }

  // Las raíces (entradas) bajan hasta justo encima de su primer consumidor.
  for (const id of ids) {
    if (par(id).length > 0) continue;
    const kids = chi(id);
    if (kids.length === 0) continue;
    rank.set(id, Math.max(0, Math.min(...kids.map((k) => rank.get(k)!)) - 1));
  }

  const maxRank = Math.max(...ids.map((id) => rank.get(id)!));
  const layers: string[][] = Array.from({ length: maxRank + 1 }, () => []);
  for (const id of ids) layers[rank.get(id)!].push(id);

  // --- Orden dentro de cada capa (baricentro): primero por posición original,
  // luego por el orden de los padres (bajando) y de los hijos (subiendo).
  const orderIdx = new Map<string, number>();
  for (const layer of layers) {
    layer.sort((a, b) => boxes.get(a)!.origX - boxes.get(b)!.origX || boxes.get(a)!.origY - boxes.get(b)!.origY);
    layer.forEach((id, i) => orderIdx.set(id, i));
  }
  const bary = (id: string, refs: string[]) =>
    refs.length ? refs.reduce((s, r) => s + orderIdx.get(r)!, 0) / refs.length : orderIdx.get(id)!;
  const sortLayer = (layer: string[], refsOf: (id: string) => string[]) => {
    const keyed = layer.map((id) => ({ id, k: bary(id, refsOf(id)) }));
    keyed.sort((a, b) => a.k - b.k || orderIdx.get(a.id)! - orderIdx.get(b.id)!);
    keyed.forEach((e, i) => {
      layer[i] = e.id;
      orderIdx.set(e.id, i);
    });
  };
  for (let sweep = 0; sweep < 3; sweep++) {
    for (let r = 1; r < layers.length; r++) sortLayer(layers[r], par);
    for (let r = layers.length - 2; r >= 0; r--) sortLayer(layers[r], chi);
  }

  // --- Ancho objetivo del flujo y líneas por capa (las capas anchas se parten).
  const area = ids.reduce((s, id) => s + (boxes.get(id)!.w + COLUMN_GAP) * (boxes.get(id)!.h + ROW_GAP), 0);
  const widest = Math.max(...ids.map((id) => boxes.get(id)!.w));
  const targetWidth = Math.max(widest, Math.sqrt(area * TARGET_RATIO));

  const lines: Line[] = [];
  const lineOf = new Map<string, number>();
  for (const layer of layers) {
    let current: string[] = [];
    let width = 0;
    const flush = () => {
      if (current.length === 0) return;
      lines.push({ ids: current, y: 0, h: Math.max(...current.map((id) => boxes.get(id)!.h)) });
      for (const id of current) lineOf.set(id, lines.length - 1);
      current = [];
      width = 0;
    };
    for (const id of layer) {
      const w = boxes.get(id)!.w;
      if (current.length > 0 && width + COLUMN_GAP + w > targetWidth) flush();
      width += (current.length ? COLUMN_GAP : 0) + w;
      current.push(id);
    }
    flush();
  }
  let cy = 0;
  for (const line of lines) {
    line.y = cy;
    cy += line.h + ROW_GAP;
  }

  // Largo del camino más largo hacia abajo desde cada nodo: el hijo que
  // continúa la cadena más larga es el que se queda alineado bajo su padre.
  const depthBelow = new Map<string, number>();
  const visiting = new Set<string>();
  const below = (id: string): number => {
    if (depthBelow.has(id)) return depthBelow.get(id)!;
    if (visiting.has(id)) return 0; // ciclo
    visiting.add(id);
    const d = chi(id).reduce((m, c) => Math.max(m, below(c) + 1), 0);
    visiting.delete(id);
    depthBelow.set(id, d);
    return d;
  };

  // --- X: cada nodo se centra bajo sus padres (o sobre sus hijos, si es una
  // entrada), sin solaparse y respetando el orden de la línea. Dos pasadas:
  // bajando (padres) y subiendo (entradas sobre sus hijos).
  const x = new Map<string, number>();
  const center = (id: string) => x.get(id)! + boxes.get(id)!.w / 2;
  const placeLine = (line: Line, desiredCenter: (id: string) => number | null) => {
    let cursor = 0;
    const raw: number[] = [];
    const hasWish: boolean[] = [];
    for (const id of line.ids) {
      const w = boxes.get(id)!.w;
      const want = desiredCenter(id);
      raw.push(want == null ? cursor : want - w / 2);
      hasWish.push(want != null);
      cursor = (want == null ? cursor : want - w / 2) + w + COLUMN_GAP;
    }
    // Ancla: el nodo (con posición deseada) que sigue la cadena más larga
    // queda exacto; los de su izquierda se corren a la izquierda y los de su
    // derecha a la derecha. Así una cadena larga no se tuerce en escalera
    // por las ramas cortas que salen de ella.
    let anchor = 0;
    for (let i = 1; i < line.ids.length; i++) {
      const better = (hasWish[i] && !hasWish[anchor]) ||
        (hasWish[i] === hasWish[anchor] && below(line.ids[i]) > below(line.ids[anchor]));
      if (better) anchor = i;
    }
    const placed = [...raw];
    for (let i = anchor + 1; i < line.ids.length; i++) {
      placed[i] = Math.max(raw[i], placed[i - 1] + boxes.get(line.ids[i - 1])!.w + COLUMN_GAP);
    }
    for (let i = anchor - 1; i >= 0; i--) {
      placed[i] = Math.min(raw[i], placed[i + 1] - boxes.get(line.ids[i])!.w - COLUMN_GAP);
    }
    line.ids.forEach((id, i) => x.set(id, placed[i]));
  };

  for (const line of lines) {
    placeLine(line, (id) => {
      const ps = par(id).filter((p) => x.has(p));
      return ps.length ? ps.reduce((s, p) => s + center(p), 0) / ps.length : null;
    });
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.ids.some((id) => par(id).length === 0 && chi(id).length > 0)) continue;
    placeLine(line, (id) => {
      const ps = par(id).filter((p) => x.has(p));
      if (ps.length) return ps.reduce((s, p) => s + center(p), 0) / ps.length;
      const cs = chi(id).filter((c) => lineOf.get(c)! > i);
      return cs.length ? cs.reduce((s, c) => s + center(c), 0) / cs.length : center(id);
    });
  }

  // Normaliza al origen del bloque.
  const minX = Math.min(...ids.map((id) => x.get(id)!));
  const positions = new Map<string, { x: number; y: number }>();
  let width = 0;
  for (const id of ids) {
    const px = x.get(id)! - minX;
    positions.set(id, { x: px, y: lines[lineOf.get(id)!].y });
    width = Math.max(width, px + boxes.get(id)!.w);
  }
  return { positions, width, height: Math.max(0, cy - ROW_GAP) };
}
