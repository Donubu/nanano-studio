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
 * Reordenar. Canvas con Guión, Personajes o vinculados: ver `storyLayout`.
 * Los demás: layout de timeline vertical: el tiempo corre de arriba hacia abajo.
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
  // Canvas con Guión, Personajes o vinculados: orden por estructura.
  if (nodes.some((n) => n.type === "scene" || n.type === "character" || n.type === "linked")) {
    return storyLayout(nodes, edges);
  }
  return flowLayout(nodes, edges);
}

function boxOf(n: Node): Box {
  return {
    id: n.id,
    w: (typeof n.width === "number" ? n.width : undefined) ?? n.measured?.width ?? DEFAULT_W,
    // Colapsado: cuenta su alto real (solo el encabezado), no el tamaño fijo.
    h: (n.data as { collapsed?: unknown } | undefined)?.collapsed === true
      ? n.measured?.height ?? 44
      : (typeof n.height === "number" ? n.height : undefined) ?? n.measured?.height ?? DEFAULT_H,
    origX: n.position?.x ?? 0,
    origY: n.position?.y ?? 0,
  };
}

function flowLayout(
  nodes: Node[],
  edges: Edge[]
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) return positions;

  const boxes = new Map<string, Box>();
  for (const n of nodes) boxes.set(n.id, boxOf(n));

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

// ---------------------------------------------------------------------------
// Orden por estructura (Guión + Personajes + vinculados)
// ---------------------------------------------------------------------------

type Pos = { x: number; y: number };
interface Block {
  positions: Map<string, Pos>; // relativas al bloque
  width: number;
  height: number;
}

const CELL_GAP = 40;
const SECTION_GAP = 320;
// Pocos vinculados chicos quedan en una sola fila.
const MIN_CAST_ROW = 2400;

/**
 * El orden por capas mezcla todo cuando un Personaje alimenta medio canvas y
 * las escenas se encadenan entre sí. Acá cada nodo se asigna a un GRUPO según
 * lo que es, y las conexiones entre grupos (Personaje → imagen de una escena,
 * continuidad entre destinos) no mueven nada:
 *
 * - Reparto (arriba): una columna por Personaje (galerías, Personaje y sus
 *   etapas encadenadas hacia abajo) y los nodos vinculados. Lo que alimenta a
 *   varios Personajes (estilo global) va en una fila encima.
 * - Guión: el Guión y sus entradas (Params Escena, referencias) arriba y
 *   luego UNA FILA POR ESCENA, de izquierda a derecha: Escena → destino → lo
 *   que sale de él (el video de esa imagen…), en columnas alineadas entre
 *   filas. La versión B va en su propia fila, justo debajo de la A.
 * - El resto, con el orden por capas de siempre, al final.
 */
function storyLayout(nodes: Node[], edges: Edge[]): Map<string, Pos> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const boxes = new Map(nodes.map((n) => [n.id, boxOf(n)]));
  const kids = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  const pars = new Map<string, string[]>(nodes.map((n) => [n.id, []]));
  const seen = new Set<string>();
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) continue;
    const k = `${e.source}>${e.target}`;
    if (seen.has(k)) continue;
    seen.add(k);
    kids.get(e.source)!.push(e.target);
    pars.get(e.target)!.push(e.source);
  }
  const byOrig = (a: string, b: string) =>
    boxes.get(a)!.origX - boxes.get(b)!.origX || boxes.get(a)!.origY - boxes.get(b)!.origY;

  const group = new Map<string, string>();
  const assign = (id: string, g: string) => {
    if (!group.has(id)) group.set(id, g);
  };
  const spread = (g: string) => {
    const queue = [...group.entries()].filter(([, gg]) => gg === g).map(([id]) => id);
    while (queue.length) {
      const cur = queue.shift()!;
      for (const c of kids.get(cur)!) {
        if (group.has(c)) continue;
        group.set(c, g);
        queue.push(c);
      }
    }
  };

  // --- Guiones y sus escenas (filas).
  const scripts = nodes.filter((n) => n.type === "script").map((n) => n.id).sort((a, b) => boxes.get(a)!.origY - boxes.get(b)!.origY || byOrig(a, b));
  const rowsOf = new Map<string, { key: string; order: number }[]>();
  for (const sid of scripts) {
    assign(sid, `head:${sid}`);
    rowsOf.set(sid, []);
  }
  const scenes = nodes.filter((n) => n.type === "scene");
  for (const sc of scenes) {
    const d = sc.data as { scriptNodeId?: string; sceneIndex?: number; variant?: string };
    const sid = d.scriptNodeId && rowsOf.has(d.scriptNodeId) ? d.scriptNodeId : "";
    if (!rowsOf.has(sid)) rowsOf.set(sid, []);
    const idx = Number(d.sceneIndex) || 0;
    const b = d.variant === "B";
    const key = `row:${sid}:${idx}${b ? "b" : ""}:${sc.id}`;
    assign(sc.id, key);
    rowsOf.get(sid)!.push({ key, order: idx * 2 + (b ? 1 : 0) });
  }
  const scriptIds = [...scripts, ...(rowsOf.has("") ? [""] : [])];
  for (const sid of scriptIds) rowsOf.get(sid)!.sort((a, b) => a.order - b.order);

  // --- Personajes (con las imágenes de sus etapas) y vinculados.
  const characters = nodes.filter((n) => n.type === "character").map((n) => n.id).sort(byOrig);
  for (const cid of characters) {
    assign(cid, `char:${cid}`);
    for (const st of (byId.get(cid)!.data as { stages?: { imageNodeId?: string }[] }).stages ?? []) {
      if (st.imageNodeId && byId.has(st.imageNodeId)) assign(st.imageNodeId, `char:${cid}`);
    }
  }
  const kindRank = (id: string) => {
    const d = byId.get(id)!.data as { linkSnapshot?: { kind?: string } | null; sourceType?: string };
    const kind = d.linkSnapshot?.kind ?? d.sourceType;
    return kind === "character" ? 0 : kind === "image" ? 1 : 2;
  };
  const isLinkedVideo = (id: string) => {
    const d = byId.get(id)!.data as { linkSnapshot?: { kind?: string } | null; sourceType?: string };
    return (d.linkSnapshot?.kind ?? d.sourceType) === "video";
  };
  const linked = nodes.filter((n) => n.type === "linked" && !isLinkedVideo(n.id)).map((n) => n.id).sort((a, b) => kindRank(a) - kindRank(b) || byOrig(a, b));
  for (const id of linked) assign(id, `cast:${id}`);
  // Videos vinculados (montaje): una fila por canvas de origen, en el orden
  // de las escenas.
  const montage = new Map<string, string[]>();
  for (const n of nodes) {
    if (n.type !== "linked" || !isLinkedVideo(n.id)) continue;
    const d = n.data as { sourceConversationId?: number; sourceCanvasTitle?: string };
    const key = `${d.sourceCanvasTitle ?? ""}\u0000${d.sourceConversationId ?? ""}`;
    if (!montage.has(key)) montage.set(key, []);
    montage.get(key)!.push(n.id);
    assign(n.id, "montage");
  }
  const sceneOrder = (id: string) => {
    const sc = (byId.get(id)!.data as { linkSnapshot?: { scene?: { sceneIndex?: number; variant?: string } | null } | null }).linkSnapshot?.scene;
    return sc ? (sc.sceneIndex ?? 0) * 2 + (sc.variant === "B" ? 1 : 0) : Number.MAX_SAFE_INTEGER;
  };
  const montageRows = [...montage.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "es", { numeric: true, sensitivity: "base" }))
    .map(([, ids]) => ids.sort((a, b) => sceneOrder(a) - sceneOrder(b) || byOrig(a, b)));

  // El destino de cada escena antes de recorrer: la conexión de continuidad
  // entre destinos no debe llevarse el de la escena siguiente.
  const rowKeys = scriptIds.flatMap((sid) => rowsOf.get(sid)!.map((r) => r.key));
  for (const key of rowKeys) {
    const sceneId = key.split(":").pop()!;
    for (const c of kids.get(sceneId)!) if (byId.get(c)!.type !== "scene") assign(c, key);
  }
  // Lo que sale de cada grupo es del grupo (primero las escenas, en orden).
  for (const key of rowKeys) spread(key);
  for (const cid of characters) spread(`char:${cid}`);
  for (const id of linked) spread(`cast:${id}`);
  for (const sid of scripts) spread(`head:${sid}`);

  // Entradas sueltas (galerías, textos, Params Escena…) van con lo que
  // alimentan; si alimentan varias filas del mismo Guión, a su cabecera; si
  // alimentan varios Personajes, a la fila común de arriba.
  const merge = (gs: Set<string>): string | null => {
    if (gs.size === 1) return [...gs][0];
    const list = [...gs];
    const sidOf = (g: string) => (g.startsWith("row:") || g.startsWith("head:") ? g.split(":")[1] : null);
    const sid = sidOf(list[0]);
    if (sid != null && list.every((g) => sidOf(g) === sid)) return sid ? `head:${sid}` : null;
    if (list.every((g) => g.startsWith("char:") || g.startsWith("cast:") || g === "shared")) return "shared";
    return null;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const n of nodes) {
      if (group.has(n.id)) continue;
      const ks = kids.get(n.id)!;
      if (ks.length === 0 || ks.some((c) => !group.has(c))) continue;
      const g = merge(new Set(ks.map((c) => group.get(c)!)));
      if (!g) continue;
      group.set(n.id, g);
      changed = true;
    }
  }

  const members = new Map<string, string[]>();
  for (const n of nodes) {
    const g = group.get(n.id) ?? "rest";
    if (!members.has(g)) members.set(g, []);
    members.get(g)!.push(n.id);
  }
  const blockOf = (ids: string[]): Block => {
    const set = new Set(ids);
    const sub = nodes.filter((n) => set.has(n.id));
    const pos = flowLayout(sub, edges.filter((e) => set.has(e.source) && set.has(e.target)));
    return normalize(pos, ids, boxes);
  };

  const positions = new Map<string, Pos>();
  const put = (block: Block, ox: number, oy: number) => {
    for (const [id, p] of block.positions) positions.set(id, { x: Math.round(ox + p.x), y: Math.round(oy + p.y) });
  };
  let y = ORIGIN_Y;

  // 1) Lo que comparten los Personajes, en una fila.
  const shared = (members.get("shared") ?? []).sort(byOrig);
  if (shared.length) {
    let x = ORIGIN_X;
    let h = 0;
    for (const id of shared) {
      positions.set(id, { x, y });
      x += boxes.get(id)!.w + COLUMN_GAP;
      h = Math.max(h, boxes.get(id)!.h);
    }
    y += h + COMPONENT_GAP;
  }

  // 2) Reparto: una columna por Personaje y los vinculados, en filas.
  const cast = [...characters.map((c) => `char:${c}`), ...linked.map((l) => `cast:${l}`)]
    .filter((g) => members.has(g))
    .map((g) => blockOf(members.get(g)!));
  if (cast.length) {
    const area = cast.reduce((s, b) => s + (b.width + COMPONENT_GAP) * (b.height + COMPONENT_GAP), 0);
    const maxRow = Math.max(MIN_CAST_ROW, ...cast.map((b) => b.width), Math.sqrt(area * TARGET_RATIO));
    let x = ORIGIN_X;
    let rowH = 0;
    for (const b of cast) {
      if (x > ORIGIN_X && x - ORIGIN_X + b.width > maxRow) {
        x = ORIGIN_X;
        y += rowH + COMPONENT_GAP;
        rowH = 0;
      }
      put(b, x, y);
      x += b.width + COMPONENT_GAP;
      rowH = Math.max(rowH, b.height);
    }
    y += rowH + SECTION_GAP;
  }

  // 2b) Montaje: videos vinculados, una fila por canvas de origen.
  if (montageRows.length) {
    for (const ids of montageRows) {
      let x = ORIGIN_X;
      let rowH = 0;
      for (const id of ids) {
        positions.set(id, { x, y });
        x += boxes.get(id)!.w + COLUMN_GAP;
        rowH = Math.max(rowH, boxes.get(id)!.h);
      }
      y += rowH + COMPONENT_GAP;
    }
    y += SECTION_GAP - COMPONENT_GAP;
  }

  // 3) Cada Guión: cabecera y una fila por escena con columnas alineadas.
  for (const sid of scriptIds) {
    const head = members.get(`head:${sid}`);
    if (head?.length) {
      const b = blockOf(head);
      put(b, ORIGIN_X, y);
      y += b.height + COMPONENT_GAP;
    }
    const rows = rowsOf.get(sid)!.map((r) => rowCells(members.get(r.key) ?? [], r.key.split(":").pop()!, kids, boxes, byOrig));
    if (rows.length === 0) continue;
    const cols = Math.max(...rows.map((r) => r.length));
    const colW = Array.from({ length: cols }, (_, c) =>
      Math.max(0, ...rows.map((r) => (r[c] ? Math.max(0, ...r[c].map((id) => boxes.get(id)!.w)) : 0))),
    );
    const colX: number[] = [];
    let cx = ORIGIN_X;
    for (let c = 0; c < cols; c++) {
      colX.push(cx);
      cx += colW[c] + COLUMN_GAP * 2;
    }
    for (const row of rows) {
      let rowH = 0;
      row.forEach((cell, c) => {
        let cy = y;
        for (const id of cell) {
          positions.set(id, { x: colX[c], y: cy });
          cy += boxes.get(id)!.h + CELL_GAP;
        }
        rowH = Math.max(rowH, cy - CELL_GAP - y);
      });
      y += rowH + ROW_GAP;
    }
    y += SECTION_GAP - ROW_GAP;
  }

  // 4) Lo demás, como siempre.
  const rest = members.get("rest");
  if (rest?.length) {
    const set = new Set(rest);
    const pos = flowLayout(nodes.filter((n) => set.has(n.id)), edges.filter((e) => set.has(e.source) && set.has(e.target)));
    const b = normalize(pos, rest, boxes);
    put(b, ORIGIN_X, y);
  }
  return positions;
}

function normalize(pos: Map<string, Pos>, ids: string[], boxes: Map<string, Box>): Block {
  const minX = Math.min(...ids.map((id) => pos.get(id)!.x));
  const minY = Math.min(...ids.map((id) => pos.get(id)!.y));
  const positions = new Map<string, Pos>();
  let width = 0;
  let height = 0;
  for (const id of ids) {
    const p = { x: pos.get(id)!.x - minX, y: pos.get(id)!.y - minY };
    positions.set(id, p);
    width = Math.max(width, p.x + boxes.get(id)!.w);
    height = Math.max(height, p.y + boxes.get(id)!.h);
  }
  return { positions, width, height };
}

/**
 * Una fila de escena en columnas: la columna de cada nodo es el largo del
 * camino desde la escena (Escena → Imagen → Video). Una entrada suelta va en
 * la columna anterior a lo que alimenta, debajo de lo que haya ahí.
 */
function rowCells(
  ids: string[],
  scene: string,
  kids: Map<string, string[]>,
  boxes: Map<string, Box>,
  byOrig: (a: string, b: string) => number,
): string[][] {
  const set = new Set(ids);
  const chi = (id: string) => kids.get(id)!.filter((c) => set.has(c));
  const indeg = new Map(ids.map((id) => [id, 0]));
  for (const id of ids) for (const c of chi(id)) indeg.set(c, indeg.get(c)! + 1);
  const rank = new Map<string, number>();
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
  for (const id of ids) if (!rank.has(id)) rank.set(id, 0); // ciclo: no debería pasar
  // La escena es la única raíz "de verdad": las demás entradas se acercan a
  // lo que alimentan.
  for (const id of ids) {
    if (id === scene || ids.some((p) => chi(p).includes(id))) continue;
    const ks = chi(id);
    if (ks.length) rank.set(id, Math.max(0, Math.min(...ks.map((k) => rank.get(k)!)) - 1));
  }
  const cols: string[][] = [];
  for (const id of ids) {
    const r = rank.get(id)!;
    while (cols.length <= r) cols.push([]);
    cols[r].push(id);
  }
  // La escena primero en su columna; el resto en el orden en que estaban.
  for (const col of cols) col.sort((a, b) => (a === scene ? -1 : b === scene ? 1 : boxes.get(a)!.origY - boxes.get(b)!.origY || byOrig(a, b)));
  return cols;
}
