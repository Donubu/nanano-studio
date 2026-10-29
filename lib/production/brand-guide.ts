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
    logo: {
      ancho_min_px: number | null;
      area_seguridad: string;
      // Área de seguridad en fracción de la altura del logo (0.25 = un
      // cuarto del alto a cada lado). null si el manual no da cifra; el
      // chequeo de marca asume 0.25.
      area_seguridad_fraccion?: number | null;
      usos_prohibidos: string[];
    };
    estilo_fotografico: string;
  };
  // Estrategia y negocio: qué comunicar (posicionamiento, público, mensajes,
  // productos, campañas vigentes). Opcional: los snapshots sincronizados
  // antes de 2026-10-28 no lo traen.
  estrategia?: {
    posicionamiento: string;
    publico_objetivo: string;
    propuesta_valor: string;
    mensajes_clave: string[];
    productos: { nombre: string; descripcion: string }[];
    campanas_vigentes: string[];
  };
  // Lo que dicen las métricas de la marca (campañas y piezas anteriores):
  // qué mensajes, CTA, formatos y estilos rinden. Opcional.
  desempeno?: {
    periodo: string;
    aprendizajes: string[];
    mensajes_destacados: Evidencia[];
    mensajes_a_evitar: Evidencia[];
    ctas_destacados: Evidencia[];
    formatos_destacados: { formato: string; canal: string; resultado: string }[];
    estilos_visuales: string[];
    // Anuncios reales con sus métricas. La imagen la re-sube nanano a su
    // bucket al sincronizar (brand-pieces.ts): las URLs de las plataformas
    // de medios expiran.
    piezas?: PiezaReal[];
  };
  // Textos legales obligatorios y restricciones de claims. Opcional.
  legales?: {
    textos_obligatorios: string[];
    restricciones: string[];
  };
  reglas: string[];
  fuentes: string[];
  // Trazabilidad de la última sincronización (no va al modelo).
  sync?: { agente: string; costo_usd: number | null; tools: string[] };
}

export interface PiezaReal {
  // URL en nuestro bucket ("" si no se pudo traer).
  imagen: string;
  // URL que mandó practicante (solo para reintentar la descarga).
  imagen_origen: string;
  texto: string;
  formato: string;
  canal: string;
  campana: string;
  periodo: string;
  resultado: string;
  rendimiento: "alto" | "bajo";
  por_que: string;
  // Descripción de la imagen hecha por visión de IA en practicante
  // (composición, jerarquía, colores, tipo de foto, cuánto texto).
  descripcion_visual: string;
}

export interface Evidencia {
  texto: string;
  // Métrica que lo respalda, ej. "CTR 1,8% vs 0,9% promedio (Meta, sep 2026)".
  resultado: string;
}

export function brandGuidePrompt(slug: string): { message: string; promptSuffix: string } {
  return {
    message: `Necesito la guía de marca completa del cliente con slug "${slug}" para diseñar banners. Revisa su brandbook, su estrategia, productos y campañas, y sus métricas de campañas y piezas anteriores, y devuélvemelo en el JSON pedido.`,
    promptSuffix: JSON.stringify({
      operation: "BRAND_GUIDE",
      client_slug: slug,
      instructions: [
        `Consulta el brandbook del cliente "${slug}" y cualquier otro conocimiento de esa marca (estrategia, productos, campañas, reglas de marca medibles).`,
        "Resume lo que sirve para diseñar y escribir piezas digitales: voz, tratamiento, vocabulario, estrategia (posicionamiento, público, propuesta de valor, mensajes clave, productos y campañas vigentes), reglas visuales y de logo, y legales.",
        "En 'desempeno' resume lo que dicen las métricas: qué mensajes, CTA, formatos y estilos visuales rindieron mejor o peor, cada uno con la métrica que lo respalda. Si no hay métricas, déjalo vacío.",
        "En 'desempeno.piezas' incluye hasta 6 anuncios reales que mejor rindieron y hasta 3 que peor rindieron, con la URL de su imagen, su copy y sus métricas.",
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
          logo: {
            ancho_min_px: "number | null",
            area_seguridad: "string — cómo la describe el manual",
            area_seguridad_fraccion: "number | null — la misma área como fracción de la altura del logo (0.25 = un cuarto del alto a cada lado); null si el manual no da cifra",
            usos_prohibidos: ["string"],
          },
          estilo_fotografico: "string",
        },
        estrategia: {
          posicionamiento: "string — cómo quiere ser percibida la marca, 1-2 frases",
          publico_objetivo: "string — a quién le habla",
          propuesta_valor: "string — por qué elegirla",
          mensajes_clave: ["string — ideas que la marca repite"],
          productos: [{ nombre: "string", descripcion: "string — beneficio principal" }],
          campanas_vigentes: ["string — campaña o promoción activa y su mensaje"],
        },
        desempeno: {
          periodo: "string — período de las métricas consideradas",
          aprendizajes: ["string — conclusión accionable para piezas nuevas"],
          mensajes_destacados: [{ texto: "string", resultado: "string — métrica que lo respalda" }],
          mensajes_a_evitar: [{ texto: "string", resultado: "string" }],
          ctas_destacados: [{ texto: "string", resultado: "string" }],
          formatos_destacados: [{ formato: "string — ej. 300x250", canal: "string", resultado: "string" }],
          estilos_visuales: ["string — estilo que rinde mejor y su métrica"],
          piezas: [
            {
              imagen_url: "string — URL https pública de la imagen del anuncio (o data:image/...;base64)",
              texto: "string — copy visible en la pieza",
              formato: "string — tamaño o placement",
              canal: "string",
              campana: "string",
              periodo: "string",
              resultado: "string — métricas con comparación",
              rendimiento: "alto | bajo",
              por_que: "string — qué explica el resultado",
              descripcion_visual: "string — descripción de la imagen (composición, jerarquía, colores, foto/render, cuánto texto)",
            },
          ],
        },
        legales: {
          textos_obligatorios: ["string — legal que debe ir en las piezas"],
          restricciones: ["string — claims o palabras que no se pueden usar"],
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
  const estrategia = obj(data.estrategia);
  const desempeno = obj(data.desempeno);
  const legales = obj(data.legales);
  const evidencias = (v: unknown, max: number) =>
    (Array.isArray(v) ? v : [])
      .map((x) => obj(x))
      .map((x) => ({ texto: str(x.texto, 200), resultado: str(x.resultado, 200) }))
      .filter((x) => x.texto)
      .slice(0, max);
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
        area_seguridad_fraccion:
          typeof logo.area_seguridad_fraccion === "number" && Number.isFinite(logo.area_seguridad_fraccion) && logo.area_seguridad_fraccion > 0
            ? Math.min(2, logo.area_seguridad_fraccion)
            : null,
        usos_prohibidos: strs(logo.usos_prohibidos, 20, 160),
      },
      estilo_fotografico: str(visual.estilo_fotografico, 600),
    },
    estrategia: {
      posicionamiento: str(estrategia.posicionamiento, 600),
      publico_objetivo: str(estrategia.publico_objetivo, 600),
      propuesta_valor: str(estrategia.propuesta_valor, 400),
      mensajes_clave: strs(estrategia.mensajes_clave, 12, 200),
      productos: (Array.isArray(estrategia.productos) ? estrategia.productos : [])
        .map((x) => obj(x))
        .map((x) => ({ nombre: str(x.nombre, 80), descripcion: str(x.descripcion, 200) }))
        .filter((x) => x.nombre)
        .slice(0, 20),
      campanas_vigentes: strs(estrategia.campanas_vigentes, 10, 300),
    },
    desempeno: {
      periodo: str(desempeno.periodo, 120),
      aprendizajes: strs(desempeno.aprendizajes, 15, 300),
      mensajes_destacados: evidencias(desempeno.mensajes_destacados, 10),
      mensajes_a_evitar: evidencias(desempeno.mensajes_a_evitar, 10),
      ctas_destacados: evidencias(desempeno.ctas_destacados, 10),
      formatos_destacados: (Array.isArray(desempeno.formatos_destacados) ? desempeno.formatos_destacados : [])
        .map((x) => obj(x))
        .map((x) => ({ formato: str(x.formato, 40), canal: str(x.canal, 60), resultado: str(x.resultado, 200) }))
        .filter((x) => x.formato)
        .slice(0, 10),
      estilos_visuales: strs(desempeno.estilos_visuales, 10, 300),
      piezas: (Array.isArray(desempeno.piezas) ? desempeno.piezas : [])
        .map((x) => obj(x))
        .map(
          (x): PiezaReal => ({
            imagen: "",
            imagen_origen: str(x.imagen_url ?? x.imagen, 4000),
            texto: str(x.texto, 300),
            formato: str(x.formato, 60),
            canal: str(x.canal, 60),
            campana: str(x.campana, 160),
            periodo: str(x.periodo, 80),
            resultado: str(x.resultado, 300),
            rendimiento: str(x.rendimiento, 10).toLowerCase() === "bajo" ? "bajo" : "alto",
            por_que: str(x.por_que, 300),
            descripcion_visual: str(x.descripcion_visual ?? x.descripcion, 800),
          }),
        )
        .filter((x) => x.imagen_origen || x.texto)
        .slice(0, 12),
    },
    legales: {
      textos_obligatorios: strs(legales.textos_obligatorios, 10, 400),
      restricciones: strs(legales.restricciones, 20, 300),
    },
    reglas: strs(data.reglas, 40, 300),
    fuentes: strs(data.fuentes, 20, 200),
  };
  const hasContent =
    guide.voz.tono ||
    guide.reglas.length > 0 ||
    guide.visual.colores.length > 0 ||
    guide.voz.palabras_usar.length > 0 ||
    !!guide.estrategia?.posicionamiento ||
    (guide.desempeno?.aprendizajes.length ?? 0) > 0;
  return hasContent ? guide : null;
}

// Error explícito del agente ({"error": "client_not_found" | ...}).
const ERROR_LABELS: Record<string, string> = {
  client_not_found: "Practicante no tiene un cliente con ese slug",
  no_brand_material: "El cliente no tiene un agente activo o material de marca en practicante",
  agent_forbidden:
    "El usuario de la integración no tiene acceso al agente de este cliente en practicante (se da el permiso en practicante → usuarios)",
};

export function brandGuideError(raw: string): string | null {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    const data = obj(JSON.parse(raw.slice(start, end + 1)));
    const code = str(data.error, 60);
    if (!code) return null;
    return ERROR_LABELS[code] ?? `Practicante respondió: ${code}`;
  } catch {
    return null;
  }
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
  const { fuentes: _fuentes, sync: _sync, ...rest } = g;
  void _fuentes;
  void _sync;
  // Las piezas van sin URLs (las imágenes, si se usan, van aparte como imagen).
  if (rest.desempeno?.piezas) {
    rest.desempeno = {
      ...rest.desempeno,
      piezas: rest.desempeno.piezas.map((p) => ({ ...p, imagen: "", imagen_origen: "" })),
    };
  }
  return (prune(rest) as Record<string, unknown>) ?? {};
}
