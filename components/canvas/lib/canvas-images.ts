// Imágenes del canvas para el panel "Imágenes" (catálogo, links y descargas):
// primero las vinculadas de otros canvas (imágenes y las etapas de Personajes
// vinculados), por canvas de origen con orden natural y de izquierda a
// derecha; después las propias: las de cada escena en orden ("Escena 3 ·
// Imagen"), luego las demás de arriba hacia abajo (generadas, estáticas y las
// fotos de cada galería). Solo las que tienen imagen; una URL repetida sale
// una vez. Puro.

import { sceneFinalVideos, sceneVideoLabel } from "./scene-videos";
import { videoFileName } from "./canvas-videos";

type N = { id: string; type?: string; position: { x: number; y: number }; data: Record<string, unknown> };
type E = { source: string; target: string };

export interface CanvasImage {
  // Único en el canvas: el id del nodo, más "#n" si el nodo tiene varias
  // (galería, Personaje vinculado).
  key: string;
  nodeId: string;
  label: string;
  // Canvas de origen (vinculadas) o "Este canvas".
  group: string;
  url: string;
}

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** Cuántas imágenes tiene el canvas (para el botón; sin ordenar ni nombrar). */
export function countCanvasImages(nodes: Pick<N, "type" | "data">[]): number {
  const urls = new Set<string>();
  for (const n of nodes) for (const u of imageUrlsOf(n)) urls.add(u);
  return urls.size;
}

function imageUrlsOf(n: Pick<N, "type" | "data">): string[] {
  const d = n.data;
  if (n.type === "image") return d.status === "completed" && str(d.outputUrl) ? [str(d.outputUrl)] : [];
  if (n.type === "static-image") return str(d.imageUrl) ? [str(d.imageUrl)] : [];
  if (n.type === "static-image-group") return ((d.images as { url?: unknown }[] | undefined) ?? []).map((i) => str(i?.url)).filter(Boolean);
  if (n.type === "linked") {
    const snap = d.linkSnapshot as { kind?: string; imageUrl?: unknown; stages?: { imageUrl?: unknown }[] } | null | undefined;
    if (snap?.kind === "image") return str(snap.imageUrl) ? [str(snap.imageUrl)] : [];
    if (snap?.kind === "character") return (snap.stages ?? []).map((s) => str(s.imageUrl)).filter(Boolean);
  }
  return [];
}

export function listCanvasImages(nodes: N[], edges: E[] = []): CanvasImage[] {
  // Escena de cada nodo propio: su nombre, su orden y el orden dentro de ella.
  const sceneOf = new Map<string, { label: string; order: number }>();
  sceneFinalVideos(nodes, edges).forEach((sv, i) => {
    sv.nodeIds.forEach((id, j) => {
      if (!sceneOf.has(id)) sceneOf.set(id, { label: sceneVideoLabel(sv), order: i * 10_000 + j });
    });
  });

  type Row = CanvasImage & { a: number; b: number; c: number };
  const linked: Row[] = [];
  const own: Row[] = [];
  for (const n of nodes) {
    const d = n.data;
    const name = str(d.label);
    if (n.type === "linked") {
      const snap = d.linkSnapshot as
        | { kind?: string; label?: string; imageUrl?: unknown; stages?: { name?: string; imageUrl?: unknown }[] }
        | null
        | undefined;
      const group = String(d.sourceCanvasTitle || `Canvas ${d.sourceConversationId ?? ""}`);
      const add = (key: string, label: string, url: string, i: number) =>
        linked.push({ key, nodeId: n.id, label: `${group} · ${label}`, group, url, a: n.position.x, b: n.position.y, c: i });
      if (snap?.kind === "image" && str(snap.imageUrl)) add(n.id, snap.label || "Imagen", str(snap.imageUrl), 0);
      if (snap?.kind === "character") {
        (snap.stages ?? []).forEach((s, i) => {
          if (str(s.imageUrl)) add(`${n.id}#${i}`, `${snap.label || "Personaje"} · ${s.name || `Etapa ${i + 1}`}`, str(s.imageUrl), i);
        });
      }
      continue;
    }
    const urls = imageUrlsOf(n);
    if (urls.length === 0) continue;
    const sc = sceneOf.get(n.id);
    const base = name || (n.type === "image" ? "Imagen" : n.type === "static-image" ? "Imagen estática" : "Galería");
    const label = sc ? (name && name !== "Imagen" ? `${sc.label} · ${name}` : sc.label) : base;
    urls.forEach((url, i) =>
      own.push({
        key: urls.length > 1 ? `${n.id}#${i}` : n.id,
        nodeId: n.id,
        label: urls.length > 1 ? `${label} · ${i + 1}` : label,
        group: "Este canvas",
        url,
        a: sc ? sc.order : Number.MAX_SAFE_INTEGER,
        b: n.position.y,
        c: n.position.x * 1000 + i,
      }),
    );
  }
  linked.sort((x, y) => x.group.localeCompare(y.group, "es", { numeric: true, sensitivity: "base" }) || x.a - y.a || x.b - y.b || x.c - y.c);
  own.sort((x, y) => x.a - y.a || x.b - y.b || x.c - y.c);

  const seen = new Set<string>();
  const out: CanvasImage[] = [];
  for (const { key, nodeId, label, group, url } of [...linked, ...own]) {
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ key, nodeId, label, group, url });
  }
  return out;
}

/** Extensión del archivo según la URL (png si no se reconoce). */
export function imageExtension(url: string): string {
  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {
    /* URL relativa: se usa tal cual */
  }
  const m = /\.(png|jpe?g|webp|gif|avif)$/i.exec(path);
  return m ? m[1].toLowerCase().replace("jpeg", "jpg") : "png";
}

/** "03 - ACTO 1 - Escena 3.png": ordena bien en una carpeta. */
export function imageFileName(index: number, total: number, img: Pick<CanvasImage, "label" | "url">): string {
  return videoFileName(index, total, img.label || "Imagen", imageExtension(img.url));
}
