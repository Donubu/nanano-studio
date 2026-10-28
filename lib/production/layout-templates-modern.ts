// Plantillas contemporáneas del catálogo (ver art-direction.ts): jerarquía
// fuerte, aire, alineación a la izquierda, color en bloques, CTA plano y un
// slot de letra chica para legales en todas. Mismo formato que
// layout-templates.ts (tres orientaciones con su propia composición).
//
// Colores de muestra por ROL, todos distintos entre sí: el planificador
// recolorea por valor exacto (from → to), así cada rol se cambia por
// separado (fondo, texto, marca, acento, texto sobre color).

import type { TemplateDefinition, TemplateLayer, TextLayer, ImageLayer, ShapeLayer } from "./types";
import type { LayoutTemplate } from "./layout-templates";

const PAPER = "#F7F5F0"; // fondo claro
const INK = "#111317"; // texto sobre claro
const MUTED = "#5B6270"; // texto secundario sobre claro
const BRAND = "#1F4FD8"; // color de marca
const ACCENT = "#E2382B"; // acento (precio, cintillo)
const ON_COLOR = "#FFFFFF"; // texto sobre color o foto
const ON_COLOR_SOFT = "#DCE3F5"; // secundario sobre color
const DARK = "#14161A"; // fondo oscuro sobrio
const CHAMPAGNE = "#D8C8A8"; // detalle fino (lujo)
const SOFT_GREY = "#A3A9B5"; // legal sobre oscuro

const SANS = "Inter, system-ui, sans-serif";
const SERIF = "Playfair Display, Georgia, serif";

type Box = [x: number, y: number, w: number, h: number];

function root(w: number, h: number, bg: string, children: TemplateLayer[]): TemplateDefinition {
  return {
    id: "tpl_root",
    type: "frame",
    position: { x: 0, y: 0 },
    size: { w, h },
    background: { type: "color", value: bg },
    layout: { mode: "free" },
    children,
  };
}

function t(id: string, name: string, [x, y, w, h]: Box, content: string, style: Partial<TextLayer["style"]>): TextLayer {
  return {
    id,
    type: "text",
    name,
    position: { x, y },
    size: { w, h },
    content,
    style: { fontFamily: SANS, fontSize: 32, color: INK, lineHeight: 1.2, align: "left", ...style },
  };
}

function img(id: string, name: string, [x, y, w, h]: Box, cornerRadius?: number): ImageLayer {
  return { id, type: "image", name, position: { x, y }, size: { w, h }, src: null, fit: "cover", ...(cornerRadius ? { cornerRadius } : {}) };
}

function rect(id: string, name: string, [x, y, w, h]: Box, fill: string, cornerRadius = 0): ShapeLayer {
  return { id, type: "shape", name, position: { x, y }, size: { w, h }, shape: "rect", fill, cornerRadius };
}

// Roles de texto reutilizados.
const kicker = (box: Box, color: string, size: number) =>
  t("kicker", "Antetítulo", box, "NUEVA COLECCIÓN", {
    fontSize: size,
    fontWeight: 700,
    color,
    letterSpacing: Math.round(size * 0.16),
    textTransform: "uppercase",
  });
const legal = (box: Box, color: string, size: number) =>
  t("legal", "Legal", box, "*Imágenes referenciales. Condiciones en el sitio web.", {
    fontSize: size,
    fontWeight: 400,
    color,
    lineHeight: 1.25,
  });
const button = (box: Box, bg: string, color: string, size: number, label = "Ver más", radius?: number) =>
  t("cta", "CTA", box, label, {
    fontSize: size,
    fontWeight: 700,
    color,
    backgroundColor: bg,
    backgroundCornerRadius: radius ?? Math.round(box[3] / 2),
    align: "center",
    verticalAlign: "middle",
  });

// 1. Editorial asimétrico — foto grande a un lado, columna de texto con aire.
const editorialSplit: LayoutTemplate = {
  id: "editorial-split",
  name: "Editorial asimétrico",
  description:
    "Foto protagonista en ~60% y columna de texto con mucho aire: antetítulo, titular grande, bajada, precio y botón plano. Editorial minimal o lujo; productos, inmobiliaria, moda.",
  aspects: {
    horizontal: root(1920, 1080, PAPER, [
      img("hero", "Imagen", [800, 0, 1120, 1080]),
      kicker([96, 150, 620, 40], BRAND, 26),
      t("title", "Titular", [96, 210, 640, 330], "Titular corto y potente", { fontSize: 104, fontWeight: 800, lineHeight: 0.98 }),
      t("subtitle", "Bajada", [96, 560, 600, 110], "Una frase que explica el beneficio principal.", { fontSize: 32, color: MUTED, lineHeight: 1.35 }),
      t("price", "Precio", [96, 720, 620, 90], "Desde $0.000", { fontSize: 64, fontWeight: 800, color: BRAND, lineHeight: 1 }),
      button([96, 850, 320, 84], BRAND, ON_COLOR, 28),
      legal([96, 990, 640, 40], MUTED, 16),
    ]),
    square: root(1080, 1080, PAPER, [
      img("hero", "Imagen", [0, 0, 1080, 520]),
      kicker([72, 568, 600, 36], BRAND, 22),
      t("title", "Titular", [72, 612, 936, 180], "Titular corto y potente", { fontSize: 72, fontWeight: 800, lineHeight: 1 }),
      t("subtitle", "Bajada", [72, 800, 600, 72], "Una frase que explica el beneficio principal.", { fontSize: 24, color: MUTED, lineHeight: 1.35 }),
      t("price", "Precio", [72, 890, 560, 72], "Desde $0.000", { fontSize: 52, fontWeight: 800, color: BRAND, lineHeight: 1 }),
      button([704, 886, 304, 76], BRAND, ON_COLOR, 24),
      legal([72, 1000, 936, 32], MUTED, 14),
    ]),
    vertical: root(1080, 1920, PAPER, [
      img("hero", "Imagen", [0, 0, 1080, 1000]),
      kicker([72, 1056, 800, 44], BRAND, 28),
      t("title", "Titular", [72, 1110, 936, 320], "Titular corto y potente", { fontSize: 104, fontWeight: 800, lineHeight: 0.98 }),
      t("subtitle", "Bajada", [72, 1450, 900, 120], "Una frase que explica el beneficio principal.", { fontSize: 36, color: MUTED, lineHeight: 1.35 }),
      t("price", "Precio", [72, 1590, 900, 100], "Desde $0.000", { fontSize: 72, fontWeight: 800, color: BRAND, lineHeight: 1 }),
      button([72, 1712, 380, 96], BRAND, ON_COLOR, 34),
      legal([72, 1844, 936, 40], MUTED, 18),
    ]),
  },
};

// 2. Bloque de color — color de marca plano con el titular, foto al lado.
const colorBlock: LayoutTemplate = {
  id: "color-block",
  name: "Bloque de color",
  description:
    "Bloque plano del color de marca con titular grande en mayúsculas, foto al lado, precio en chip de acento y botón. Deportiva/bold o retail con energía.",
  aspects: {
    horizontal: root(1920, 1080, PAPER, [
      img("hero", "Imagen", [820, 0, 1100, 1080]),
      rect("block", "Bloque de color", [0, 0, 820, 1080], BRAND),
      t("title", "Titular", [96, 140, 660, 420], "TITULAR EN BLOQUE", {
        fontSize: 120,
        fontWeight: 900,
        color: ON_COLOR,
        lineHeight: 0.92,
        textTransform: "uppercase",
      }),
      t("subtitle", "Bajada", [96, 590, 620, 100], "Beneficio en una línea.", { fontSize: 32, color: ON_COLOR_SOFT, lineHeight: 1.3 }),
      t("price", "Precio", [96, 740, 420, 110], "$0.000", {
        fontSize: 60,
        fontWeight: 900,
        color: ON_COLOR,
        backgroundColor: ACCENT,
        backgroundCornerRadius: 8,
        align: "center",
        verticalAlign: "middle",
      }),
      button([96, 890, 300, 80], ON_COLOR, BRAND, 28, "Comprar"),
      legal([96, 1006, 660, 36], ON_COLOR_SOFT, 15),
    ]),
    square: root(1080, 1080, PAPER, [
      img("hero", "Imagen", [0, 0, 1080, 560]),
      rect("block", "Bloque de color", [0, 560, 1080, 520], BRAND),
      t("title", "Titular", [72, 600, 936, 200], "TITULAR EN BLOQUE", {
        fontSize: 84,
        fontWeight: 900,
        color: ON_COLOR,
        lineHeight: 0.95,
        textTransform: "uppercase",
      }),
      t("subtitle", "Bajada", [72, 808, 936, 56], "Beneficio en una línea.", { fontSize: 26, color: ON_COLOR_SOFT, lineHeight: 1.3 }),
      t("price", "Precio", [72, 880, 340, 90], "$0.000", {
        fontSize: 48,
        fontWeight: 900,
        color: ON_COLOR,
        backgroundColor: ACCENT,
        backgroundCornerRadius: 8,
        align: "center",
        verticalAlign: "middle",
      }),
      button([660, 885, 348, 80], ON_COLOR, BRAND, 26, "Comprar"),
      legal([72, 998, 936, 36], ON_COLOR_SOFT, 14),
    ]),
    vertical: root(1080, 1920, PAPER, [
      img("hero", "Imagen", [0, 0, 1080, 1040]),
      rect("block", "Bloque de color", [0, 1040, 1080, 880], BRAND),
      t("title", "Titular", [72, 1100, 936, 360], "TITULAR EN BLOQUE", {
        fontSize: 120,
        fontWeight: 900,
        color: ON_COLOR,
        lineHeight: 0.92,
        textTransform: "uppercase",
      }),
      t("subtitle", "Bajada", [72, 1480, 936, 110], "Beneficio en una línea.", { fontSize: 36, color: ON_COLOR_SOFT, lineHeight: 1.3 }),
      t("price", "Precio", [72, 1610, 440, 110], "$0.000", {
        fontSize: 64,
        fontWeight: 900,
        color: ON_COLOR,
        backgroundColor: ACCENT,
        backgroundCornerRadius: 8,
        align: "center",
        verticalAlign: "middle",
      }),
      button([560, 1615, 448, 100], ON_COLOR, BRAND, 34, "Comprar"),
      legal([72, 1820, 936, 44], ON_COLOR_SOFT, 18),
    ]),
  },
};

// 3. Franja de precio — foto grande arriba, cintillo de acento y franja de
// marca con nombre, precio y CTA. El patrón que más rinde en retail e
// inmobiliaria (precio visible + CTA claro).
const priceBand: LayoutTemplate = {
  id: "price-band",
  name: "Franja de precio",
  description:
    "Foto grande arriba con cintillo de acento ('NUEVA ETAPA EN VENTA'), y abajo una franja del color de marca con nombre, bajada, precio 'DESDE' en chip de acento y CTA. Retail limpio, inmobiliaria, ofertas con precio.",
  aspects: {
    horizontal: root(1920, 1080, PAPER, [
      img("hero", "Imagen", [0, 0, 1920, 780]),
      t("ribbon", "Cintillo", [96, 72, 560, 76], "NUEVA ETAPA EN VENTA", {
        fontSize: 30,
        fontWeight: 800,
        color: ON_COLOR,
        backgroundColor: ACCENT,
        backgroundCornerRadius: 0,
        align: "center",
        verticalAlign: "middle",
        letterSpacing: 2,
      }),
      rect("band", "Franja", [0, 780, 1920, 300], BRAND),
      t("title", "Nombre", [96, 808, 900, 110], "Nombre del producto", { fontSize: 64, fontWeight: 800, color: ON_COLOR, lineHeight: 1.05 }),
      t("subtitle", "Bajada", [96, 922, 900, 60], "Detalle clave en una línea", { fontSize: 28, color: ON_COLOR_SOFT }),
      t("price", "Precio", [1060, 808, 520, 150], "DESDE $0.000*", {
        fontSize: 64,
        fontWeight: 900,
        color: ON_COLOR,
        backgroundColor: ACCENT,
        backgroundCornerRadius: 0,
        align: "center",
        verticalAlign: "middle",
      }),
      button([1612, 838, 228, 90], ON_COLOR, BRAND, 24, "Visitar", 6),
      legal([96, 1000, 1400, 32], ON_COLOR_SOFT, 15),
    ]),
    square: root(1080, 1080, PAPER, [
      img("hero", "Imagen", [0, 0, 1080, 700]),
      t("ribbon", "Cintillo", [72, 60, 520, 68], "NUEVA ETAPA EN VENTA", {
        fontSize: 26,
        fontWeight: 800,
        color: ON_COLOR,
        backgroundColor: ACCENT,
        backgroundCornerRadius: 0,
        align: "center",
        verticalAlign: "middle",
        letterSpacing: 2,
      }),
      rect("band", "Franja", [0, 700, 1080, 380], BRAND),
      t("title", "Nombre", [72, 732, 936, 100], "Nombre del producto", { fontSize: 52, fontWeight: 800, color: ON_COLOR, lineHeight: 1.05 }),
      t("subtitle", "Bajada", [72, 836, 936, 50], "Detalle clave en una línea", { fontSize: 24, color: ON_COLOR_SOFT }),
      t("price", "Precio", [72, 900, 560, 100], "DESDE $0.000*", {
        fontSize: 52,
        fontWeight: 900,
        color: ON_COLOR,
        backgroundColor: ACCENT,
        backgroundCornerRadius: 0,
        align: "center",
        verticalAlign: "middle",
      }),
      button([680, 910, 328, 80], ON_COLOR, BRAND, 24, "Visitar", 6),
      legal([72, 1012, 936, 28], ON_COLOR_SOFT, 13),
    ]),
    vertical: root(1080, 1920, PAPER, [
      img("hero", "Imagen", [0, 0, 1080, 1150]),
      t("ribbon", "Cintillo", [72, 72, 600, 80], "NUEVA ETAPA EN VENTA", {
        fontSize: 30,
        fontWeight: 800,
        color: ON_COLOR,
        backgroundColor: ACCENT,
        backgroundCornerRadius: 0,
        align: "center",
        verticalAlign: "middle",
        letterSpacing: 2,
      }),
      rect("band", "Franja", [0, 1150, 1080, 770], BRAND),
      t("title", "Nombre", [72, 1200, 936, 200], "Nombre del producto", { fontSize: 88, fontWeight: 800, color: ON_COLOR, lineHeight: 1.02 }),
      t("subtitle", "Bajada", [72, 1410, 936, 90], "Detalle clave en una línea", { fontSize: 34, color: ON_COLOR_SOFT }),
      t("price", "Precio", [72, 1530, 640, 150], "DESDE $0.000*", {
        fontSize: 72,
        fontWeight: 900,
        color: ON_COLOR,
        backgroundColor: ACCENT,
        backgroundCornerRadius: 0,
        align: "center",
        verticalAlign: "middle",
      }),
      button([72, 1710, 420, 100], ON_COLOR, BRAND, 36, "Visitar", 8),
      legal([72, 1840, 936, 40], ON_COLOR_SOFT, 17),
    ]),
  },
};

// 4. Tipografía protagonista — titular gigante sobre fondo oscuro, foto como
// apoyo recortada. Para campañas de marca, deporte, lanzamientos.
const typeHero: LayoutTemplate = {
  id: "type-hero",
  name: "Tipografía protagonista",
  description:
    "Titular gigante de 2 líneas que ocupa casi todo el ancho sobre fondo oscuro; foto recortada como apoyo, precio en acento y botón. Deportiva/bold, lanzamientos y campañas de marca. Titular de máximo 2-3 palabras por línea.",
  aspects: {
    horizontal: root(1920, 1080, DARK, [
      t("title", "Titular", [96, 96, 1728, 560], "TITULAR\nGIGANTE", {
        fontSize: 230,
        fontWeight: 900,
        color: ON_COLOR,
        lineHeight: 0.88,
        letterSpacing: -4,
        textTransform: "uppercase",
      }),
      img("hero", "Imagen", [1240, 680, 584, 356]),
      t("subtitle", "Bajada", [96, 680, 1000, 80], "Una línea que aterriza la idea.", { fontSize: 32, color: SOFT_GREY }),
      t("price", "Precio", [96, 770, 1000, 100], "$0.000", { fontSize: 80, fontWeight: 900, color: ACCENT, lineHeight: 1 }),
      button([96, 890, 300, 80], ACCENT, ON_COLOR, 28, "Comprar"),
      legal([96, 1004, 1100, 32], SOFT_GREY, 14),
    ]),
    square: root(1080, 1080, DARK, [
      t("title", "Titular", [72, 72, 936, 420], "TITULAR\nGIGANTE", {
        fontSize: 150,
        fontWeight: 900,
        color: ON_COLOR,
        lineHeight: 0.88,
        letterSpacing: -3,
        textTransform: "uppercase",
      }),
      img("hero", "Imagen", [560, 520, 448, 460]),
      t("subtitle", "Bajada", [72, 520, 460, 120], "Una línea que aterriza la idea.", { fontSize: 30, color: SOFT_GREY, lineHeight: 1.3 }),
      t("price", "Precio", [72, 660, 460, 90], "$0.000", { fontSize: 64, fontWeight: 900, color: ACCENT, lineHeight: 1 }),
      button([72, 780, 300, 80], ACCENT, ON_COLOR, 26, "Comprar"),
      legal([72, 1004, 936, 32], SOFT_GREY, 14),
    ]),
    vertical: root(1080, 1920, DARK, [
      t("title", "Titular", [72, 96, 936, 720], "TITULAR\nGIGANTE", {
        fontSize: 190,
        fontWeight: 900,
        color: ON_COLOR,
        lineHeight: 0.88,
        letterSpacing: -4,
        textTransform: "uppercase",
      }),
      img("hero", "Imagen", [72, 860, 936, 560]),
      t("subtitle", "Bajada", [72, 1460, 936, 100], "Una línea que aterriza la idea.", { fontSize: 38, color: SOFT_GREY }),
      t("price", "Precio", [72, 1580, 936, 110], "$0.000", { fontSize: 90, fontWeight: 900, color: ACCENT, lineHeight: 1 }),
      button([72, 1710, 420, 100], ACCENT, ON_COLOR, 36, "Comprar"),
      legal([72, 1840, 936, 40], SOFT_GREY, 17),
    ]),
  },
};

// 5. Foto enmarcada — la foto con un marco del color de marca y un degradado
// suave para el texto encima. Moderna y versátil (tech, servicios, marca).
const framedPhoto: LayoutTemplate = {
  id: "framed-photo",
  name: "Foto enmarcada",
  description:
    "Foto casi a sangre dentro de un marco fino del color de marca, con degradado suave y el texto encima abajo a la izquierda: titular, bajada, precio y botón claro. Tech, servicios, campañas de marca. Necesita una foto con espacio libre donde va el texto.",
  aspects: {
    horizontal: root(1920, 1080, BRAND, [
      img("hero", "Imagen", [40, 40, 1840, 1000], 24),
      rect("shade", "Degradado", [40, 40, 1840, 1000], "linear-gradient(90deg, rgba(0,0,0,0.68), rgba(0,0,0,0) 62%)", 24),
      t("title", "Titular", [120, 260, 900, 300], "Titular sobre la foto", { fontSize: 110, fontWeight: 800, color: ON_COLOR, lineHeight: 1 }),
      t("subtitle", "Bajada", [120, 580, 800, 100], "Bajada breve que suma un dato.", { fontSize: 34, color: ON_COLOR_SOFT, lineHeight: 1.3 }),
      t("price", "Precio", [120, 700, 700, 90], "Desde $0.000", { fontSize: 64, fontWeight: 800, color: ON_COLOR, lineHeight: 1 }),
      button([120, 820, 320, 88], ON_COLOR, INK, 30, "Conocer más"),
      legal([120, 968, 900, 32], ON_COLOR_SOFT, 15),
    ]),
    square: root(1080, 1080, BRAND, [
      img("hero", "Imagen", [32, 32, 1016, 1016], 20),
      rect("shade", "Degradado", [32, 32, 1016, 1016], "linear-gradient(0deg, rgba(0,0,0,0.72), rgba(0,0,0,0) 62%)", 20),
      t("title", "Titular", [88, 560, 904, 190], "Titular sobre la foto", { fontSize: 80, fontWeight: 800, color: ON_COLOR, lineHeight: 1 }),
      t("subtitle", "Bajada", [88, 760, 904, 60], "Bajada breve que suma un dato.", { fontSize: 26, color: ON_COLOR_SOFT }),
      t("price", "Precio", [88, 830, 600, 70], "Desde $0.000", { fontSize: 52, fontWeight: 800, color: ON_COLOR, lineHeight: 1 }),
      button([88, 912, 300, 72], ON_COLOR, INK, 24, "Conocer más"),
      legal([420, 940, 572, 40], ON_COLOR_SOFT, 13),
    ]),
    vertical: root(1080, 1920, BRAND, [
      img("hero", "Imagen", [40, 40, 1000, 1840], 24),
      rect("shade", "Degradado", [40, 40, 1000, 1840], "linear-gradient(0deg, rgba(0,0,0,0.72), rgba(0,0,0,0) 55%)", 24),
      t("title", "Titular", [100, 1060, 880, 300], "Titular sobre la foto", { fontSize: 110, fontWeight: 800, color: ON_COLOR, lineHeight: 1 }),
      t("subtitle", "Bajada", [100, 1380, 880, 110], "Bajada breve que suma un dato.", { fontSize: 36, color: ON_COLOR_SOFT, lineHeight: 1.3 }),
      t("price", "Precio", [100, 1510, 880, 100], "Desde $0.000", { fontSize: 76, fontWeight: 800, color: ON_COLOR, lineHeight: 1 }),
      button([100, 1640, 400, 100], ON_COLOR, INK, 36, "Conocer más"),
      legal([100, 1790, 880, 40], ON_COLOR_SOFT, 16),
    ]),
  },
};

// 6. Lujo sobrio — foto a sangre oscura, bloque de texto chico y refinado,
// filete fino, precio y CTA discretos tipo enlace.
const quietLuxury: LayoutTemplate = {
  id: "quiet-luxury",
  name: "Lujo sobrio",
  description:
    "Foto a sangre con velo oscuro y un bloque de texto chico y refinado abajo a la izquierda: antetítulo espaciado, titular serif, filete fino, precio discreto y CTA tipo enlace. Inmobiliaria premium, automotriz, banca, joyería, vinos.",
  aspects: {
    horizontal: root(1920, 1080, DARK, [
      img("hero", "Imagen", [0, 0, 1920, 1080]),
      rect("shade", "Velo", [0, 0, 1920, 1080], "linear-gradient(90deg, rgba(10,10,12,0.72), rgba(10,10,12,0.1) 70%)"),
      kicker([120, 600, 800, 36], CHAMPAGNE, 22),
      t("title", "Titular", [120, 650, 980, 200], "Un titular sereno y elegante", {
        fontFamily: SERIF,
        fontSize: 84,
        fontWeight: 500,
        color: ON_COLOR,
        lineHeight: 1.05,
      }),
      rect("rule", "Filete", [120, 872, 120, 2], CHAMPAGNE),
      t("price", "Precio", [120, 896, 700, 56], "Desde UF 0.000", { fontSize: 34, fontWeight: 500, color: ON_COLOR, lineHeight: 1.1 }),
      t("cta", "CTA", [860, 896, 400, 56], "AGENDAR VISITA →", {
        fontSize: 24,
        fontWeight: 600,
        color: CHAMPAGNE,
        letterSpacing: 3,
        verticalAlign: "middle",
      }),
      legal([120, 996, 1100, 30], SOFT_GREY, 14),
    ]),
    square: root(1080, 1080, DARK, [
      img("hero", "Imagen", [0, 0, 1080, 1080]),
      rect("shade", "Velo", [0, 0, 1080, 1080], "linear-gradient(0deg, rgba(10,10,12,0.78), rgba(10,10,12,0.05) 65%)"),
      kicker([72, 600, 900, 32], CHAMPAGNE, 20),
      t("title", "Titular", [72, 644, 936, 180], "Un titular sereno y elegante", {
        fontFamily: SERIF,
        fontSize: 68,
        fontWeight: 500,
        color: ON_COLOR,
        lineHeight: 1.05,
      }),
      rect("rule", "Filete", [72, 846, 96, 2], CHAMPAGNE),
      t("price", "Precio", [72, 870, 520, 50], "Desde UF 0.000", { fontSize: 30, fontWeight: 500, color: ON_COLOR, lineHeight: 1.1 }),
      t("cta", "CTA", [620, 870, 388, 50], "AGENDAR VISITA →", {
        fontSize: 20,
        fontWeight: 600,
        color: CHAMPAGNE,
        letterSpacing: 3,
        align: "right",
        verticalAlign: "middle",
      }),
      legal([72, 996, 936, 32], SOFT_GREY, 13),
    ]),
    vertical: root(1080, 1920, DARK, [
      img("hero", "Imagen", [0, 0, 1080, 1920]),
      rect("shade", "Velo", [0, 0, 1080, 1920], "linear-gradient(0deg, rgba(10,10,12,0.8), rgba(10,10,12,0.05) 55%)"),
      kicker([72, 1300, 900, 40], CHAMPAGNE, 24),
      t("title", "Titular", [72, 1352, 936, 260], "Un titular sereno y elegante", {
        fontFamily: SERIF,
        fontSize: 92,
        fontWeight: 500,
        color: ON_COLOR,
        lineHeight: 1.05,
      }),
      rect("rule", "Filete", [72, 1640, 120, 2], CHAMPAGNE),
      t("price", "Precio", [72, 1668, 936, 60], "Desde UF 0.000", { fontSize: 38, fontWeight: 500, color: ON_COLOR, lineHeight: 1.1 }),
      t("cta", "CTA", [72, 1744, 936, 56], "AGENDAR VISITA →", {
        fontSize: 26,
        fontWeight: 600,
        color: CHAMPAGNE,
        letterSpacing: 3,
        verticalAlign: "middle",
      }),
      legal([72, 1836, 936, 40], SOFT_GREY, 16),
    ]),
  },
};

export const MODERN_TEMPLATES: LayoutTemplate[] = [
  priceBand,
  editorialSplit,
  colorBlock,
  typeHero,
  framedPhoto,
  quietLuxury,
];
