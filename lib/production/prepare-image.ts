// Preparación client-side de imágenes que van al Banner Designer (referencias
// del productor y captura del master para adaptar).
//
// Los modelos de visión cobran por píxeles, no por bytes: Claude reduce todo
// a 1568 px de lado largo antes de contar tokens y Gemini cuenta baldosas de
// 768 px. Mandar más resolución que eso no aporta nada y sí cuesta: un
// pantallazo Retina en PNG pesa 3-8 MB, viaja en base64 (+33%) por el body
// de Next, se guarda entero en GCS y Practicante lo tiene que bajar. Acá lo
// dejamos en ≤ 1568 px y lo codificamos en WebP (25-35% más liviano que JPEG
// a igual calidad) con fallback a JPEG si el navegador no sabe codificar WebP.
//
// Solo corre en el browser (usa <img>, canvas y FileReader).

export const AGENT_IMAGE_MAX_SIDE = 1568;
const DEFAULT_QUALITY = 0.82;

export interface PreparedImage {
  blob: Blob;
  dataUri: string;
  mimeType: "image/webp" | "image/jpeg";
  extension: "webp" | "jpg";
  width: number;
  height: number;
  originalBytes: number;
}

export interface PrepareImageOptions {
  maxSide?: number;
  quality?: number;
  // Color contra el que se aplanan las transparencias cuando cae a JPEG
  // (WebP conserva alpha). Default blanco.
  background?: string;
}

export async function prepareImageForAgent(
  source: Blob,
  opts: PrepareImageOptions = {},
): Promise<PreparedImage> {
  const maxSide = opts.maxSide ?? AGENT_IMAGE_MAX_SIDE;
  const quality = opts.quality ?? DEFAULT_QUALITY;
  const background = opts.background ?? "#ffffff";

  const img = await decodeToImage(source);
  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (!srcW || !srcH) {
    throw new Error("No se pudo leer el tamaño de la imagen");
  }
  const scale = Math.min(1, maxSide / Math.max(srcW, srcH));
  const width = Math.max(1, Math.round(srcW * scale));
  const height = Math.max(1, Math.round(srcH * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D no disponible");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, width, height);

  // WebP primero. Safari < 16 y algunos WebViews devuelven null o un PNG
  // cuando no soportan el encoder — en ese caso aplanamos y vamos a JPEG.
  let blob = await canvasToBlob(canvas, "image/webp", quality);
  let mimeType: PreparedImage["mimeType"] = "image/webp";
  if (!blob || blob.type !== "image/webp") {
    ctx.globalCompositeOperation = "destination-over";
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
    ctx.globalCompositeOperation = "source-over";
    blob = await canvasToBlob(canvas, "image/jpeg", quality);
    mimeType = "image/jpeg";
    if (!blob) throw new Error("El navegador no pudo codificar la imagen");
  }

  const dataUri = await blobToDataUri(blob);
  return {
    blob,
    dataUri,
    mimeType,
    extension: mimeType === "image/webp" ? "webp" : "jpg",
    width,
    height,
    originalBytes: source.size,
  };
}

// Reemplaza la extensión del nombre original por la del formato preparado,
// preservando el resto para que el productor reconozca el archivo.
export function renameForPrepared(filename: string, extension: PreparedImage["extension"]): string {
  const base = filename.replace(/\.[a-z0-9]+$/i, "");
  return `${base || "referencia"}.${extension}`;
}

function decodeToImage(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("No se pudo decodificar la imagen"));
    };
    img.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("FileReader falló"));
    reader.readAsDataURL(blob);
  });
}
