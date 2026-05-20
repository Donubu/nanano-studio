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

// Estilo neutro para fondos claros (cuando el banner usa cream / blanco).
const TITLE_DARK = (size: number): TextLayer["style"] => ({
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: size,
  fontWeight: 800,
  color: "#0F172A",
  lineHeight: 1.05,
  align: "left",
});
const SUBTITLE_DARK = (size: number): TextLayer["style"] => ({
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: size,
  fontWeight: 500,
  color: "#475569",
  lineHeight: 1.3,
  align: "left",
});

// Estilo para botones / CTAs renderizados como text encima de una shape.
const CTA_STYLE = (size: number): TextLayer["style"] => ({
  fontFamily: "Inter, system-ui, sans-serif",
  fontSize: size,
  fontWeight: 700,
  color: "#ffffff",
  lineHeight: 1,
  align: "center",
  verticalAlign: "middle",
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

// 4. Compact Sale — banner tipo "ribbon" para promos chatas y wide. Texto
//    grande a la izq, precio destacado al centro, CTA a la der. Estilo retail
//    típico de Adwords / banner web.
const compactSale: LayoutTemplate = {
  id: "compact-sale",
  name: "Compact Sale",
  description: "Banner promo en row: título a la izq, precio al centro, CTA a la der. Ideal para banners web horizontales.",
  aspects: {
    horizontal: root(1920, 1080, "#0EA5E9", [
      text("title", { x: 80, y: 380 }, { w: 900, h: 280 }, "OFERTA\nDEL DÍA", { ...TITLE_STYLE(180), align: "left", lineHeight: 0.95 }, "Headline"),
      shape("price-bg", { x: 1040, y: 360 }, { w: 480, h: 320 }, "#FACC15", 24, "Fondo precio"),
      text("price", { x: 1040, y: 360 }, { w: 480, h: 320 }, "$0.000", { ...PRICE_STYLE(140), verticalAlign: "middle" }, "Precio"),
      shape("cta-bg", { x: 1600, y: 460 }, { w: 240, h: 120 }, "#0F172A", 60, "Fondo CTA"),
      text("cta", { x: 1600, y: 460 }, { w: 240, h: 120 }, "COMPRAR", CTA_STYLE(38), "CTA"),
    ]),
    square: root(1080, 1080, "#0EA5E9", [
      text("title", { x: 60, y: 120 }, { w: 960, h: 320 }, "OFERTA\nDEL DÍA", { ...TITLE_STYLE(160), align: "center", lineHeight: 0.95 }, "Headline"),
      shape("price-bg", { x: 240, y: 500 }, { w: 600, h: 280 }, "#FACC15", 20, "Fondo precio"),
      text("price", { x: 240, y: 500 }, { w: 600, h: 280 }, "$0.000", { ...PRICE_STYLE(140), verticalAlign: "middle" }, "Precio"),
      shape("cta-bg", { x: 340, y: 880 }, { w: 400, h: 120 }, "#0F172A", 60, "Fondo CTA"),
      text("cta", { x: 340, y: 880 }, { w: 400, h: 120 }, "COMPRAR", CTA_STYLE(44), "CTA"),
    ]),
    vertical: root(1080, 1920, "#0EA5E9", [
      text("title", { x: 60, y: 180 }, { w: 960, h: 480 }, "OFERTA\nDEL DÍA", { ...TITLE_STYLE(220), align: "center", lineHeight: 0.9 }, "Headline"),
      shape("price-bg", { x: 140, y: 880 }, { w: 800, h: 360 }, "#FACC15", 28, "Fondo precio"),
      text("price", { x: 140, y: 880 }, { w: 800, h: 360 }, "$0.000", { ...PRICE_STYLE(180), verticalAlign: "middle" }, "Precio"),
      shape("cta-bg", { x: 290, y: 1620 }, { w: 500, h: 160 }, "#0F172A", 80, "Fondo CTA"),
      text("cta", { x: 290, y: 1620 }, { w: 500, h: 160 }, "COMPRAR", CTA_STYLE(60), "CTA"),
    ]),
  },
};

// 5. Product Spotlight — fondo claro, etiqueta "NUEVO" arriba, imagen
//    centrada del producto, nombre y precio abajo. Estilo e-commerce.
const productSpotlight: LayoutTemplate = {
  id: "product-spotlight",
  name: "Product Spotlight",
  description: "Producto centrado con tag NUEVO arriba, nombre y precio abajo. Fondo claro, estilo e-commerce premium.",
  aspects: {
    horizontal: root(1920, 1080, "#FAFAF9", [
      shape("tag-bg", { x: 860, y: 60 }, { w: 200, h: 60 }, "#DC2626", 30, "Tag NUEVO"),
      text("tag", { x: 860, y: 60 }, { w: 200, h: 60 }, "NUEVO", CTA_STYLE(28), "Texto tag"),
      image("hero", { x: 660, y: 160 }, { w: 600, h: 600 }, "Imagen producto"),
      text("title", { x: 80, y: 800 }, { w: 1760, h: 100 }, "Nombre del producto", { ...TITLE_DARK(70), align: "center" }, "Nombre"),
      text("price", { x: 80, y: 920 }, { w: 1760, h: 100 }, "$0.000", { ...PRICE_STYLE(72), align: "center", color: "#DC2626" }, "Precio"),
    ]),
    square: root(1080, 1080, "#FAFAF9", [
      shape("tag-bg", { x: 440, y: 60 }, { w: 200, h: 60 }, "#DC2626", 30, "Tag NUEVO"),
      text("tag", { x: 440, y: 60 }, { w: 200, h: 60 }, "NUEVO", CTA_STYLE(28), "Texto tag"),
      image("hero", { x: 240, y: 160 }, { w: 600, h: 600 }, "Imagen producto"),
      text("title", { x: 60, y: 800 }, { w: 960, h: 80 }, "Nombre del producto", { ...TITLE_DARK(56), align: "center" }, "Nombre"),
      text("price", { x: 60, y: 900 }, { w: 960, h: 100 }, "$0.000", { ...PRICE_STYLE(64), align: "center", color: "#DC2626" }, "Precio"),
    ]),
    vertical: root(1080, 1920, "#FAFAF9", [
      shape("tag-bg", { x: 440, y: 120 }, { w: 200, h: 60 }, "#DC2626", 30, "Tag NUEVO"),
      text("tag", { x: 440, y: 120 }, { w: 200, h: 60 }, "NUEVO", CTA_STYLE(28), "Texto tag"),
      image("hero", { x: 90, y: 280 }, { w: 900, h: 900 }, "Imagen producto"),
      text("title", { x: 60, y: 1280 }, { w: 960, h: 200 }, "Nombre del producto", { ...TITLE_DARK(90), align: "center" }, "Nombre"),
      text("price", { x: 60, y: 1520 }, { w: 960, h: 200 }, "$0.000", { ...PRICE_STYLE(120), align: "center", color: "#DC2626" }, "Precio"),
    ]),
  },
};

// 6. Urgency — texto urgente arriba ("ÚLTIMOS 3 DÍAS"), producto al centro,
//    precio destacado. Comunica scarcity. Fondo rojo oscuro intenso.
const urgency: LayoutTemplate = {
  id: "urgency",
  name: "Urgency / Countdown",
  description: "Mensaje de urgencia arriba ('ÚLTIMOS 3 DÍAS'), producto al centro, precio destacado. Para flash sales.",
  aspects: {
    horizontal: root(1920, 1080, "#7F1D1D", [
      text("urgency", { x: 80, y: 60 }, { w: 1760, h: 100 }, "⏰ ÚLTIMOS 3 DÍAS", { ...TITLE_STYLE(72), align: "center", color: "#FACC15" }, "Urgencia"),
      text("title", { x: 80, y: 200 }, { w: 1100, h: 280 }, "Tu titular promo", TITLE_STYLE(110), "Headline"),
      text("subtitle", { x: 80, y: 500 }, { w: 1100, h: 80 }, "Descripción breve del descuento", SUBTITLE_STYLE(36), "Subtítulo"),
      image("hero", { x: 1280, y: 200 }, { w: 560, h: 700 }, "Imagen producto"),
      shape("price-bg", { x: 80, y: 800 }, { w: 480, h: 180 }, "#FACC15", 20, "Fondo precio"),
      text("price", { x: 80, y: 800 }, { w: 480, h: 180 }, "$0.000", { ...PRICE_STYLE(96), verticalAlign: "middle" }, "Precio"),
    ]),
    square: root(1080, 1080, "#7F1D1D", [
      text("urgency", { x: 60, y: 60 }, { w: 960, h: 80 }, "⏰ ÚLTIMOS 3 DÍAS", { ...TITLE_STYLE(56), align: "center", color: "#FACC15" }, "Urgencia"),
      text("title", { x: 60, y: 180 }, { w: 960, h: 200 }, "Tu titular promo", { ...TITLE_STYLE(90), align: "center" }, "Headline"),
      image("hero", { x: 240, y: 420 }, { w: 600, h: 480 }, "Imagen producto"),
      shape("price-bg", { x: 340, y: 920 }, { w: 400, h: 120 }, "#FACC15", 16, "Fondo precio"),
      text("price", { x: 340, y: 920 }, { w: 400, h: 120 }, "$0.000", { ...PRICE_STYLE(72), verticalAlign: "middle" }, "Precio"),
    ]),
    vertical: root(1080, 1920, "#7F1D1D", [
      text("urgency", { x: 60, y: 120 }, { w: 960, h: 100 }, "⏰ ÚLTIMOS 3 DÍAS", { ...TITLE_STYLE(64), align: "center", color: "#FACC15" }, "Urgencia"),
      text("title", { x: 60, y: 260 }, { w: 960, h: 320 }, "Tu titular promo", { ...TITLE_STYLE(120), align: "center" }, "Headline"),
      image("hero", { x: 90, y: 660 }, { w: 900, h: 900 }, "Imagen producto"),
      shape("price-bg", { x: 290, y: 1660 }, { w: 500, h: 180 }, "#FACC15", 18, "Fondo precio"),
      text("price", { x: 290, y: 1660 }, { w: 500, h: 180 }, "$0.000", { ...PRICE_STYLE(110), verticalAlign: "middle" }, "Precio"),
    ]),
  },
};

// 7. Testimonial — comillas grandes decorativas + quote en texto grande +
//    autor abajo. Fondo dark sobrio.
const testimonial: LayoutTemplate = {
  id: "testimonial",
  name: "Testimonial",
  description: "Quote grande con comillas decorativas y autor abajo. Para social proof y referencias.",
  aspects: {
    horizontal: root(1920, 1080, "#1E293B", [
      text("quotemark", { x: 80, y: 60 }, { w: 200, h: 200 }, '"', { ...TITLE_STYLE(240), color: "#FACC15", lineHeight: 1 }, "Comillas"),
      text("quote", { x: 80, y: 260 }, { w: 1760, h: 500 }, "“Texto del testimonial. Sustituí esto con la cita real del cliente que mejor exprese el valor.”", { ...TITLE_STYLE(56), lineHeight: 1.3, fontWeight: 500 }, "Quote"),
      text("author", { x: 80, y: 820 }, { w: 1760, h: 80 }, "— Nombre del autor", { ...SUBTITLE_STYLE(36), color: "#FACC15" }, "Autor"),
      text("role", { x: 80, y: 910 }, { w: 1760, h: 60 }, "Cargo · Empresa", SUBTITLE_STYLE(28), "Cargo"),
    ]),
    square: root(1080, 1080, "#1E293B", [
      text("quotemark", { x: 60, y: 60 }, { w: 160, h: 160 }, '"', { ...TITLE_STYLE(200), color: "#FACC15", lineHeight: 1 }, "Comillas"),
      text("quote", { x: 60, y: 240 }, { w: 960, h: 540 }, "“Texto del testimonial. Sustituí esto con la cita del cliente.”", { ...TITLE_STYLE(54), lineHeight: 1.3, fontWeight: 500 }, "Quote"),
      text("author", { x: 60, y: 840 }, { w: 960, h: 80 }, "— Nombre del autor", { ...SUBTITLE_STYLE(34), color: "#FACC15" }, "Autor"),
      text("role", { x: 60, y: 940 }, { w: 960, h: 60 }, "Cargo · Empresa", SUBTITLE_STYLE(26), "Cargo"),
    ]),
    vertical: root(1080, 1920, "#1E293B", [
      text("quotemark", { x: 60, y: 200 }, { w: 200, h: 200 }, '"', { ...TITLE_STYLE(240), color: "#FACC15", lineHeight: 1 }, "Comillas"),
      text("quote", { x: 60, y: 460 }, { w: 960, h: 1000 }, "“Texto del testimonial. Sustituí esto con la cita real del cliente que mejor exprese el valor entregado.”", { ...TITLE_STYLE(72), lineHeight: 1.3, fontWeight: 500 }, "Quote"),
      text("author", { x: 60, y: 1560 }, { w: 960, h: 100 }, "— Nombre del autor", { ...SUBTITLE_STYLE(44), color: "#FACC15" }, "Autor"),
      text("role", { x: 60, y: 1680 }, { w: 960, h: 80 }, "Cargo · Empresa", SUBTITLE_STYLE(34), "Cargo"),
    ]),
  },
};

// 8. CTA Block — texto grande sobre fondo sólido + botón shape + texto.
//    Minimalista, alta legibilidad. Para anuncios de feature / landing.
const ctaBlock: LayoutTemplate = {
  id: "cta-block",
  name: "CTA Block",
  description: "Mensaje grande + botón. Minimalista y de alta legibilidad. Para anuncios sin imagen.",
  aspects: {
    horizontal: root(1920, 1080, "#FACC15", [
      text("headline", { x: 80, y: 200 }, { w: 1760, h: 360 }, "Tu mensaje grande acá", { ...TITLE_DARK(140), align: "center", lineHeight: 1.05 }, "Headline"),
      text("subtitle", { x: 80, y: 600 }, { w: 1760, h: 100 }, "Texto secundario explicando el valor", { ...SUBTITLE_DARK(40), align: "center" }, "Subtítulo"),
      shape("cta-bg", { x: 760, y: 800 }, { w: 400, h: 140 }, "#0F172A", 70, "Fondo CTA"),
      text("cta", { x: 760, y: 800 }, { w: 400, h: 140 }, "Probar ahora", CTA_STYLE(40), "CTA"),
    ]),
    square: root(1080, 1080, "#FACC15", [
      text("headline", { x: 60, y: 200 }, { w: 960, h: 400 }, "Tu mensaje grande acá", { ...TITLE_DARK(110), align: "center", lineHeight: 1.05 }, "Headline"),
      text("subtitle", { x: 60, y: 640 }, { w: 960, h: 100 }, "Texto secundario", { ...SUBTITLE_DARK(36), align: "center" }, "Subtítulo"),
      shape("cta-bg", { x: 340, y: 820 }, { w: 400, h: 140 }, "#0F172A", 70, "Fondo CTA"),
      text("cta", { x: 340, y: 820 }, { w: 400, h: 140 }, "Probar ahora", CTA_STYLE(40), "CTA"),
    ]),
    vertical: root(1080, 1920, "#FACC15", [
      text("headline", { x: 60, y: 360 }, { w: 960, h: 720 }, "Tu mensaje grande acá", { ...TITLE_DARK(160), align: "center", lineHeight: 1.05 }, "Headline"),
      text("subtitle", { x: 60, y: 1140 }, { w: 960, h: 160 }, "Texto secundario explicando el valor", { ...SUBTITLE_DARK(44), align: "center" }, "Subtítulo"),
      shape("cta-bg", { x: 290, y: 1500 }, { w: 500, h: 160 }, "#0F172A", 80, "Fondo CTA"),
      text("cta", { x: 290, y: 1500 }, { w: 500, h: 160 }, "Probar ahora", CTA_STYLE(50), "CTA"),
    ]),
  },
};

// 9. Coupon — estilo de cupón con borde dashed (representado por shape rect
//    sobre bg con leve offset) + código de descuento prominente + términos.
const coupon: LayoutTemplate = {
  id: "coupon",
  name: "Coupon / Código",
  description: "Cupón con código de descuento, descuento prominente y términos chicos. Para email/SMS marketing.",
  aspects: {
    horizontal: root(1920, 1080, "#FFFFFF", [
      shape("frame-outer", { x: 80, y: 80 }, { w: 1760, h: 920 }, "#FACC15", 24, "Marco"),
      shape("frame-inner", { x: 120, y: 120 }, { w: 1680, h: 840 }, "#FFFFFF", 16, "Interior"),
      text("title", { x: 160, y: 180 }, { w: 1600, h: 100 }, "DESCUENTO EXCLUSIVO", { ...TITLE_DARK(60), align: "center", letterSpacing: 4 }, "Headline"),
      text("discount", { x: 160, y: 320 }, { w: 1600, h: 280 }, "-30%", { ...PRICE_STYLE(280), align: "center", color: "#DC2626" }, "Descuento"),
      text("code-label", { x: 160, y: 640 }, { w: 1600, h: 60 }, "Usa el código:", { ...SUBTITLE_DARK(32), align: "center", color: "#475569" }, "Label código"),
      shape("code-bg", { x: 660, y: 720 }, { w: 600, h: 100 }, "#0F172A", 8, "Fondo código"),
      text("code", { x: 660, y: 720 }, { w: 600, h: 100 }, "PROMO30", { ...CTA_STYLE(54), letterSpacing: 8 }, "Código"),
      text("terms", { x: 160, y: 880 }, { w: 1600, h: 40 }, "Válido hasta el 31/12. No acumulable con otras promociones.", { ...SUBTITLE_DARK(20), align: "center", color: "#94A3B8" }, "Términos"),
    ]),
    square: root(1080, 1080, "#FFFFFF", [
      shape("frame-outer", { x: 60, y: 60 }, { w: 960, h: 960 }, "#FACC15", 24, "Marco"),
      shape("frame-inner", { x: 100, y: 100 }, { w: 880, h: 880 }, "#FFFFFF", 16, "Interior"),
      text("title", { x: 140, y: 160 }, { w: 800, h: 80 }, "DESCUENTO EXCLUSIVO", { ...TITLE_DARK(44), align: "center", letterSpacing: 3 }, "Headline"),
      text("discount", { x: 140, y: 280 }, { w: 800, h: 280 }, "-30%", { ...PRICE_STYLE(220), align: "center", color: "#DC2626" }, "Descuento"),
      text("code-label", { x: 140, y: 620 }, { w: 800, h: 60 }, "Usa el código:", { ...SUBTITLE_DARK(28), align: "center", color: "#475569" }, "Label código"),
      shape("code-bg", { x: 240, y: 700 }, { w: 600, h: 100 }, "#0F172A", 8, "Fondo código"),
      text("code", { x: 240, y: 700 }, { w: 600, h: 100 }, "PROMO30", { ...CTA_STYLE(48), letterSpacing: 6 }, "Código"),
      text("terms", { x: 140, y: 880 }, { w: 800, h: 60 }, "Válido hasta el 31/12. No acumulable.", { ...SUBTITLE_DARK(18), align: "center", color: "#94A3B8" }, "Términos"),
    ]),
    vertical: root(1080, 1920, "#FFFFFF", [
      shape("frame-outer", { x: 60, y: 200 }, { w: 960, h: 1520 }, "#FACC15", 24, "Marco"),
      shape("frame-inner", { x: 100, y: 240 }, { w: 880, h: 1440 }, "#FFFFFF", 16, "Interior"),
      text("title", { x: 140, y: 320 }, { w: 800, h: 100 }, "DESCUENTO EXCLUSIVO", { ...TITLE_DARK(52), align: "center", letterSpacing: 3 }, "Headline"),
      text("discount", { x: 140, y: 500 }, { w: 800, h: 480 }, "-30%", { ...PRICE_STYLE(320), align: "center", color: "#DC2626" }, "Descuento"),
      text("code-label", { x: 140, y: 1080 }, { w: 800, h: 80 }, "Usa el código:", { ...SUBTITLE_DARK(36), align: "center", color: "#475569" }, "Label código"),
      shape("code-bg", { x: 240, y: 1200 }, { w: 600, h: 140 }, "#0F172A", 8, "Fondo código"),
      text("code", { x: 240, y: 1200 }, { w: 600, h: 140 }, "PROMO30", { ...CTA_STYLE(64), letterSpacing: 8 }, "Código"),
      text("terms", { x: 140, y: 1580 }, { w: 800, h: 80 }, "Válido hasta el 31/12. No acumulable con otras promociones.", { ...SUBTITLE_DARK(22), align: "center", color: "#94A3B8" }, "Términos"),
    ]),
  },
};

// 10. Event Promo — fecha grande prominente, título del evento, venue/info.
//     Para anuncios de eventos, lanzamientos, conferencias.
const eventPromo: LayoutTemplate = {
  id: "event-promo",
  name: "Event Promo",
  description: "Fecha prominente, título del evento y venue/info abajo. Para eventos, lanzamientos, conferencias.",
  aspects: {
    horizontal: root(1920, 1080, "#1E293B", [
      shape("date-bg", { x: 80, y: 200 }, { w: 600, h: 680 }, "#DC2626", 24, "Fondo fecha"),
      text("day", { x: 80, y: 240 }, { w: 600, h: 280 }, "15", { ...PRICE_STYLE(240), color: "#FFFFFF", align: "center", verticalAlign: "middle" }, "Día"),
      text("month", { x: 80, y: 520 }, { w: 600, h: 120 }, "MARZO", { ...TITLE_STYLE(96), align: "center", letterSpacing: 8 }, "Mes"),
      text("year", { x: 80, y: 680 }, { w: 600, h: 180 }, "2025", { ...PRICE_STYLE(140), color: "#FACC15", align: "center" }, "Año"),
      text("title", { x: 760, y: 240 }, { w: 1080, h: 320 }, "Título del evento", { ...TITLE_STYLE(110), lineHeight: 1.05 }, "Título"),
      text("venue", { x: 760, y: 580 }, { w: 1080, h: 80 }, "📍 Venue / Ubicación", SUBTITLE_STYLE(40), "Venue"),
      text("time", { x: 760, y: 680 }, { w: 1080, h: 80 }, "🕐 19:00 hrs", SUBTITLE_STYLE(40), "Hora"),
      shape("cta-bg", { x: 760, y: 820 }, { w: 400, h: 100 }, "#FACC15", 50, "Fondo CTA"),
      text("cta", { x: 760, y: 820 }, { w: 400, h: 100 }, "Reservar", { ...CTA_STYLE(36), color: "#0F172A" }, "CTA"),
    ]),
    square: root(1080, 1080, "#1E293B", [
      shape("date-bg", { x: 290, y: 60 }, { w: 500, h: 400 }, "#DC2626", 24, "Fondo fecha"),
      text("day", { x: 290, y: 80 }, { w: 500, h: 200 }, "15", { ...PRICE_STYLE(180), color: "#FFFFFF", align: "center", verticalAlign: "middle" }, "Día"),
      text("month-year", { x: 290, y: 300 }, { w: 500, h: 140 }, "MARZO 2025", { ...TITLE_STYLE(56), align: "center", letterSpacing: 4 }, "Mes / año"),
      text("title", { x: 60, y: 520 }, { w: 960, h: 220 }, "Título del evento", { ...TITLE_STYLE(80), align: "center", lineHeight: 1.05 }, "Título"),
      text("venue", { x: 60, y: 780 }, { w: 960, h: 60 }, "📍 Venue · 🕐 19:00", { ...SUBTITLE_STYLE(34), align: "center" }, "Venue + hora"),
      shape("cta-bg", { x: 340, y: 900 }, { w: 400, h: 100 }, "#FACC15", 50, "Fondo CTA"),
      text("cta", { x: 340, y: 900 }, { w: 400, h: 100 }, "Reservar", { ...CTA_STYLE(36), color: "#0F172A" }, "CTA"),
    ]),
    vertical: root(1080, 1920, "#1E293B", [
      shape("date-bg", { x: 140, y: 160 }, { w: 800, h: 500 }, "#DC2626", 24, "Fondo fecha"),
      text("day", { x: 140, y: 180 }, { w: 800, h: 240 }, "15", { ...PRICE_STYLE(220), color: "#FFFFFF", align: "center", verticalAlign: "middle" }, "Día"),
      text("month-year", { x: 140, y: 440 }, { w: 800, h: 180 }, "MARZO 2025", { ...TITLE_STYLE(80), align: "center", letterSpacing: 6 }, "Mes / año"),
      text("title", { x: 60, y: 760 }, { w: 960, h: 380 }, "Título del evento", { ...TITLE_STYLE(120), align: "center", lineHeight: 1.05 }, "Título"),
      text("venue", { x: 60, y: 1200 }, { w: 960, h: 100 }, "📍 Venue / Ubicación", { ...SUBTITLE_STYLE(48), align: "center" }, "Venue"),
      text("time", { x: 60, y: 1320 }, { w: 960, h: 100 }, "🕐 19:00 hrs", { ...SUBTITLE_STYLE(48), align: "center" }, "Hora"),
      shape("cta-bg", { x: 290, y: 1600 }, { w: 500, h: 160 }, "#FACC15", 80, "Fondo CTA"),
      text("cta", { x: 290, y: 1600 }, { w: 500, h: 160 }, "Reservar", { ...CTA_STYLE(52), color: "#0F172A" }, "CTA"),
    ]),
  },
};

export const LAYOUT_TEMPLATES: LayoutTemplate[] = [
  heroCentered,
  split,
  badgePromo,
  compactSale,
  productSpotlight,
  urgency,
  testimonial,
  ctaBlock,
  coupon,
  eventPromo,
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
