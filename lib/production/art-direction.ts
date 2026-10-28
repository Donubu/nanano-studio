// Dirección de arte de la IA de producción: el criterio estético que se
// inyecta en todos los prompts de diseño (planificador, "Pídele a la IA",
// recomposición, pieles, texturas y fotos). Sin esto los modelos caen en el
// promedio publicitario: estrellas de oferta, biseles, brillos plásticos.
//
// ES UN BORRADOR PARA QUE LO CORRIJA EL EQUIPO CREATIVO: es texto plano,
// editable sin tocar la lógica. Si una marca tiene brand_guide, la guía de
// marca manda sobre esto.

export interface ArtDirection {
  id: string;
  label: string;
  // Cuándo calza y cómo se ve.
  when: string;
  look: string;
}

export const ART_DIRECTIONS: ArtDirection[] = [
  {
    id: "editorial",
    label: "Editorial minimal",
    when: "moda, belleza, cultura, lanzamientos de producto premium, marcas con mucho aire",
    look: "mucho espacio negativo, una sola foto protagonista, titular grande y corto con contraste de tamaño fuerte contra una bajada chica, paleta de 2 colores, alineación a la izquierda con tensión asimétrica",
  },
  {
    id: "bold",
    label: "Deportiva / bold",
    when: "deporte, energía, juventud, promociones con urgencia",
    look: "tipografía condensada o extra bold muy grande que puede ocupar casi todo el ancho, color de marca plano en bloques, foto con movimiento recortada con decisión, diagonales o cortes; nada de efectos de brillo",
  },
  {
    id: "premium",
    label: "Lujo sobrio",
    when: "automotriz, inmobiliaria, banca, joyería, vinos",
    look: "paleta oscura o neutra, una tipografía refinada (serif o sans fina), detalles mínimos, precio y CTA discretos, foto con luz controlada; el lujo es lo que NO se pone",
  },
  {
    id: "tech",
    label: "Tech / digital",
    when: "telcos, apps, fintech, tecnología",
    look: "fondos con degradados suaves de 2 tonos cercanos, formas geométricas simples, mockups o producto flotando con sombra suave, sans geométrica, mucho orden",
  },
  {
    id: "retail",
    label: "Retail limpio",
    when: "supermercado, farmacia, tiendas, descuentos y precios",
    look: "producto recortado grande, precio como protagonista tipográfico (cifra grande, signo y decimales chicos), etiqueta de descuento plana y rectangular en el color de marca, fondo de color sólido; ordenado, no recargado",
  },
];

export const COMPOSITION_RULES = [
  "Una idea por pieza: titular, apoyo visual y CTA. Máximo 3 o 4 elementos visibles; si sobra algo, sácalo.",
  "Jerarquía con contraste de tamaño fuerte: el titular al menos 2 veces la bajada. Dos tamaños de texto distintos bastan; tres es el máximo.",
  "Alinea todo a una grilla: un mismo margen y un eje de alineación (izquierda casi siempre funciona mejor que todo centrado).",
  "Deja aire: el espacio vacío es parte del diseño. Nada pegado a los bordes ni amontonado.",
  "Máximo 2 familias tipográficas y 2 o 3 colores (más blanco/negro).",
  "El color de marca en bloques planos o en un solo acento fuerte, no repartido en todo.",
  "La foto manda: elige el encuadre y no la tapes con texto donde está el sujeto.",
  "El CTA es claro y sobrio: botón plano o con una sombra muy suave, texto de 1 a 3 palabras.",
];

export const DATED_PATTERNS = [
  "estrellas o explosiones de oferta (starburst), sellos dentados, cintas o rosetas",
  "biseles, relieves, brillos plásticos o efecto 'gel' en botones y etiquetas",
  "texto dorado, metalizado, cromado o con volumen 3D (salvo que la marca o el pedido lo pidan explícitamente)",
  "degradados arcoíris o de colores que no se tocan; sombras duras y negras",
  "contornos gruesos o dobles en titulares de marcas serias",
  "todo centrado y del mismo tamaño, sin tensión ni jerarquía",
  "muchos íconos, viñetas y etiquetas compitiendo entre sí",
  "clip-art, ilustraciones genéricas de stock, fotos con look de banco de imágenes",
];

// Bloque para los system prompts de diseño (español).
export function artDirectionGuide(): string {
  return `Dirección de arte (criterio actual de la agencia; la guía de marca, si viene, manda sobre esto):
- Diseña como una agencia de 2026: piezas limpias, con jerarquía fuerte, aire y una sola idea. Si el productor no pide un estilo, elige UNA de estas direcciones según la marca y el brief, y sé coherente con ella en textos, colores, imágenes y efectos:
${ART_DIRECTIONS.map((d) => `  · ${d.label} (${d.when}): ${d.look}.`).join("\n")}
- Composición:
${COMPOSITION_RULES.map((r) => `  · ${r}`).join("\n")}
- Se ve anticuado, evítalo salvo pedido explícito del productor o de la marca:
${DATED_PATTERNS.map((r) => `  · ${r}`).join("\n")}`;
}

// Estilo para el generador de imágenes (inglés): fotos de propuestas.
export const PHOTO_STYLE =
  "Contemporary art direction: editorial or campaign-quality photography, natural or controlled soft light, real textures, considered composition with negative space. Avoid stock-photo look, clip-art, over-saturated HDR, plastic 3D renders and lens flares.";

// Estilo por defecto de pieles de botones y etiquetas (inglés). El pedido del
// productor manda: esto solo aplica a lo que no especifica.
export const SKIN_STYLE_DEFAULT =
  "Unless the requested style says otherwise, keep it modern and flat: solid color or a very subtle two-tone gradient, crisp clean edges, at most a soft subtle shadow. Avoid starbursts, jagged seals, ribbons, bevels, glossy plastic highlights, gel or chrome effects, and heavy 3D.";

// Estilo por defecto de texturas dentro de letras (inglés).
export const TEXTURE_STYLE_DEFAULT =
  "Refined, contemporary material with subtle detail; avoid cheesy metallic glitter, clip-art patterns and high-contrast noise that would hurt legibility.";
