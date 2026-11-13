// Descargas de los videos de un canvas (panel "Videos"): la lista se arma en
// el servidor desde el canvas guardado (mismo orden y nombres que el panel),
// así las rutas no reciben URLs del cliente. Solo se bajan archivos de
// nuestro bucket.

import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import { isOwnStorageUrl } from "@/lib/s3";
import { listCanvasVideos, videoFileName } from "@/components/canvas/lib/canvas-videos";

export interface DownloadUser {
  id: number;
  isAdmin: boolean;
}

export interface CanvasVideoFile {
  nodeId: string;
  fileName: string;
  url: string;
}

/**
 * Videos listos del canvas con su nombre de archivo numerado. null si el
 * canvas no existe o el usuario no puede leerlo (admin, dueño o miembro del
 * proyecto).
 */
export async function canvasVideoFiles(conversationId: number, user: DownloadUser): Promise<{ title: string; files: CanvasVideoFile[] } | null> {
  const [convs] = await pool.execute<RowDataPacket[]>(
    `SELECT id, user_id, project_id, title FROM conversations WHERE id = ? AND deleted_at IS NULL AND generation_type = 'canvas'`,
    [conversationId],
  );
  const conv = convs[0];
  if (!conv) return null;
  if (!user.isAdmin && conv.user_id !== user.id) {
    if (conv.project_id == null) return null;
    const [m] = await pool.execute<RowDataPacket[]>(`SELECT 1 FROM project_users WHERE project_id = ? AND user_id = ? LIMIT 1`, [conv.project_id, user.id]);
    if (m.length === 0) return null;
  }

  const [nodeRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, type, label, position_x, position_y, config, status, output_url
     FROM canvas_nodes WHERE conversation_id = ? AND deleted_at IS NULL AND type IN ('video', 'linked', 'scene')`,
    [conversationId],
  );
  const [edgeRows] = await pool.execute<RowDataPacket[]>(
    `SELECT source_node_id, target_node_id FROM canvas_edges WHERE conversation_id = ? AND deleted_at IS NULL`,
    [conversationId],
  );
  // Las escenas necesitan sus destinos (imagen → video) para saber qué video
  // es el final de cada una: se cargan también los nodos intermedios.
  const [midRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, type FROM canvas_nodes WHERE conversation_id = ? AND deleted_at IS NULL AND type NOT IN ('video', 'linked', 'scene')`,
    [conversationId],
  );
  const nodes = [
    ...nodeRows.map((r) => {
      const config = typeof r.config === "string" ? JSON.parse(r.config || "{}") : (r.config ?? {});
      return {
        id: r.id as string,
        type: r.type as string,
        position: { x: Number(r.position_x) || 0, y: Number(r.position_y) || 0 },
        data: { ...config, label: r.label, status: r.status, outputUrl: r.output_url },
      };
    }),
    ...midRows.map((r) => ({ id: r.id as string, type: r.type as string, position: { x: 0, y: 0 }, data: {} })),
  ];
  const edges = edgeRows.map((e) => ({ source: e.source_node_id as string, target: e.target_node_id as string }));

  const all = listCanvasVideos(nodes, edges);
  const files = all
    .map((v, i) => ({ nodeId: v.nodeId, url: v.url, fileName: videoFileName(i, all.length, v.label) }))
    .filter((f): f is CanvasVideoFile => !!f.url && isOwnStorageUrl(f.url));
  return { title: String(conv.title || `Canvas ${conversationId}`), files };
}

/** Content-Disposition con nombre UTF-8 (y uno ASCII de respaldo). */
export function attachmentHeader(fileName: string): string {
  const ascii = fileName.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** Body de un archivo del bucket como trozos. */
export async function* fetchChunks(url: string): AsyncGenerator<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`No se pudo leer ${url} (HTTP ${res.status})`);
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    if (value) yield value;
  }
}
