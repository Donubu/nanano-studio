// Chequeo de marca: lo que la guía de marca (practicante) exige y que el
// chequeo de diseño no mira. Devuelve LintIssue para mostrarlos junto a los
// de layout ("Revisar con IA", preflight de Descargar). No se le pasan al
// modelo de corrección: no se arreglan moviendo cajas.
//
//   - brand_logo_size: logo más chico que el mínimo del manual (o ilegible).
//   - brand_logo_space: algo invade el área de seguridad del logo.
//   - brand_missing_legal: falta un texto legal obligatorio.
//   - brand_forbidden_text: claim prohibido o palabra a evitar.
//   - brand_name_case: la marca escrita distinto a como la escribe el manual.
//
// Puro.

import type { TemplateDefinition, TemplateLayer } from "./types";
import type { BrandGuide } from "./brand-guide";
import type { LintIssue } from "./layout-lint";

// Logo ilegible aunque el manual no diga un mínimo (lado corto en px).
const ABSOLUTE_LOGO_MIN = 16;
// Área de seguridad por defecto cuando el manual la describe sin número:
// fracción del lado corto del logo.
const DEFAULT_CLEAR_SPACE = 0.25;

const isLogo = (l: TemplateLayer) => l.type === "image" && l.visible !== false && (l.id === "logo" || /^logo\b/i.test(l.name ?? ""));

export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

// Frases exigibles de un ítem de la guía: lo entre comillas y las URLs; si
// no hay y el ítem es corto, el ítem entero.
export function requiredPhrases(item: string): string[] {
  const out = new Set<string>();
  for (const m of item.matchAll(/[«"“']([^»"”']{2,120})[»"”']/g)) out.add(m[1].trim());
  for (const m of item.matchAll(/\b(?:https?:\/\/)?(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:cl|com|net|org|io|app)\b(?:\/\S*)?/gi)) out.add(m[0].trim());
  if (out.size === 0 && item.trim().length <= 40) out.add(item.trim());
  return [...out];
}

function visibleTexts(def: TemplateDefinition): { id: string; content: string }[] {
  const out: { id: string; content: string }[] = [];
  const walk = (nodes: TemplateLayer[]) => {
    for (const l of nodes) {
      if (l.visible === false) continue;
      if (l.type === "text") out.push({ id: l.id, content: l.content });
      if (l.type === "frame") walk(l.children);
    }
  };
  walk(def.children);
  return out;
}

function clearSpaceRatio(desc: string): number {
  const pct = /(\d+(?:[.,]\d+)?)\s*%/.exec(desc);
  if (pct) return Math.min(1, Number(pct[1].replace(",", ".")) / 100);
  const times = /(\d+(?:[.,]\d+)?)\s*(?:x|×|veces)/i.exec(desc);
  if (times) return Math.min(2, Number(times[1].replace(",", ".")));
  return DEFAULT_CLEAR_SPACE;
}

export function lintBrand(def: TemplateDefinition, guide: BrandGuide | null): LintIssue[] {
  const issues: LintIssue[] = [];
  const texts = visibleTexts(def);
  const corpus = texts.map((t) => normalizeText(t.content));
  const contains = (phrase: string) => {
    const p = normalizeText(phrase);
    return p.length > 0 && corpus.some((c) => c.includes(p));
  };
  const containsWord = (word: string) => {
    const w = normalizeText(word).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(^|[^a-z0-9áéíóúñ])${w}($|[^a-z0-9áéíóúñ])`, "i");
    return texts.filter((t) => re.test(normalizeText(t.content))).map((t) => t.id);
  };

  // Logo: tamaño mínimo y área de seguridad.
  const logos = def.children.filter(isLogo);
  const minPx = guide?.visual.logo.ancho_min_px ?? null;
  for (const logo of logos) {
    const short = Math.min(logo.size.w, logo.size.h);
    if (minPx && logo.size.w < minPx - 0.5) {
      issues.push({
        kind: "brand_logo_size",
        severity: "error",
        layerIds: [logo.id],
        detail: `el logo mide ${Math.round(logo.size.w)}px de ancho; el manual exige al menos ${minPx}px`,
      });
    } else if (short < ABSOLUTE_LOGO_MIN) {
      issues.push({
        kind: "brand_logo_size",
        severity: "warning",
        layerIds: [logo.id],
        detail: `el logo mide ${Math.round(short)}px en su lado corto: no se lee`,
      });
    }
    const space = guide?.visual.logo.area_seguridad ? clearSpaceRatio(guide.visual.logo.area_seguridad) * short : 0;
    if (space > 0) {
      const zone = { x: logo.position.x - space, y: logo.position.y - space, w: logo.size.w + 2 * space, h: logo.size.h + 2 * space };
      for (const l of def.children) {
        if (l === logo || l.visible === false || l.id === `${logo.id}-plate`) continue;
        if (l.type === "image" && l.size.w >= def.size.w * 0.75) continue; // fondo
        // Contenedor del logo (placa, caja): no invade, lo sostiene.
        const holds =
          l.position.x <= logo.position.x && l.position.y <= logo.position.y &&
          l.position.x + l.size.w >= logo.position.x + logo.size.w &&
          l.position.y + l.size.h >= logo.position.y + logo.size.h;
        if (holds) continue;
        const hit = l.position.x < zone.x + zone.w && zone.x < l.position.x + l.size.w && l.position.y < zone.y + zone.h && zone.y < l.position.y + l.size.h;
        if (hit) {
          const label = l.type === "text" ? `«${l.content.slice(0, 30)}»` : l.name ?? l.type;
          issues.push({
            kind: "brand_logo_space",
            severity: "warning",
            layerIds: [l.id, logo.id],
            detail: `${label} invade el área de seguridad del logo (${Math.round(space)}px alrededor)`,
          });
        }
      }
    }
  }

  if (!guide) return issues;

  // Legales obligatorios.
  for (const item of guide.legales?.textos_obligatorios ?? []) {
    for (const phrase of requiredPhrases(item)) {
      if (!contains(phrase)) {
        issues.push({ kind: "brand_missing_legal", severity: "error", layerIds: [], detail: `falta el legal obligatorio: «${phrase}»` });
      }
    }
  }

  // Claims prohibidos (de las restricciones, entre comillas) y palabras a evitar.
  for (const item of guide.legales?.restricciones ?? []) {
    for (const phrase of requiredPhrases(item).filter((p) => p !== item.trim())) {
      const ids = containsWord(phrase);
      if (ids.length) issues.push({ kind: "brand_forbidden_text", severity: "error", layerIds: ids, detail: `usa un claim prohibido por la marca: «${phrase}»` });
    }
  }
  for (const word of guide.voz.palabras_evitar) {
    const ids = containsWord(word);
    if (ids.length) issues.push({ kind: "brand_forbidden_text", severity: "warning", layerIds: ids, detail: `usa una palabra que la marca evita: «${word}»` });
  }

  // Nombre de la marca tal como lo escribe el manual. No cuenta dentro de
  // URLs/correos ni en textos todo en mayúsculas (es estilo, no ortografía).
  const brand = guide.marca.trim();
  if (brand.length >= 3) {
    const re = new RegExp(`(^|[^\\p{L}\\p{N}./@])(${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?=$|[^\\p{L}\\p{N}.])`, "iu");
    for (const t of texts) {
      if (t.content === t.content.toUpperCase()) continue;
      const m = re.exec(t.content);
      if (m && m[2] !== brand) {
        issues.push({ kind: "brand_name_case", severity: "warning", layerIds: [t.id], detail: `la marca está escrita «${m[2]}»; el manual la escribe «${brand}»` });
      }
    }
  }
  return issues;
}
