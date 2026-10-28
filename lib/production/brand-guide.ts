// Guía de marca de un cliente, traída de practicante.
//
// Practicante es la fuente del conocimiento de marca (brandbook indexado,
// tono de voz, normas gráficas por cliente, identificado por slug). nanano
// NO lo consulta durante una generación: se sincroniza a pedido y queda un
// snapshot en clients.brand_guide_json, que la IA de producción lee como
// contexto (layout-planner.ts).
//
// Mientras practicante no tenga un endpoint dedicado, la sincronización usa
// /api/external/run (orquestador) con el prompt de abajo y pide JSON.

export interface BrandGuide {
  marca: string;
  voz: {
    tono: string;
    personalidad: string[];
    // "tú" | "usted" | "voseo" | texto libre del brandbook
    tratamiento: string;
    palabras_usar: string[];
    palabras_evitar: string[];
    ejemplos_titulares: string[];
    ejemplos_cta: string[];
  };
  visual: {
    colores: { nombre: string; hex: string; uso: string }[];
    tipografias: { nombre: string; uso: string }[];
    logo: { ancho_min_px: number | null; area_seguridad: string; usos_prohibidos: string[] };
    estilo_fotografico: string;
  };
  reglas: string[];
  fuentes: string[];
}

export function brandGuidePrompt(slug: string): { message: string; promptSuffix: string } {
  return {
    message: `Necesito la guía de marca completa del cliente con slug "${slug}" para diseñar banners. Revisa su brandbook y todo lo que tengas de la marca (estrategia, productos, campañas) y devuélvemelo en el JSON pedido.`,
    promptSuffix: JSON.stringify({
      operation: "BRAND_GUIDE",
      client_slug: slug,
      instructions: [
        `Consulta el brandbook del cliente "${slug}" y cualquier otro conocimiento de esa marca (estrategia, productos, campañas, reglas de marca medibles).`,
        "Resume lo que sirve para diseñar piezas digitales: voz, tratamiento, vocabulario, reglas visuales y de logo.",
        "Si un dato no está en el material de la marca, déjalo vacío. No inventes.",
        "Responde SOLO con un objeto JSON con esta forma exacta (sin markdown):",
      ],
      schema: {
        marca: "string",
        voz: {
          tono: "string — 1-2 frases",
          personalidad: ["adjetivo"],
          tratamiento: "tú | usted | voseo | otro",
          palabras_usar: ["string"],
          palabras_evitar: ["string"],
          ejemplos_titulares: ["string"],
          ejemplos_cta: ["string"],
        },
        visual: {
          colores: [{ nombre: "string", hex: "#RRGGBB", uso: "string" }],
          tipografias: [{ nombre: "string", uso: "string" }],
          logo: { ancho_min_px: "number | null", area_seguridad: "string", usos_prohibidos: ["string"] },
          estilo_fotografico: "string",
        },
        reglas: ["do's & don'ts, una por ítem"],
        fuentes: ["documentos o tools consultados"],
      },
    }),
  };
}

const str = (v: unknown, max = 500) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const strs = (v: unknown, max = 30, len = 300) =>
  (Array.isArray(v) ? v : []).map((x) => str(x, len)).filter(Boolean).slice(0, max);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

// Tolera fences y texto alrededor del JSON (el orquestador a veces explica).
export function parseBrandGuide(raw: string): BrandGuide | null {
  let text = raw.trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  text = text.slice(start, end + 1);
  let data: Record<string, unknown>;
  try {
    data = obj(JSON.parse(text));
  } catch {
    return null;
  }
  const voz = obj(data.voz);
  const visual = obj(data.visual);
  const logo = obj(visual.logo);
  const guide: BrandGuide = {
    marca: str(data.marca, 120),
    voz: {
      tono: str(voz.tono, 600),
      personalidad: strs(voz.personalidad, 12, 60),
      tratamiento: str(voz.tratamiento, 300),
      palabras_usar: strs(voz.palabras_usar, 40, 80),
      palabras_evitar: strs(voz.palabras_evitar, 40, 80),
      ejemplos_titulares: strs(voz.ejemplos_titulares, 12, 160),
      ejemplos_cta: strs(voz.ejemplos_cta, 12, 60),
    },
    visual: {
      colores: (Array.isArray(visual.colores) ? visual.colores : [])
        .map((c) => obj(c))
        .map((c) => ({ nombre: str(c.nombre, 60), hex: str(c.hex, 9), uso: str(c.uso, 160) }))
        .filter((c) => /^#[0-9a-f]{3,8}$/i.test(c.hex))
        .slice(0, 16),
      tipografias: (Array.isArray(visual.tipografias) ? visual.tipografias : [])
        .map((t) => obj(t))
        .map((t) => ({ nombre: str(t.nombre, 80), uso: str(t.uso, 160) }))
        .filter((t) => t.nombre)
        .slice(0, 8),
      logo: {
        ancho_min_px:
          typeof logo.ancho_min_px === "number" && Number.isFinite(logo.ancho_min_px) ? logo.ancho_min_px : null,
        area_seguridad: str(logo.area_seguridad, 800),
        usos_prohibidos: strs(logo.usos_prohibidos, 20, 160),
      },
      estilo_fotografico: str(visual.estilo_fotografico, 600),
    },
    reglas: strs(data.reglas, 40, 300),
    fuentes: strs(data.fuentes, 20, 200),
  };
  const hasContent =
    guide.voz.tono || guide.reglas.length > 0 || guide.visual.colores.length > 0 || guide.voz.palabras_usar.length > 0;
  return hasContent ? guide : null;
}

// Versión compacta para el contexto del modelo: sin vacíos ni fuentes.
export function brandGuideForModel(g: BrandGuide): Record<string, unknown> {
  const prune = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      const a = v.map(prune).filter((x) => x !== undefined);
      return a.length ? a : undefined;
    }
    if (v && typeof v === "object") {
      const entries = Object.entries(v)
        .map(([k, x]) => [k, prune(x)] as const)
        .filter(([, x]) => x !== undefined);
      return entries.length ? Object.fromEntries(entries) : undefined;
    }
    if (v === "" || v == null) return undefined;
    return v;
  };
  const { fuentes: _fuentes, ...rest } = g;
  void _fuentes;
  return (prune(rest) as Record<string, unknown>) ?? {};
}
