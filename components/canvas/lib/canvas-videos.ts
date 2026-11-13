// Videos del canvas para el panel "Videos" (links y descargas): primero los
// vinculados en orden de montaje (canvas de origen con orden natural, luego
// escena, la B después de su A), después los videos finales de las escenas de
// este canvas (en orden, "Escena 3") y al final los demás videos propios, de
// arriba hacia abajo. Puro.

import { sceneFinalVideos, sceneVideoLabel } from "./scene-videos";

type N = { id: string; type?: string; position: { x: number; y: number }; data: Record<string, unknown> };
type E = { source: string; target: string };

export interface CanvasVideo {
  nodeId: string;
  label: string;
  // Canvas de origen (vinculados) o "Este canvas".
  group: string;
  url: string | null;
}

export function listCanvasVideos(nodes: N[], edges: E[] = []): CanvasVideo[] {
  // Video final de cada escena de este canvas: su nombre y su orden.
  const sceneOf = new Map<string, { label: string; order: number }>();
  sceneFinalVideos(nodes, edges).forEach((sv, i) => {
    for (const v of sv.videoIds) sceneOf.set(v, { label: sceneVideoLabel(sv), order: i });
  });
  const linked: (CanvasVideo & { order: number; x: number })[] = [];
  const own: (CanvasVideo & { x: number; y: number; order: number })[] = [];
  for (const n of nodes) {
    const d = n.data;
    if (n.type === "linked") {
      const snap = d.linkSnapshot as { kind?: string; label?: string; videoUrl?: string | null; scene?: { sceneIndex?: number; variant?: string } | null } | null | undefined;
      if (snap?.kind !== "video") continue;
      const group = String(d.sourceCanvasTitle || `Canvas ${d.sourceConversationId ?? ""}`);
      linked.push({
        nodeId: n.id,
        label: `${group} · ${snap.label || "Video"}`,
        group,
        url: snap.videoUrl || null,
        order: snap.scene ? (snap.scene.sceneIndex ?? 0) * 2 + (snap.scene.variant === "B" ? 1 : 0) : Number.MAX_SAFE_INTEGER,
        x: n.position.x,
      });
    } else if (n.type === "video") {
      const url = d.status === "completed" && typeof d.outputUrl === "string" && d.outputUrl ? d.outputUrl : null;
      const sc = sceneOf.get(n.id);
      const name = String(d.label || "").trim();
      own.push({
        nodeId: n.id,
        label: sc ? (name && name !== "Video" ? `${sc.label} · ${name}` : sc.label) : name || "Video",
        group: "Este canvas",
        url,
        x: n.position.x,
        y: n.position.y,
        order: sc ? sc.order : Number.MAX_SAFE_INTEGER,
      });
    }
  }
  linked.sort((a, b) => a.group.localeCompare(b.group, "es", { numeric: true, sensitivity: "base" }) || a.order - b.order || a.x - b.x);
  own.sort((a, b) => a.order - b.order || a.y - b.y || a.x - b.x);
  return [...linked, ...own].map(({ nodeId, label, group, url }) => ({ nodeId, label, group, url }));
}

/** Nombre de archivo que ordena bien en una carpeta: "03 - ACTO 1 - Escena 3.mp4". */
export function videoFileName(index: number, total: number, label: string, ext = "mp4"): string {
  const pad = String(index + 1).padStart(String(total).length, "0");
  const clean = label.replace(/·/g, "-").replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim();
  return `${pad} - ${clean || "Video"}.${ext}`;
}
