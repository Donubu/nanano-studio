// Miniaturas para mostrar imágenes en el canvas.
//
// Las imágenes del canvas se guardan en tamaño original (generadas ~1,8 MB,
// fotos subidas de hasta ~7 MB). Para MOSTRARLAS se piden achicadas al
// optimizador de Next (/_next/image), que ya está configurado para nuestro
// bucket (next.config.ts → images.remotePatterns). Solo cambia el ancho: el
// alto sale de la proporción de cada imagen, no se recorta nada.
//
// La URL guardada en el nodo NO cambia: referencias para generar, visor y
// descargas siguen usando el original.

/** Anchos permitidos por next.config.ts (deviceSizes ∪ imageSizes). */
export const THUMB_WIDTHS = [128, 256, 384, 640, 828, 1080, 1200, 1920] as const;
export type ThumbWidth = (typeof THUMB_WIDTHS)[number];

// Next 16 solo acepta las calidades de images.qualities (default [75]).
const THUMB_QUALITY = 75;

// Mismos hosts que images.remotePatterns: otro host daría 400 en /_next/image.
const OPTIMIZABLE_HOSTS = new Set(["storage.googleapis.com", "static.puer.to"]);

/** URL de la miniatura de `url` con `width` px de ancho; la original si no
 *  se puede optimizar (blob:/data: de una subida en curso, otros hosts). */
export function thumbUrl(url: string | null | undefined, width: ThumbWidth): string {
  if (!url) return "";
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.protocol !== "https:" || !OPTIMIZABLE_HOSTS.has(parsed.hostname)) return url;
  return `/_next/image?url=${encodeURIComponent(url)}&w=${width}&q=${THUMB_QUALITY}`;
}

/** true si una imagen dibujada a `boxWidth` px (CSS, sin zoom) con zoom
 *  `zoom` y densidad `dpr` necesita más píxeles que la miniatura de `width`. */
export function needsOriginal(boxWidth: number, zoom: number, dpr: number, width: number): boolean {
  if (boxWidth <= 0) return false;
  // 15% de tolerancia: un leve reescalado no se nota y evita bajar el original.
  return boxWidth * zoom * dpr > width * 1.15;
}
