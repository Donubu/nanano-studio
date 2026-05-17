// Helpers para exportar adaptaciones a JPG client-side via html-to-image.
//
// Estrategia: el caller monta <AdaptationRenderer> en un container oculto
// (off-screen) y nos pasa el ref. Acá nos encargamos de:
//   1. Esperar a que las fuentes (Google Fonts inyectadas dinámicamente) y
//      las imágenes terminen de cargar.
//   2. Capturar el nodo con html-to-image.
//   3. Devolver el Blob JPG listo para descargar o meter a un ZIP.

import { toJpeg } from "html-to-image";

const JPG_QUALITY = 0.92; // 0..1; 0.92 es el sweet spot calidad/peso para banners

export async function waitForFontsAndImages(node: HTMLElement): Promise<void> {
  // Esperamos las fuentes del documento (Google Fonts inyectadas como <link>
  // se reflejan acá una vez parseadas y descargadas).
  if (typeof document !== "undefined" && document.fonts && document.fonts.ready) {
    await document.fonts.ready;
  }
  // Esperamos imágenes dentro del nodo. <img>.complete=true cuando la imagen
  // está cargada o falló; en cualquier caso ya no bloquea el render.
  const imgs = Array.from(node.querySelectorAll("img"));
  await Promise.all(
    imgs.map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
            return;
          }
          const done = () => {
            img.removeEventListener("load", done);
            img.removeEventListener("error", done);
            resolve();
          };
          img.addEventListener("load", done);
          img.addEventListener("error", done);
        }),
    ),
  );
}

// Lee el background computado del nodo y devuelve un color CSS válido
// para JPG. Si está transparente o no se puede leer, defaultea a blanco.
function resolveNodeBackground(node: HTMLElement): string {
  if (typeof window === "undefined") return "#ffffff";
  const bg = window.getComputedStyle(node).backgroundColor;
  if (!bg) return "#ffffff";
  // Chromium devuelve "rgba(0, 0, 0, 0)" para elementos sin bg.
  const transparentForms = new Set(["transparent", "rgba(0, 0, 0, 0)", "rgba(0,0,0,0)"]);
  if (transparentForms.has(bg)) return "#ffffff";
  return bg;
}

export async function captureNodeToJpeg(node: HTMLElement): Promise<Blob> {
  await waitForFontsAndImages(node);
  // skipFonts: true evita que html-to-image intente leer cssRules de las
  // stylesheets cross-origin (Google Fonts) — eso lanza SecurityError en
  // navegadores Chromium. Las fuentes ya están cargadas en el document
  // vía <link>, así que el foreignObject del SVG las usa al renderear
  // sin necesidad de embeber @font-face.
  //
  // backgroundColor: el JPG no soporta alpha, así que cualquier pixel
  // transparente del nodo capturado se aplana contra este color. Si lo
  // dejamos en "#ffffff" siempre, masters con fondo negro (o cualquier
  // color distinto a blanco) muestran áreas blancas donde el rendering
  // tiene transparencias. Tomamos el computed bg del nodo — si el master
  // es negro, las gaps quedan negras.
  const bg = resolveNodeBackground(node);
  const dataUrl = await toJpeg(node, {
    quality: JPG_QUALITY,
    pixelRatio: 1,
    cacheBust: true,
    backgroundColor: bg,
    skipFonts: true,
  });
  const res = await fetch(dataUrl);
  return res.blob();
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // setTimeout porque algunos navegadores necesitan el URL vivo durante el download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Sanea un string para usarlo como nombre de archivo seguro en cualquier OS.
export function sanitizeFilename(name: string): string {
  return name
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 100);
}
