// Layout templates — composiciones pre-armadas que el productor puede usar
// como punto de partida en vez del canvas en blanco.
//
// Cada template tiene 3 variantes de aspect (horizontal 16:9, square 1:1,
// vertical 9:16) con sus propias posiciones de capas — porque adaptar bien
// entre familias de aspect no es solo reflow: requiere re-ubicar elementos
// (headline arriba en vertical vs. izquierda en horizontal).
//
// Cuando el usuario elige un template:
//   1. Se crea el master en el aspect default (horizontal).
//   2. Se crean las orientaciones vertical + cuadrada como variantes linked.
//   3. El backend NO propaga cambios entre orientaciones porque cada una
//      tiene un layout intencional distinto — quedan como variantes linked
//      pero el usuario puede diferenciar cuando quiera.
//
// Los textos son placeholders ("Tu titular acá", "$0.000") para que el
// productor reemplace su contenido sin pelear con la posición.

import {
  TemplateDefinition,
  TemplateLayer,
  FrameLayer,
  TextLayer,
  ImageLayer,
  ShapeLayer,
} from "./types";

export type AspectKey = "horizontal" | "square" | "vertical";

export interface LayoutTemplate {
  id: string;
  name: string;
  description: string;
  // Definiciones por aspect. El master usa la 'horizontal'; las otras se
  // crean como orientaciones linked al instanciar.
  aspects: Record<AspectKey, TemplateDefinition>;
}

// Dimensiones canónicas por aspect. Si el productor crea el template en otro
// tamaño dentro de la misma familia (ej. 1200×1200 vs 1080×1080), el reflow
// se encarga de escalar.
export const CANONICAL_SIZES: Record<AspectKey, { w: number; h: number }> = {
  horizontal: { w: 1920, h: 1080 },
  square: { w: 1080, h: 1080 },
  vertical: { w: 1080, h: 1920 },
};

// ---- Helpers para construir layers compactos ----

function root(width: number, height: number, bg: string, children: TemplateLayer[]): TemplateDefinition {
  return {
    id: "tpl_root",
    type: "frame",
    position: { x: 0, y: 0 },
    size: { w: width, h: height },
    background: { type: "color", value: bg },
    layout: { mode: "free" },
    children,
  };
}

function text(
  id: string,
  pos: { x: number; y: number },
  size: { w: number; h: number },
  content: string,
  style: TextLayer["style"],
  name?: string,
): TextLayer {
  return {
    id,
    type: "text",
    name: name ?? id,
    position: pos,
    size,
    content,
    style,
  };
}

function image(
  id: string,
  pos: { x: number; y: number },
  size: { w: number; h: number },
  name?: string,
): ImageLayer {
  return {
    id,
    type: "image",
    name: name ?? id,
    position: pos,
    size,
    src: null,
    fit: "cover",
  };
}

function shape(
  id: string,
  pos: { x: number; y: number },
  size: { w: number; h: number },
  fill: string,
  cornerRadius = 0,
  name?: string,
): ShapeLayer {
  return {
    id,
    type: "shape",
    name: name ?? id,
    position: pos,
    size,
    shape: "rect",
    fill,
    cornerRadius,
  };
}

// ---- Estilos compartidos ----

const TITLE_STYLE = (size: number): TextLayer["style"] => ({
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: size,
  fontWeight: 800,
  color: "#ffffff",
  lineHeight: 1.05,
  align: "left",
});

const PRICE_STYLE = (size: number): TextLayer["style"] => ({
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: size,
  fontWeight: 900,
  color: "#111111",
  lineHeight: 1,
  align: "center",
});

const SUBTITLE_STYLE = (size: number): TextLayer["style"] => ({
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: size,
  fontWeight: 500,
  color: "#ffffff",
  lineHeight: 1.3,
  align: "left",
});

// ---- Templates ----

// 1. Hero Centered — fondo rojo, titular grande arriba, imagen centro,
//    chip de precio abajo. Composición clásica de promo/sale.
const heroCentered: LayoutTemplate = {
  id: "hero-centered",
  name: "Hero Centered",
  description: "Titular arriba, imagen al centro y precio destacado abajo. Ideal para promos y ofertas.",
  aspects: {
    horizontal: root(1920, 1080, "#DC2626", [
      text("title", { x: 80, y: 100 }, { w: 1760, h: 200 }, "TU TITULAR ACÁ", { ...TITLE_STYLE(140), align: "center" }, "Headline"),
      image("hero", { x: 660, y: 320 }, { w: 600, h: 600 }, "Imagen"),
      shape("price-bg", { x: 760, y: 880 }, { w: 400, h: 140 }, "#FACC15", 16, "Fondo precio"),
      text("price", { x: 760, y: 880 }, { w: 400, h: 140 }, "$0.000", { ...PRICE_STYLE(96), verticalAlign: "middle" }, "Precio"),
    ]),
    square: root(1080, 1080, "#DC2626", [
      text("title", { x: 60, y: 80 }, { w: 960, h: 180 }, "TU TITULAR ACÁ", { ...TITLE_STYLE(110), align: "center" }, "Headline"),
      image("hero", { x: 240, y: 290 }, { w: 600, h: 600 }, "Imagen"),
      shape("price-bg", { x: 340, y: 900 }, { w: 400, h: 120 }, "#FACC15", 14, "Fondo precio"),
      text("price", { x: 340, y: 900 }, { w: 400, h: 120 }, "$0.000", { ...PRICE_STYLE(80), verticalAlign: "middle" }, "Precio"),
    ]),
    vertical: root(1080, 1920, "#DC2626", [
      text("title", { x: 60, y: 120 }, { w: 960, h: 280 }, "TU TITULAR ACÁ", { ...TITLE_STYLE(130), align: "center" }, "Headline"),
      image("hero", { x: 90, y: 540 }, { w: 900, h: 900 }, "Imagen"),
      shape("price-bg", { x: 290, y: 1580 }, { w: 500, h: 180 }, "#FACC15", 18, "Fondo precio"),
      text("price", { x: 290, y: 1580 }, { w: 500, h: 180 }, "$0.000", { ...PRICE_STYLE(120), verticalAlign: "middle" }, "Precio"),
    ]),
  },
};

// 2. Split — imagen a un lado, contenido textual al otro. En vertical el
//    split rota: imagen arriba, texto abajo.
const split: LayoutTemplate = {
  id: "split",
  name: "Imagen + Texto",
  description: "Imagen a un lado, titular y precio al otro. Layout clásico de product card.",
  aspects: {
    horizontal: root(1920, 1080, "#0F172A", [
      image("hero", { x: 0, y: 0 }, { w: 960, h: 1080 }, "Imagen"),
      text("title", { x: 1020, y: 180 }, { w: 820, h: 280 }, "Tu titular acá", TITLE_STYLE(96), "Headline"),
      text("subtitle", { x: 1020, y: 500 }, { w: 820, h: 160 }, "Subtítulo o descripción breve del producto", SUBTITLE_STYLE(36), "Subtítulo"),
      shape("price-bg", { x: 1020, y: 760 }, { w: 380, h: 140 }, "#FACC15", 14, "Fondo precio"),
      text("price", { x: 1020, y: 760 }, { w: 380, h: 140 }, "$0.000", { ...PRICE_STYLE(72), verticalAlign: "middle" }, "Precio"),
    ]),
    square: root(1080, 1080, "#0F172A", [
      image("hero", { x: 0, y: 0 }, { w: 1080, h: 540 }, "Imagen"),
      text("title", { x: 60, y: 600 }, { w: 960, h: 180 }, "Tu titular acá", { ...TITLE_STYLE(80), align: "left" }, "Headline"),
      text("subtitle", { x: 60, y: 790 }, { w: 960, h: 100 }, "Subtítulo breve", SUBTITLE_STYLE(32), "Subtítulo"),
      shape("price-bg", { x: 60, y: 910 }, { w: 360, h: 120 }, "#FACC15", 14, "Fondo precio"),
      text("price", { x: 60, y: 910 }, { w: 360, h: 120 }, "$0.000", { ...PRICE_STYLE(64), verticalAlign: "middle" }, "Precio"),
    ]),
    vertical: root(1080, 1920, "#0F172A", [
      image("hero", { x: 0, y: 0 }, { w: 1080, h: 1100 }, "Imagen"),
      text("title", { x: 60, y: 1170 }, { w: 960, h: 280 }, "Tu titular acá", { ...TITLE_STYLE(110), align: "left" }, "Headline"),
      text("subtitle", { x: 60, y: 1470 }, { w: 960, h: 160 }, "Subtítulo o descripción breve del producto", SUBTITLE_STYLE(44), "Subtítulo"),
      shape("price-bg", { x: 60, y: 1660 }, { w: 420, h: 160 }, "#FACC15", 16, "Fondo precio"),
      text("price", { x: 60, y: 1660 }, { w: 420, h: 160 }, "$0.000", { ...PRICE_STYLE(96), verticalAlign: "middle" }, "Precio"),
    ]),
  },
};

// 3. Badge Promo — imagen full-bleed, headline overlay arriba, badge circular
//    de descuento esquina, precio abajo. Para banners de descuento.
const badgePromo: LayoutTemplate = {
  id: "badge-promo",
  name: "Badge Promo",
  description: "Imagen de fondo full-bleed con titular overlay y badge de descuento. Para flash sales.",
  aspects: {
    horizontal: root(1920, 1080, "#000000", [
      image("hero", { x: 0, y: 0 }, { w: 1920, h: 1080 }, "Imagen fondo"),
      // Overlay oscuro para legibilidad del texto
      shape("overlay", { x: 0, y: 0 }, { w: 1920, h: 1080 }, "rgba(0,0,0,0.45)", 0, "Overlay"),
      text("title", { x: 100, y: 380 }, { w: 1200, h: 220 }, "MEGA OFERTA", TITLE_STYLE(160), "Headline"),
      text("subtitle", { x: 100, y: 620 }, { w: 1200, h: 100 }, "Tu descripción breve acá", SUBTITLE_STYLE(40), "Subtítulo"),
      // Badge circular en esquina sup-der
      shape("badge", { x: 1480, y: 80 }, { w: 360, h: 360 }, "#FACC15", 180, "Badge"),
      text("badge-text", { x: 1480, y: 80 }, { w: 360, h: 360 }, "-50%", { ...PRICE_STYLE(110), verticalAlign: "middle" }, "Texto badge"),
      // Precio abajo
      shape("price-bg", { x: 100, y: 880 }, { w: 360, h: 120 }, "#FACC15", 14, "Fondo precio"),
      text("price", { x: 100, y: 880 }, { w: 360, h: 120 }, "$0.000", { ...PRICE_STYLE(72), verticalAlign: "middle" }, "Precio"),
    ]),
    square: root(1080, 1080, "#000000", [
      image("hero", { x: 0, y: 0 }, { w: 1080, h: 1080 }, "Imagen fondo"),
      shape("overlay", { x: 0, y: 0 }, { w: 1080, h: 1080 }, "rgba(0,0,0,0.45)", 0, "Overlay"),
      text("title", { x: 60, y: 380 }, { w: 960, h: 220 }, "MEGA OFERTA", { ...TITLE_STYLE(130), align: "center" }, "Headline"),
      text("subtitle", { x: 60, y: 620 }, { w: 960, h: 80 }, "Tu descripción breve acá", { ...SUBTITLE_STYLE(34), align: "center" }, "Subtítulo"),
      shape("badge", { x: 760, y: 60 }, { w: 260, h: 260 }, "#FACC15", 130, "Badge"),
      text("badge-text", { x: 760, y: 60 }, { w: 260, h: 260 }, "-50%", { ...PRICE_STYLE(82), verticalAlign: "middle" }, "Texto badge"),
      shape("price-bg", { x: 360, y: 880 }, { w: 360, h: 120 }, "#FACC15", 14, "Fondo precio"),
      text("price", { x: 360, y: 880 }, { w: 360, h: 120 }, "$0.000", { ...PRICE_STYLE(64), verticalAlign: "middle" }, "Precio"),
    ]),
    vertical: root(1080, 1920, "#000000", [
      image("hero", { x: 0, y: 0 }, { w: 1080, h: 1920 }, "Imagen fondo"),
      shape("overlay", { x: 0, y: 0 }, { w: 1080, h: 1920 }, "rgba(0,0,0,0.5)", 0, "Overlay"),
      text("title", { x: 60, y: 680 }, { w: 960, h: 320 }, "MEGA OFERTA", { ...TITLE_STYLE(160), align: "center" }, "Headline"),
      text("subtitle", { x: 60, y: 1020 }, { w: 960, h: 120 }, "Tu descripción breve acá", { ...SUBTITLE_STYLE(40), align: "center" }, "Subtítulo"),
      shape("badge", { x: 720, y: 80 }, { w: 300, h: 300 }, "#FACC15", 150, "Badge"),
      text("badge-text", { x: 720, y: 80 }, { w: 300, h: 300 }, "-50%", { ...PRICE_STYLE(96), verticalAlign: "middle" }, "Texto badge"),
      shape("price-bg", { x: 330, y: 1620 }, { w: 420, h: 160 }, "#FACC15", 16, "Fondo precio"),
      text("price", { x: 330, y: 1620 }, { w: 420, h: 160 }, "$0.000", { ...PRICE_STYLE(96), verticalAlign: "middle" }, "Precio"),
    ]),
  },
};

export const LAYOUT_TEMPLATES: LayoutTemplate[] = [
  heroCentered,
  split,
  badgePromo,
];

// Devuelve el template por id, o null si no existe.
export function findLayoutTemplate(id: string): LayoutTemplate | null {
  return LAYOUT_TEMPLATES.find((t) => t.id === id) ?? null;
}

// Reasigna ids únicos a todas las capas de una definition. Necesario al
// instanciar un template: cada layer del template tiene ids estables ("title",
// "price", etc.) para que el código sea legible, pero cuando se crean N
// instancias del mismo template los ids chocarían en la BD. Esto los regenera
// en uid()-style para cada copia.
//
// Mantiene el id raíz "tpl_root" porque ese es invariante del template engine.
export function freshDefinitionIds(def: TemplateDefinition): TemplateDefinition {
  const remap = (layer: TemplateLayer): TemplateLayer => {
    const newId = layer.id === "tpl_root" ? "tpl_root" : freshUid();
    if (layer.type === "frame") {
      return {
        ...layer,
        id: newId,
        children: layer.children.map(remap),
      };
    }
    return { ...layer, id: newId };
  };
  return remap(def) as FrameLayer as TemplateDefinition;
}

function freshUid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `id_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}
