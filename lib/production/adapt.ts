// Motor de adaptación: dado el árbol de una orientación (la más cercana al
// formato de salida) produce el árbol para ese formato. Es lo que ven las
// cards de adaptaciones, el editor de una adaptación al abrirse, el preview
// por formato del editor y los exports.
//
// Dos estrategias según cuánto difiere el aspect ratio:
//
//   1. Formato parecido (diff ≤ LINEAR_ASPECT_DIFF): reflow por constraints
//      (reflow.ts) y después un pase de ajuste por capa:
//        - la caja no puede exceder el formato (se reduce uniformemente
//          alrededor de su centro y se mete dentro de los márgenes),
//        - la tipografía y demás medidas en px escalan con el factor real
//          de la caja (min de los dos ejes). Sin esto, un titular de 140px
//          del master de 1920 llegaba a un 300×250 con 140px.
//
//   2. Tira extrema (leaderboard 728×90, skyscraper 160×600, móvil 320×50):
//      recomposición lineal. Los fondos a pantalla completa se estiran; el
//      resto se ordena en fila (tiras horizontales) o columna (verticales)
//      en orden de lectura, cada capa escalada uniformemente al eje corto y
//      los textos sin fondo re-compuestos en una sola caja proporcional a su
//      contenido. Es determinista y no cuesta tokens; el productor puede
//      afinar después en el editor de la adaptación o pedir "Adaptar con IA".
//
// Reglas comunes a ambas (para que la pieza sirva en producción, no solo
// "quepa"):
//   - Fondos (foto/forma que cubre el formato, aunque sangre): se re-encuadran
//     para CUBRIR el formato nuevo conservando su proporción, su zoom relativo
//     y el centro de lo que se veía. Nunca quedan bandas del color de fondo.
//   - Íconos, badges circulares y elipses conservan su proporción.
//   - Lo que no alcanza a leerse se OCULTA por prioridad de rol
//     (layer-roles.ts): primero íconos y bajadas (con su ícono acompañante),
//     nunca titular ni CTA. Queda oculto, no borrado: se reactiva a mano.
//   - Las tiras siguen un orden canónico (badge/logo → titular → bajada →
//     CTA) y sueltan capas hasta que lo que queda se lee.

import {
  TemplateDefinition,
  TemplateLayer,
  TextLayer,
  isFontSizeRange,
} from "./types";
import { reflowForPreview, reflowAnimation, keepLayerAspect } from "./reflow";
import { scaleLayerStyle, scaleLayerUniform, scaleLayoutConfig } from "./scale";
import { inferRoles, companionIcons, coversFrame, ROLE_PRIORITY, LayerRole } from "./layer-roles";
import { effectiveFontSize, safeMargin } from "./layout-lint";

// Diferencia relativa de aspect ratio a partir de la cual el reflow por
// constraints deja de tener sentido y pasamos a recomposición lineal.
export const LINEAR_ASPECT_DIFF = 0.75;
const MIN_FONT = 7;
const BACKGROUND_COVER = 0.9;

export function aspectDiff(mw: number, mh: number, aw: number, ah: number): number {
  const m = mw / mh;
  const a = aw / ah;
  return Math.abs(m - a) / Math.min(m, a);
}

export function isLinearFormat(master: { w: number; h: number }, size: { w: number; h: number }): boolean {
  return aspectDiff(master.w, master.h, size.w, size.h) > LINEAR_ASPECT_DIFF;
}

export function adaptTree(master: TemplateDefinition, size: { w: number; h: number }): TemplateDefinition {
  if (master.size.w === size.w && master.size.h === size.h) return master;
  if (isLinearFormat(master.size, size)) return linearize(master, size);

  // Primero escala uniforme tipo "contain" (márgenes, tipografía y cajas
  // proporcionales al formato) y recién después reflow por constraints para
  // absorber la diferencia de aspect. Si reflowáramos directo desde el
  // master, los constraints conservan distancias absolutas (80px de margen
  // en un 300×250 deja 140px para el titular).
  const s = Math.min(size.w / master.size.w, size.h / master.size.h);
  const scaled: TemplateDefinition = {
    ...master,
    size: { w: master.size.w * s, h: master.size.h * s },
    layout: scaleLayoutConfig(master.layout, s),
    children: master.children.map((c) => scaleLayerUniform(c, s, 0, 0)),
    animation: undefined,
  };
  const reflowed = reflowForPreview(scaled, size);
  const masterById = new Map(master.children.map((c) => [c.id, c]));
  const fittedChildren = fitChildren(reflowed.children, reflowed.size, scaled.size, indexById(scaled)).map((c) => {
    const orig = masterById.get(c.id);
    if (!orig) return c;
    if (coversFrame(orig, master.size)) return coverFrame(orig, master.size, size);
    return keepLayerAspect(c, orig);
  });
  const fitted: TemplateDefinition = hideIllegible(
    { ...reflowed, children: fittedChildren },
    inferRoles(master),
    master,
  );
  return {
    ...fitted,
    animation: master.animation ? reflowAnimation(master.animation, master, fitted) : master.animation,
  };
}

// ---------------------------------------------------------------------------
// Estrategia 1: reflow + ajuste
// ---------------------------------------------------------------------------

function indexById(root: TemplateDefinition): Map<string, TemplateLayer> {
  const map = new Map<string, TemplateLayer>();
  const walk = (nodes: TemplateLayer[]) => {
    for (const n of nodes) {
      map.set(n.id, n);
      if (n.type === "frame") walk(n.children);
    }
  };
  walk(root.children);
  return map;
}

function fitChildren(
  children: TemplateLayer[],
  parent: { w: number; h: number },
  origParent: { w: number; h: number },
  origById: Map<string, TemplateLayer>,
): TemplateLayer[] {
  const margin = Math.round(Math.min(parent.w, parent.h) * 0.03);
  return children.map((l) => {
    const orig = origById.get(l.id) ?? l;
    let next: TemplateLayer = l;

    // 1. Caja dentro del formato. Los ejes que en el MASTER cubrían ≥90% del
    //    padre son fondos/franjas intencionales y no se tocan; se mide en el
    //    original porque tras el reflow una caja grande puede "cubrir" el
    //    formato solo por desborde.
    const maxW = Math.max(1, parent.w - 2 * margin);
    const maxH = Math.max(1, parent.h - 2 * margin);
    const coversW = orig.size.w >= origParent.w * BACKGROUND_COVER;
    const coversH = orig.size.h >= origParent.h * BACKGROUND_COVER;
    const kw = !coversW && l.size.w > maxW ? maxW / l.size.w : 1;
    const kh = !coversH && l.size.h > maxH ? maxH / l.size.h : 1;
    const k = Math.min(kw, kh);
    if (k < 1) {
      const cx = l.position.x + l.size.w / 2;
      const cy = l.position.y + l.size.h / 2;
      const w = l.size.w * k;
      const h = l.size.h * k;
      next = { ...next, position: { x: cx - w / 2, y: cy - h / 2 }, size: { w, h } };
    }
    // 2. Empujar dentro de los márgenes cuando cabe.
    if (!coversW && next.size.w <= maxW) {
      const x = Math.min(Math.max(next.position.x, margin), parent.w - margin - next.size.w);
      next = { ...next, position: { ...next.position, x } };
    }
    if (!coversH && next.size.h <= maxH) {
      const y = Math.min(Math.max(next.position.y, margin), parent.h - margin - next.size.h);
      next = { ...next, position: { ...next.position, y } };
    }

    // 3. Tipografía y medidas en px acompañan a la caja.
    const fx = orig.size.w > 0 ? next.size.w / orig.size.w : 1;
    const fy = orig.size.h > 0 ? next.size.h / orig.size.h : 1;
    const factor = clamp(Math.min(fx, fy), 0.05, 3);
    if (Math.abs(factor - 1) > 0.001) {
      next = scaleLayerStyle(next, factor);
      if (next.type === "text") next = floorFont(next);
    }
    if (next.type === "frame") {
      const origFrame = orig.type === "frame" ? orig.size : next.size;
      return { ...next, children: fitChildren(next.children, next.size, origFrame, origById) };
    }
    return next;
  });
}

// ---------------------------------------------------------------------------
// Estrategia 2: recomposición lineal
// ---------------------------------------------------------------------------

// Orden canónico de una tira: marca/oferta a un lado, mensaje al medio, CTA
// al final (derecha en horizontal, abajo en vertical).
const STRIP_ORDER: LayerRole[] = ["logo", "badge", "headline", "secondary", "product", "icon", "cta"];

// Fracción máxima del eje corto que ocupa cada rol. En tiras horizontales
// es el alto (un CTA de todo el alto de un billboard es desproporcionado);
// en verticales es el ancho (ahí el CTA sí va casi de lado a lado).
const STRIP_CROSS_H: Partial<Record<LayerRole, number>> = {
  cta: 0.5,
  badge: 0.9,
  logo: 0.7,
  product: 0.95,
  icon: 0.4,
};
const STRIP_CROSS_V: Partial<Record<LayerRole, number>> = {
  cta: 0.9,
  badge: 0.7,
  logo: 0.7,
  product: 0.95,
  icon: 0.35,
};
// Un texto secundario no puede ser más grande que esto × el titular.
const SECONDARY_MAX_RATIO = 0.6;

function minLegibleFont(size: { w: number; h: number }): number {
  return Math.min(size.w, size.h) < 120 ? 9 : 10;
}

function linearize(master: TemplateDefinition, size: { w: number; h: number }): TemplateDefinition {
  const W = size.w;
  const H = size.h;
  const horizontal = W >= H;
  const short = Math.min(W, H);
  const pad = Math.max(4, Math.round(short * 0.1));
  const gap = Math.max(4, Math.round(short * 0.12));
  const availW = Math.max(1, W - 2 * pad);
  const availH = Math.max(1, H - 2 * pad);
  const availAlong = horizontal ? availW : availH;
  const minFont = minLegibleFont(size);

  const roles = inferRoles(master);
  const roleOf = (l: TemplateLayer) => roles.get(l.id) ?? "decoration";
  const visible = master.children.filter((c) => c.visible !== false);
  const backgrounds = visible.filter((c) => roleOf(c) === "background");
  const readingOrder = (a: TemplateLayer, b: TemplateLayer) => {
    const ac = center(a);
    const bc = center(b);
    return horizontal ? ac.x - bc.x || ac.y - bc.y : ac.y - bc.y || ac.x - bc.x;
  };
  // Las decoraciones (formas sueltas) no entran en una tira.
  let items = visible
    .filter((c) => roleOf(c) !== "background" && roleOf(c) !== "decoration")
    .sort((a, b) => STRIP_ORDER.indexOf(roleOf(a)) - STRIP_ORDER.indexOf(roleOf(b)) || readingOrder(a, b));

  type Placed = { layer: TemplateLayer; w: number; h: number; font: number | null };
  const place = (list: TemplateLayer[]) => {
    // El titular va primero para que los secundarios se midan contra él.
    let headlineFont: number | null = null;
    const ordered = [...list].sort((a, b) => Number(roleOf(b) === "headline") - Number(roleOf(a) === "headline"));
    const byId = new Map<string, Placed>();
    for (const item of ordered) byId.set(item.id, placeOne(item));
    function placeOne(item: TemplateLayer): Placed {
      if (item.type === "text" && !item.style.backgroundColor) {
        let p = horizontal ? composeTextRow(item, availH, availW) : composeTextColumn(item, availW, availH);
        let font = numericFont(p.layer as TextLayer);
        if (roleOf(item) === "headline") headlineFont = font;
        else if (headlineFont && font > headlineFont * SECONDARY_MAX_RATIO) {
          const r = (headlineFont * SECONDARY_MAX_RATIO) / font;
          const fit = bestTextFitCapped(item, p.w, p.h, font * r);
          p = { layer: restyleText(item, fit.fs, fit.w, fit.h), w: fit.w, h: fit.h };
          font = fit.fs;
        }
        return { ...p, font };
      }
      // Tope por rol sobre el eje corto: un CTA de 85% del alto de un
      // billboard queda desproporcionado; un badge o un producto sí pueden
      // ocupar casi todo el alto.
      const cross = (horizontal ? STRIP_CROSS_H : STRIP_CROSS_V)[roleOf(item)] ?? 0.85;
      if (isPillText(item)) {
        const p = horizontal
          ? composeButton(item, availW * 0.35, availH * cross)
          : composeButton(item, availW * cross, availH * 0.12);
        return { ...p, font: numericFont(p.layer as TextLayer) };
      }
      const s = horizontal
        ? Math.min((availH * cross) / item.size.h, (availW * 0.6) / item.size.w)
        : Math.min((availW * cross) / item.size.w, (availH * 0.4) / item.size.h);
      const scaled = scaleLayerUniform(item, s, 0, 0);
      return {
        layer: scaled,
        w: scaled.size.w,
        h: scaled.size.h,
        font: scaled.type === "text" ? numericFont(scaled) : null,
      };
    }
    const placed: Placed[] = list.map((item) => byId.get(item.id)!);
    const along = (p: Placed) => (horizontal ? p.w : p.h);
    const total = placed.reduce((acc, p) => acc + along(p), 0) + gap * Math.max(0, placed.length - 1);
    const k = total > availAlong ? availAlong / total : 1;
    const smallest = Math.min(...placed.map((p) => (p.font == null ? Infinity : p.font * k)));
    return { placed, k, smallest, along };
  };

  // Soltar capas por prioridad hasta que lo que queda se lea. Un texto
  // secundario se lleva su ícono acompañante.
  const hidden = new Set<string>();
  let layout = place(items);
  // Achicar todo parejo está bien mientras se lea; solo se suelta una capa
  // si algo queda ilegible o hay que reducir a menos de la mitad.
  while (items.length > 2 && (layout.k < 0.5 || layout.smallest < minFont)) {
    const victim = [...items].sort(
      (a, b) => ROLE_PRIORITY[roleOf(b)] - ROLE_PRIORITY[roleOf(a)] || a.size.w * a.size.h - b.size.w * b.size.h,
    )[0];
    const drop = new Set([victim.id, ...(roleOf(victim) === "secondary" ? companionIcons(master, victim.id) : [])]);
    drop.forEach((id) => hidden.add(id));
    items = items.filter((c) => !drop.has(c.id));
    layout = place(items);
  }
  const { placed, k, along } = layout;
  const finalItems: Placed[] = placed.map((p) =>
    k < 1 ? { ...p, layer: scaleLayerUniform(p.layer, k, 0, 0), w: p.w * k, h: p.h * k } : p,
  );
  const finalTotal = finalItems.reduce((acc, p) => acc + along(p), 0) + gap * k * Math.max(0, finalItems.length - 1);

  // Colocación centrada en ambos ejes.
  let cursor = horizontal ? pad + (availW - finalTotal) / 2 : pad + (availH - finalTotal) / 2;
  const children: TemplateLayer[] = backgrounds.map((c) => coverFrame(c, master.size, size));
  for (const p of finalItems) {
    const x = horizontal ? cursor : pad + (availW - p.w) / 2;
    const y = horizontal ? pad + (availH - p.h) / 2 : cursor;
    children.push({
      ...p.layer,
      position: { x: Math.round(x), y: Math.round(y) },
      size: { w: Math.round(p.w), h: Math.round(p.h) },
      // En la recomposición cada capa se ancla a su nueva posición; los
      // constraints del master no aplican a este layout.
      constraints: undefined,
    });
    cursor += along(p) + gap * k;
  }
  // Las que no entraron quedan ocultas (mismo id: la animación y el
  // productor las siguen encontrando).
  for (const c of visible) {
    if (!hidden.has(c.id) && roleOf(c) !== "decoration") continue;
    const s = Math.min(1, W / c.size.w, H / c.size.h);
    children.push({ ...scaleLayerUniform(c, s, 0, 0), position: { x: 0, y: 0 }, visible: false, constraints: undefined });
  }

  const root: TemplateDefinition = {
    ...master,
    size: { w: W, h: H },
    layout: { mode: "free" },
    children,
  };
  return {
    ...root,
    animation: master.animation ? reflowAnimation(master.animation, master, root) : master.animation,
  };
}

// ---------------------------------------------------------------------------
// Reglas comunes
// ---------------------------------------------------------------------------

// Re-encuadra un fondo para cubrir el formato nuevo. Conserva la proporción
// de la caja (así la foto se recorta igual), el zoom relativo a "cubrir justo"
// y el punto de la caja que estaba al centro del formato original.
export function coverFrame(
  orig: TemplateLayer,
  origFrame: { w: number; h: number },
  size: { w: number; h: number },
): TemplateLayer {
  if (orig.type !== "image") {
    return { ...orig, position: { x: 0, y: 0 }, size: { w: size.w, h: size.h }, constraints: undefined };
  }
  const aspect = orig.size.w / Math.max(1, orig.size.h);
  const minCover = (f: { w: number; h: number }) =>
    f.w / f.h > aspect ? { w: f.w, h: f.w / aspect } : { w: f.h * aspect, h: f.h };
  const zoom = Math.max(1, orig.size.w / minCover(origFrame).w);
  const base = minCover(size);
  const w = base.w * zoom;
  const h = base.h * zoom;
  const ux = clamp((origFrame.w / 2 - orig.position.x) / orig.size.w, 0, 1);
  const uy = clamp((origFrame.h / 2 - orig.position.y) / orig.size.h, 0, 1);
  const x = clamp(size.w / 2 - ux * w, size.w - w, 0);
  const y = clamp(size.h / 2 - uy * h, size.h - h, 0);
  return {
    ...orig,
    position: { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 },
    size: { w: Math.ceil(w), h: Math.ceil(h) },
    constraints: undefined,
  };
}

// Formatos parecidos: textos secundarios que quedaron ilegibles (y su ícono
// acompañante) e íconos diminutos se ocultan. Titular, CTA, badge y logo no:
// si quedan chicos los marca el lint y los corrige "Revisar con IA".
// Titular, CTA y badge no se ocultan: si quedan bajo la letra mínima, crecen
// hasta alcanzarla (centrados, dentro del margen de seguridad y hasta 30% del
// alto). Un CTA de 920×120 del Vertical escalado a 160×600 quedaba en 6 px.
const GROW_ROLES = new Set<LayerRole>(["headline", "cta", "badge"]);

function growToLegible(l: TemplateLayer, frame: { w: number; h: number }, minFont: number): TemplateLayer {
  if (l.type !== "text") return l;
  const fs = effectiveFontSize(l);
  if (fs == null || fs <= 0 || fs >= minFont) return l;
  const m = safeMargin(frame);
  const f = Math.min(minFont / fs, (frame.w - 2 * m) / l.size.w, (frame.h * 0.3) / l.size.h);
  if (f <= 1.02) return l;
  const w = l.size.w * f;
  const h = l.size.h * f;
  const c = center(l);
  const x = Math.min(Math.max(m, c.x - w / 2), frame.w - m - w);
  const y = Math.min(Math.max(m, c.y - h / 2), frame.h - m - h);
  return { ...scaleLayerStyle(l, f), position: { x, y }, size: { w, h } };
}

function hideIllegible(def: TemplateDefinition, roles: Map<string, LayerRole>, master: TemplateDefinition): TemplateDefinition {
  const minFont = minLegibleFont(def.size);
  const hide = new Set<string>();
  let grown = false;
  const children = def.children.map((l) => {
    if (l.visible === false || !GROW_ROLES.has(roles.get(l.id) as LayerRole)) return l;
    const next = growToLegible(l, def.size, minFont);
    if (next !== l) grown = true;
    return next;
  });
  if (grown) def = { ...def, children };
  for (const l of def.children) {
    if (l.visible === false) continue;
    const role = roles.get(l.id);
    if (role === "secondary" && l.type === "text") {
      const fs = effectiveFontSize(l);
      if (fs != null && fs < minFont) {
        hide.add(l.id);
        companionIcons(master, l.id).forEach((id) => hide.add(id));
      }
    } else if (role === "icon" && Math.min(l.size.w, l.size.h) < 12) {
      hide.add(l.id);
    }
  }
  if (hide.size === 0) return def;
  return { ...def, children: def.children.map((c) => (hide.has(c.id) ? { ...c, visible: false } : c)) };
}

function center(l: TemplateLayer) {
  return { x: l.position.x + l.size.w / 2, y: l.position.y + l.size.h / 2 };
}

// Texto sin fondo en una tira horizontal: caja de hasta 80% del alto y 70%
// del ancho disponibles; la fuente y el número de líneas salen de bestTextFit.
function composeTextRow(item: TextLayer, availH: number, availW: number) {
  const fit = bestTextFit(item, availW * 0.7, availH * 0.8);
  return { layer: restyleText(item, fit.fs, fit.w, fit.h), w: fit.w, h: fit.h };
}

// Texto sin fondo en una tira vertical: hasta 90% del ancho y la mitad del
// alto, para dejar espacio al resto de la columna.
function composeTextColumn(item: TextLayer, availW: number, availH: number) {
  const fit = bestTextFit(item, availW * 0.9, availH * 0.5);
  return { layer: restyleText(item, fit.fs, fit.w, fit.h), w: fit.w, h: fit.h };
}

// Botón o pastilla (texto con fondo que no es círculo ni sello): en una tira
// su caja sale del texto más el aire, no de la caja del master. Escalar la
// caja de un CTA de 920×120 con letra de 52 px a una columna de 160 dejaba
// la letra en 6 px y casi todo el botón vacío.
function isPillText(l: TemplateLayer): l is TextLayer {
  if (l.type !== "text" || !l.style.backgroundColor || l.skin?.mode === "fit") return false;
  const round = (l.style.backgroundCornerRadius ?? 0) >= Math.min(l.size.w, l.size.h) * 0.45;
  return !(round && l.size.w / Math.max(1, l.size.h) < 1.6);
}

const BUTTON_PAD_X = 0.9; // por lado, en unidades de la fuente
const BUTTON_PAD_Y = 0.45;

function composeButton(item: TextLayer, maxW: number, maxH: number) {
  const lh = item.style.lineHeight ?? 1.2;
  const lines = textLines(item);
  const unitW = estimateWidth(item, lines, 1);
  const unitH = lines.length * lh;
  const fs = Math.max(MIN_FONT, Math.min(maxW / (unitW + 2 * BUTTON_PAD_X), maxH / (unitH + 2 * BUTTON_PAD_Y)));
  const w = Math.min(maxW, fs * (unitW + 2 * BUTTON_PAD_X));
  const h = Math.min(maxH, fs * (unitH + 2 * BUTTON_PAD_Y));
  return { layer: restyleText(item, fs, w, h), w, h };
}

// Mayor fuente posible para el texto dentro de maxW × maxH probando 1..4
// líneas (envoltura balanceada por palabras). Si el contenido ya trae saltos
// explícitos, se respetan y no se re-envuelve. Devuelve también la caja
// estimada; el renderer (SmartText) corrige si la estimación se pasa.
function bestTextFit(item: TextLayer, maxW: number, maxH: number): { fs: number; w: number; h: number } {
  const lh = item.style.lineHeight ?? 1.2;
  const explicit = textLines(item);
  const candidates: string[][] = [];
  if (explicit.length > 1 || explicit[0].trim().split(/\s+/).length === 1) {
    candidates.push(explicit);
  } else {
    const words = explicit[0].trim().split(/\s+/);
    for (let n = 1; n <= Math.min(4, words.length); n++) candidates.push(balancedSplit(words, n));
  }
  let best = { fs: MIN_FONT, w: maxW, h: maxH, lines: candidates[0] };
  for (const lines of candidates) {
    const unitW = estimateWidth(item, lines, 1);
    const fs = Math.min(maxW / Math.max(0.001, unitW), maxH / (lines.length * lh));
    if (fs > best.fs) best = { fs, w: Math.min(maxW, unitW * fs), h: lines.length * fs * lh, lines };
  }
  return { fs: best.fs, w: best.w, h: best.h };
}

// Igual que bestTextFit pero con la fuente topada en `maxFs`: la caja se
// achica a lo que ocupa el texto con esa fuente.
function bestTextFitCapped(item: TextLayer, maxW: number, maxH: number, maxFs: number) {
  const fit = bestTextFit(item, maxW, maxH);
  if (fit.fs <= maxFs) return fit;
  const k = maxFs / fit.fs;
  return { fs: maxFs, w: fit.w * k, h: fit.h * k };
}

// Reparte `words` en `n` líneas con anchos parecidos (por caracteres).
function balancedSplit(words: string[], n: number): string[] {
  if (n <= 1) return [words.join(" ")];
  const total = words.join(" ").length;
  const target = total / n;
  const lines: string[] = [];
  let current: string[] = [];
  let currentLen = 0;
  for (const w of words) {
    const nextLen = currentLen + (current.length > 0 ? 1 : 0) + w.length;
    if (current.length > 0 && nextLen > target && lines.length < n - 1) {
      lines.push(current.join(" "));
      current = [w];
      currentLen = w.length;
    } else {
      current.push(w);
      currentLen = nextLen;
    }
  }
  if (current.length > 0) lines.push(current.join(" "));
  return lines;
}

function textLines(item: TextLayer): string[] {
  const raw = (item.content ?? "").split("\n");
  return raw.length > 0 ? raw : [""];
}

// Ancho estimado del texto en px para una fuente dada. Factor por carácter
// según peso y mayúsculas; sin medir DOM (esto corre también en servidor).
function estimateWidth(item: TextLayer, lines: string[], fs: number): number {
  const longest = lines.reduce((m, l) => Math.max(m, l.length), 1);
  const letters = lines.join("").replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, "");
  const upper = letters.replace(/[^A-ZÁÉÍÓÚÑ]/g, "").length;
  const upperRatio = letters.length > 0 ? upper / letters.length : 0;
  const forcedUpper = item.style.textTransform === "uppercase";
  const weight = Number(item.style.fontWeight ?? 400);
  const charW = 0.5 + 0.16 * (forcedUpper ? 1 : upperRatio) + (weight >= 700 ? 0.05 : 0);
  const spacing = item.style.letterSpacing ?? 0;
  return longest * (fs * charW + spacing) * 1.12 + fs * 0.4;
}

function restyleText(item: TextLayer, fs: number, w: number, h: number): TextLayer {
  const origFs = numericFont(item);
  const factor = origFs > 0 ? fs / origFs : 1;
  const styled = scaleLayerStyle(item, factor) as TextLayer;
  const size = Math.max(MIN_FONT, fs);
  return {
    ...styled,
    size: { w, h },
    style: {
      ...styled.style,
      // Rango para que SmartText corrija la estimación si se pasa; nunca
      // más grande que lo calculado.
      fontSize: { min: Math.max(MIN_FONT, size * 0.5), max: size },
      align: "center",
      verticalAlign: "middle",
    },
  };
}

function numericFont(item: TextLayer): number {
  const fs = item.style.fontSize;
  if (typeof fs === "number") return fs;
  if (isFontSizeRange(fs)) return fs.max;
  return 40;
}

function floorFont(t: TextLayer): TextLayer {
  const fs = t.style.fontSize;
  if (typeof fs === "number") return fs < MIN_FONT ? { ...t, style: { ...t.style, fontSize: MIN_FONT } } : t;
  if (isFontSizeRange(fs)) {
    return {
      ...t,
      style: { ...t.style, fontSize: { min: Math.max(MIN_FONT, fs.min), max: Math.max(MIN_FONT, fs.max) } },
    };
  }
  return t;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
