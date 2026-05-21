// HTML5 ad export pipeline.
//
// Convierte una adaptación (master + dims + brand_kit + animation opcional) a
// un ZIP self-contained con un único index.html compatible con IAB / GDN:
//
//   - <meta name="ad.size" content="width=W,height=H"> para que el ad server
//     detecte las dimensiones.
//   - clickTag stub al inicio (var clickTag = "..."), wrapper <a> alrededor
//     del banner. GDN sustituye el clickTag al servir; el productor puede
//     poner el destino dummy desde la UI.
//   - <link> a Google Fonts (sin proxy) para todas las font families usadas
//     en el árbol — IAB acepta linked Google Fonts (no son "external assets"
//     en el sentido restrictivo).
//   - CSS inline en cada layer (renderToStaticMarkup sobre el mismo
//     AdaptationRenderer que usa el export JPG).
//   - Imágenes embebidas como data URI (fetch + FileReader). Aumenta el peso
//     del HTML pero hace el ZIP enteramente offline-runnable.
//   - WAAPI inline script: ANIM_TRACKS objeto con keyframes por layer.id,
//     itera todos los [data-layer-id="<id>"] y llama element.animate(..) con
//     duration + iterations del AnimationConfig. Transform, filter, color y
//     bg se componen correctamente para no pisarse entre sí.
//
// Limitaciones conocidas (MVP):
//   - SmartText (auto-fit por binary search) renderea al fontSize máximo del
//     range. Para export pixel-perfect, el productor debe convertir el
//     fontSize a literal antes de exportar.
//   - Color tracks sobre IconLayer no aplican (lucide renderea SVG con stroke
//     embebido; animar via WAAPI requiere targetear el SVG hijo). Para texto
//     y shape sí funciona.
//   - manual_layout overrides no llevan animation (mismo comportamiento que
//     el preview en producir).

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import JSZip from "jszip";
import {
  TemplateDefinition,
  TemplateLayer,
} from "./types";
import { BrandKitContent } from "./brand-kit";
import { DataRow } from "./variables";
import {
  AnimatableProperty,
  AnimationConfig,
  AnimationTrack,
  easingToCss,
  getBaseValue,
  sampleTrack,
} from "./animation";
import { reflowForPreview } from "./reflow";
import { parseOverrides } from "./overrides";
import { substituteVariables } from "./variables";
import { AdaptationRenderer } from "@/components/production/render/adaptation-renderer";

type FitMode = "contain" | "cover" | "width" | "height" | "responsive";

export interface Html5ExportAdaptation {
  width: number;
  height: number;
  fit_mode: FitMode;
  overrides_json: string | null;
}

export interface BuildHtml5Options {
  adaptation: Html5ExportAdaptation;
  master: TemplateDefinition;
  brandKit: BrandKitContent;
  dataRow?: DataRow | null;
  // URL placeholder para el clickTag. Default "https://example.com" — el ad
  // server (GDN, DV360, etc) lo sobreescribe al serving time.
  clickTag?: string;
  // Si true (default), descarga las imágenes vía fetch y las embebe como
  // data URI. Si la fetch falla por CORS, se deja el src remoto y el
  // navegador lo cargará en runtime (el ZIP queda menos portable).
  inlineImages?: boolean;
  // Título del documento HTML (queda en <title>). Útil para diferenciar en
  // dashboards de ad servers. Default: "<masterName> <WxH>".
  title?: string;
}

// ---------- Public API ----------

export async function buildHtml5Document(opts: BuildHtml5Options): Promise<string> {
  const inlineImages = opts.inlineImages ?? true;
  const { effectiveAnimation, effectiveTree, fontFamilies, inner } = renderInner(opts);
  const adW = opts.adaptation.width;
  const adH = opts.adaptation.height;
  const title = opts.title ?? `Banner ${adW}x${adH}`;
  const fontsLink = fontFamilies.size > 0 ? buildGoogleFontsLink([...fontFamilies]) : null;
  const animScript = effectiveAnimation && effectiveTree
    ? buildAnimationScript(effectiveAnimation, effectiveTree)
    : null;
  const clickTag = opts.clickTag ?? "https://example.com";

  let html = renderHtmlDocument({
    title,
    width: adW,
    height: adH,
    fontsLink,
    clickTag,
    innerBody: inner,
    animationScript: animScript,
  });
  if (inlineImages) {
    html = await inlineRemoteImages(html);
  }
  return html;
}

export async function buildHtml5Zip(opts: BuildHtml5Options): Promise<Blob> {
  const html = await buildHtml5Document(opts);
  const zip = new JSZip();
  zip.file("index.html", html);
  return zip.generateAsync({ type: "blob" });
}

// ---------- Render the React tree to static markup ----------

function renderInner(opts: BuildHtml5Options): {
  inner: string;
  effectiveAnimation: AnimationConfig | null;
  // Árbol que está siendo renderizado en CSS — mismo que usa el browser.
  // Necesario para que el script WAAPI conozca los valores base de cada
  // layer (sin esto, los translate(dx) se calculan contra el primer kf y
  // explotan cuando el primer kf no está en t=0).
  effectiveTree: TemplateDefinition | null;
  fontFamilies: Set<string>;
} {
  const { adaptation, master, brandKit, dataRow } = opts;
  // El mismo flow que AdaptationRenderer:
  //   manual_layout > responsive > scale-based.
  // Para WAAPI, también calculamos la animation efectiva que verá el browser:
  //   - manual_layout: sin animation.
  //   - responsive: reflowForPreview ya propaga la animación reescalada.
  //   - scale-based: usamos master.animation tal cual (vive dentro del wrapper
  //     scale, así que las px se escalan visualmente solo).
  const overrides = parseOverrides(adaptation.overrides_json);
  const manualLayout = overrides.manual_layout && dataRow
    ? substituteVariables(overrides.manual_layout, dataRow)
    : overrides.manual_layout;

  let effectiveAnimation: AnimationConfig | null = null;
  let effectiveTree: TemplateDefinition | null = null;
  if (manualLayout) {
    effectiveAnimation = null;
    effectiveTree = null;
  } else {
    const effectiveMaster = dataRow ? substituteVariables(master, dataRow) : master;
    if (adaptation.fit_mode === "responsive") {
      const reflowed = reflowForPreview(effectiveMaster, {
        w: adaptation.width,
        h: adaptation.height,
      });
      effectiveAnimation = reflowed.animation ?? null;
      effectiveTree = reflowed;
    } else {
      effectiveAnimation = effectiveMaster.animation ?? null;
      effectiveTree = effectiveMaster;
    }
  }

  // Render React → HTML string.
  const treeForRender = manualLayout ?? master;
  const fontFamilies = collectFontFamilies(treeForRender);

  const inner = renderToStaticMarkup(
    createElement(AdaptationRenderer, {
      adaptation,
      master,
      brandKit,
      dataRow: dataRow ?? null,
    }),
  );
  return { inner, effectiveAnimation, effectiveTree, fontFamilies };
}

// Indexa todos los layers del árbol por id. Lo usamos en buildAnimationScript
// para resolver el "base value" de cada propiedad animable sin volver a
// caminar el árbol N veces.
function indexLayers(root: TemplateDefinition): Map<string, TemplateLayer> {
  const out = new Map<string, TemplateLayer>();
  function walk(l: TemplateLayer) {
    out.set(l.id, l);
    if (l.type === "frame") for (const c of l.children) walk(c);
  }
  walk(root);
  return out;
}

// ---------- HTML document scaffolding ----------

interface DocOptions {
  title: string;
  width: number;
  height: number;
  fontsLink: string | null;
  clickTag: string;
  innerBody: string;
  animationScript: string | null;
}

function renderHtmlDocument(opts: DocOptions): string {
  const { title, width, height, fontsLink, clickTag, innerBody, animationScript } = opts;
  // El body se centra y el banner queda en (0,0). Los ad servers suelen
  // inyectar el iframe del tamaño exacto, así que no necesitamos viewport
  // meta — usamos width/height literal.
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="ad.size" content="width=${width},height=${height}">
  <title>${escapeHtml(title)}</title>
  <style>
    html, body { margin: 0; padding: 0; background: transparent; }
    body { width: ${width}px; height: ${height}px; overflow: hidden; }
    a.ad-click { display: block; width: 100%; height: 100%; cursor: pointer; text-decoration: none; color: inherit; }
    /* Reset mínimo para que los layers floten correctamente en cualquier ad server. */
    * { box-sizing: border-box; }
  </style>
  ${fontsLink ? `<link rel="stylesheet" href="${escapeAttr(fontsLink)}">` : ""}
  <script>var clickTag = ${JSON.stringify(clickTag)};</script>
</head>
<body>
  <a class="ad-click" href="javascript:window.open(window.clickTag);">
    ${innerBody}
  </a>
  ${animationScript ? `<script>${animationScript}</script>` : ""}
</body>
</html>`;
}

// ---------- Font families collection ----------

function collectFontFamilies(layer: TemplateLayer): Set<string> {
  const out = new Set<string>();
  walk(layer);
  return out;
  function walk(l: TemplateLayer) {
    if (l.type === "text" && l.style.fontFamily) {
      // fontFamily puede venir con comillas o quoted CSS string. Lo normalizamos
      // tomando solo el primer family de la lista (sin comillas/fallbacks).
      const first = l.style.fontFamily.split(",")[0].replace(/['"]/g, "").trim();
      if (first) out.add(first);
    }
    if (l.type === "frame") {
      for (const c of l.children) walk(c);
    }
  }
}

function buildGoogleFontsLink(families: string[]): string {
  // Google Fonts v2 acepta múltiples family= params y wght@... para weights.
  // Pedimos los weights más comunes (300-900) para no tener que conocer cuál
  // usa el productor. Es ~30-50KB extra por familia y queda cacheado del lado
  // del ad server.
  const weights = "100;200;300;400;500;600;700;800;900";
  const params = families
    .map((f) => {
      const plus = encodeURIComponent(f).replace(/%20/g, "+");
      return `family=${plus}:wght@${weights}`;
    })
    .join("&");
  return `https://fonts.googleapis.com/css2?${params}&display=swap`;
}

// ---------- WAAPI animation script ----------

interface SerializedTrack {
  // Keyframes ya serializados como objetos { offset, ...cssProps, easing? }
  // listos para pasar a element.animate().
  keyframes: Record<string, string | number>[];
}

interface SerializedLayerAnims {
  // layer.id → array de "track aggregates". En la práctica usamos UN solo
  // track agregado por layer (composing transform/filter), pero dejamos el
  // shape como array para futura extensión (ej. animar background y border
  // independientemente con offsets distintos).
  [layerId: string]: SerializedTrack[];
}

function buildAnimationScript(
  animation: AnimationConfig,
  effectiveTree: TemplateDefinition,
): string {
  if (animation.tracks.length === 0) return "";
  // Agrupamos tracks por layerId para componer las keyframes.
  const tracksByLayer = new Map<string, AnimationTrack[]>();
  for (const tr of animation.tracks) {
    let list = tracksByLayer.get(tr.layerId);
    if (!list) {
      list = [];
      tracksByLayer.set(tr.layerId, list);
    }
    list.push(tr);
  }
  const layersById = indexLayers(effectiveTree);
  const serialized: SerializedLayerAnims = {};
  for (const [layerId, tracks] of tracksByLayer) {
    const layer = layersById.get(layerId);
    if (!layer) continue; // track huérfano — el layer ya no existe
    serialized[layerId] = [
      { keyframes: composeKeyframesForLayer(tracks, animation.duration, layer) },
    ];
  }
  const iterations =
    animation.loop === "infinite" ? '"infinite"' : String(animation.loop);
  // Runtime: encontrar cada layer por data-layer-id e invocar animate() con
  // los keyframes serializados. Soportamos múltiples tracks por layer
  // (aunque hoy solo emitimos uno) por compatibilidad futura.
  return `
(function(){
  var ANIM = ${JSON.stringify(serialized)};
  var OPTS = { duration: ${animation.duration}, iterations: ${iterations}, fill: "both" };
  function start(){
    Object.keys(ANIM).forEach(function(id){
      var el = document.querySelector('[data-layer-id="' + id + '"]');
      if (!el) return;
      ANIM[id].forEach(function(track){
        try { el.animate(track.keyframes, OPTS); } catch(e) { console.warn("animate failed", id, e); }
      });
    });
  }
  if (document.readyState === "complete" || document.readyState === "interactive") start();
  else document.addEventListener("DOMContentLoaded", start);
})();
`.trim();
}

// Para un layer con múltiples tracks, construye UN array de keyframes
// WAAPI que combina todas las propiedades animadas. transform y filter se
// componen como strings unificados (no se pueden tener dos transform CSS
// activos a la vez); las demás props se setean cada una por separado.
function composeKeyframesForLayer(
  tracks: AnimationTrack[],
  duration: number,
  layer: TemplateLayer,
): Record<string, string | number>[] {
  if (duration <= 0) return [];
  const trackByProp = new Map<AnimatableProperty, AnimationTrack>();
  for (const tr of tracks) trackByProp.set(tr.property, tr);

  // Tiempos únicos (union) ordenados.
  const tSet = new Set<number>();
  for (const tr of tracks) for (const kf of tr.keyframes) tSet.add(kf.t);
  const times = [...tSet].sort((a, b) => a - b);

  // ¿Cuáles props inyectan en transform / filter? Si alguna está animada,
  // componemos el string completo en cada kf.
  const animatesTransform =
    trackByProp.has("position.x") ||
    trackByProp.has("position.y") ||
    trackByProp.has("rotation") ||
    trackByProp.has("scale") ||
    trackByProp.has("scale.x") ||
    trackByProp.has("scale.y");
  const animatesFilter = trackByProp.has("blur");

  // Valores base del LAYER (no del primer kf). Los usamos para:
  //   1. Calcular dx/dy en transform: translate (CSS deja left/top con
  //      layer.position, así que el delta se mide contra eso).
  //   2. Inyectar el componente static al transform compuesto cuando alguna
  //      de las otras props animadas activa el transform (ej. solo se
  //      anima rotation pero el layer tiene scaleX=1.5 base — el transform
  //      del kf debe llevar también scale(1.5) para no perder esa base).
  const baseX = Number(getBaseValue(layer, "position.x"));
  const baseY = Number(getBaseValue(layer, "position.y"));
  const baseRot = Number(getBaseValue(layer, "rotation"));
  const baseScaleX = Number(getBaseValue(layer, "scale.x"));
  const baseScaleY = Number(getBaseValue(layer, "scale.y"));
  const baseBlur = Number(getBaseValue(layer, "blur"));

  return times.map((t) => {
    const kf: Record<string, string | number> = {
      offset: clamp01(t / duration),
    };

    if (trackByProp.has("opacity")) {
      const tr = trackByProp.get("opacity")!;
      kf.opacity = sampleNumber(tr, t, Number(getBaseValue(layer, "opacity")));
    }
    if (trackByProp.has("size.w")) {
      const tr = trackByProp.get("size.w")!;
      kf.width = `${sampleNumber(tr, t, Number(getBaseValue(layer, "size.w")))}px`;
    }
    if (trackByProp.has("size.h")) {
      const tr = trackByProp.get("size.h")!;
      kf.height = `${sampleNumber(tr, t, Number(getBaseValue(layer, "size.h")))}px`;
    }
    if (animatesTransform) {
      // La animation NO modifica left/top — el layer ya está posicionado
      // con left=baseX, top=baseY. Cuando animamos position, usamos
      // transform: translate(dx, dy) con dx = sampled - baseX.
      // Para rotation/scale, si está animada usamos el sampled; si no, el
      // base del layer (para que el transform compuesto preserve la
      // rotación/escala estática).
      const x = trackByProp.has("position.x")
        ? sampleNumber(trackByProp.get("position.x")!, t, baseX)
        : baseX;
      const y = trackByProp.has("position.y")
        ? sampleNumber(trackByProp.get("position.y")!, t, baseY)
        : baseY;
      const rot = trackByProp.has("rotation")
        ? sampleNumber(trackByProp.get("rotation")!, t, baseRot)
        : baseRot;
      const sX = trackByProp.has("scale.x")
        ? sampleNumber(trackByProp.get("scale.x")!, t, baseScaleX)
        : trackByProp.has("scale")
          ? sampleNumber(trackByProp.get("scale")!, t, baseScaleX)
          : baseScaleX;
      const sY = trackByProp.has("scale.y")
        ? sampleNumber(trackByProp.get("scale.y")!, t, baseScaleY)
        : trackByProp.has("scale")
          ? sampleNumber(trackByProp.get("scale")!, t, baseScaleY)
          : baseScaleY;
      const parts: string[] = [];
      const dx = x - baseX;
      const dy = y - baseY;
      parts.push(`translate(${round(dx)}px, ${round(dy)}px)`);
      if (rot !== 0) parts.push(`rotate(${round(rot)}deg)`);
      if (sX !== 1 || sY !== 1) {
        parts.push(sX === sY ? `scale(${roundDec(sX)})` : `scale(${roundDec(sX)}, ${roundDec(sY)})`);
      }
      kf.transform = parts.join(" ") || "none";
    }
    if (animatesFilter) {
      const b = sampleNumber(trackByProp.get("blur")!, t, baseBlur);
      kf.filter = `blur(${round(b)}px)`;
    }
    if (trackByProp.has("color")) {
      const tr = trackByProp.get("color")!;
      const baseColor = String(getBaseValue(layer, "color"));
      const val = sampleTrack(tr, t, baseColor);
      const sval = String(val);
      // Targeting:
      //   - text  → CSS "color".
      //   - shape → CSS "backgroundColor".
      //   - icon  → no aplicable (lucide SVG con stroke embebido).
      if (layer.type === "text") kf.color = sval;
      else if (layer.type === "shape") kf.backgroundColor = sval;
      // icon: skip (limitación documentada en el header).
    }

    // Easing hacia el siguiente keyframe. WAAPI: la propiedad `easing` de un
    // keyframe define la transición DESDE este kf hasta el siguiente. Misma
    // semántica que nuestro modelo. Usamos el easing del PRIMER track que
    // tenga un kf en este t.
    for (const tr of tracks) {
      const matching = tr.keyframes.find((k) => k.t === t);
      if (matching) {
        const css = easingToCss(matching.easing);
        if (css !== "linear") kf.easing = css;
        break;
      }
    }

    return kf;
  });
}

function sampleNumber(tr: AnimationTrack, t: number, fallback: number): number {
  const v = sampleTrack(tr, t, fallback);
  return typeof v === "number" ? v : fallback;
}

function clamp01(n: number): number {
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

function roundDec(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// ---------- Image inlining ----------

async function inlineRemoteImages(html: string): Promise<string> {
  const srcs = new Set<string>();
  const re = /<img\b[^>]*\ssrc="([^"]+)"/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) srcs.add(m[1]);
  if (srcs.size === 0) return html;
  const cache = new Map<string, string>();
  await Promise.all(
    [...srcs].map(async (src) => {
      if (src.startsWith("data:")) return;
      try {
        const res = await fetch(src, { cache: "force-cache" });
        if (!res.ok) return;
        const blob = await res.blob();
        const dataUrl = await blobToDataUrl(blob);
        cache.set(src, dataUrl);
      } catch (err) {
        console.warn("HTML5 export: no se pudo inlinear imagen", src, err);
      }
    }),
  );
  // Replace each src="..." in the html. Doble pasada porque querySelectorAll
  // no nos da regex match positions; el regex con capture groups sí.
  return html.replace(/(<img\b[^>]*\ssrc=")([^"]+)(")/gi, (_, pre, src, post) => {
    const replacement = cache.get(src) ?? src;
    return `${pre}${replacement}${post}`;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// ---------- Escapers ----------

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function escapeAttr(s: string): string {
  return s.replace(/"/g, "&quot;");
}
