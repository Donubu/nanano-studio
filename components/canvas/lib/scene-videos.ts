// Video final de cada escena de un Guión: el video al que llega lo que genera
// la escena (Escena → destino → … → Video). Puro: lo usan el servidor de
// vínculos ("Traer videos del guion") y la vista de un video vinculado.

type N = { id: string; type?: string; data: Record<string, unknown> };
type E = { source: string; target: string };

export interface SceneVideos {
  sceneId: string;
  scriptId: string;
  sceneIndex: number;
  totalScenes: number;
  variant?: "A" | "B";
  // Videos finales (sin otro video después dentro de la escena). Casi siempre uno.
  videoIds: string[];
}

/**
 * Por cada escena, los videos a los que llega su destino, sin pasar por
 * otras escenas ni por los destinos de otras escenas (la continuidad entre
 * destinos no mezcla filas). Ordenado por Guión, escena y versión (A, B).
 */
export function sceneFinalVideos(nodes: N[], edges: E[]): SceneVideos[] {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const kids = new Map<string, string[]>();
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target) || e.source === e.target) continue;
    if (!kids.has(e.source)) kids.set(e.source, []);
    kids.get(e.source)!.push(e.target);
  }
  // En orden de escena: lo que alcanzan dos escenas (el último fotograma de
  // un video sale de la imagen de la escena siguiente) es de la primera.
  const order = (n: N) => {
    const d = n.data as { scriptNodeId?: string; sceneIndex?: number; variant?: string };
    return { sid: String(d.scriptNodeId ?? ""), idx: Number(d.sceneIndex) || 0, b: d.variant === "B" ? 1 : 0 };
  };
  const scenes = nodes
    .filter((n) => n.type === "scene")
    .sort((x, y) => {
      const a = order(x);
      const b = order(y);
      return a.sid.localeCompare(b.sid) || a.idx - b.idx || a.b - b.b;
    });
  const directOf = new Map<string, string[]>();
  const owned = new Set<string>();
  for (const sc of scenes) {
    const direct = (kids.get(sc.id) ?? []).filter((c) => byId.get(c)!.type !== "scene");
    directOf.set(sc.id, direct);
    for (const c of direct) owned.add(c);
  }

  const out: SceneVideos[] = [];
  const claimed = new Set<string>();
  for (const sc of scenes) {
    const d = sc.data as { scriptNodeId?: string; sceneIndex?: number; totalScenes?: number; variant?: string };
    const direct = directOf.get(sc.id)!;
    for (const c of direct) claimed.add(c);
    const reached = new Set<string>(direct);
    const queue = [...direct];
    while (queue.length) {
      const cur = queue.shift()!;
      for (const c of kids.get(cur) ?? []) {
        if (reached.has(c) || claimed.has(c) || byId.get(c)!.type === "scene" || owned.has(c)) continue;
        reached.add(c);
        claimed.add(c);
        queue.push(c);
      }
    }
    const videos = [...reached].filter((id) => byId.get(id)!.type === "video");
    const hasVideoAfter = (id: string): boolean => {
      const seen = new Set<string>();
      const q = [...(kids.get(id) ?? [])];
      while (q.length) {
        const c = q.shift()!;
        if (seen.has(c) || !reached.has(c)) continue;
        seen.add(c);
        if (byId.get(c)!.type === "video") return true;
        q.push(...(kids.get(c) ?? []));
      }
      return false;
    };
    out.push({
      sceneId: sc.id,
      scriptId: String(d.scriptNodeId ?? ""),
      sceneIndex: Number(d.sceneIndex) || 0,
      totalScenes: Number(d.totalScenes) || 0,
      ...(d.variant === "A" || d.variant === "B" ? { variant: d.variant } : {}),
      videoIds: videos.filter((v) => !hasVideoAfter(v)),
    });
  }
  return out;
}

/** Escena de la que un video es el final (o null). */
export function sceneOfVideo(videoId: string, all: SceneVideos[]): SceneVideos | null {
  return all.find((s) => s.videoIds.includes(videoId)) ?? null;
}

/** "Escena 3", "Escena 3B". */
export function sceneVideoLabel(s: { sceneIndex: number; variant?: "A" | "B" }): string {
  return `Escena ${s.sceneIndex}${s.variant ?? ""}`;
}
