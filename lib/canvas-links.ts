// Nodos vinculados entre canvas (servidor): control de acceso, vista resuelta
// de un Personaje de otro canvas y listado de lo que se puede vincular.
//
// Regla de acceso: el canvas de origen debe ser del MISMO proyecto que el
// canvas destino (proyecto no nulo) y el usuario debe ser admin, dueño del
// canvas de origen o miembro del proyecto.

import { createHash } from "crypto";
import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import { HANDLE_IDS, baseHandleId, type CharacterNodeData, type LinkState, type LinkedSnapshot } from "@/components/canvas/lib/canvas-types";
import { buildCharacterSnapshot } from "@/components/canvas/lib/linked";

export interface LinkUser {
  id: number;
  isAdmin: boolean;
}

interface ConvRow extends RowDataPacket {
  id: number;
  user_id: number;
  project_id: number | null;
  title: string | null;
  generation_type: string;
}

interface NodeRow extends RowDataPacket {
  id: string;
  type: string;
  label: string;
  config: string | Record<string, unknown> | null;
  status: string;
  output_url: string | null;
  output_text: string | null;
  deleted_at: string | null;
}

type NodeLike = { id: string; type: string; data: Record<string, unknown> };

const MAX_REFS = 50;

function rowToNode(row: NodeRow): NodeLike {
  const config = typeof row.config === "string" ? JSON.parse(row.config || "{}") : (row.config ?? {});
  return {
    id: row.id,
    type: row.type,
    data: {
      ...config,
      label: row.label,
      status: row.status,
      outputUrl: row.output_url,
      outputText: row.output_text,
    },
  };
}

async function loadConversation(id: number): Promise<ConvRow | null> {
  const [rows] = await pool.execute<ConvRow[]>(
    `SELECT id, user_id, project_id, title, generation_type FROM conversations WHERE id = ? AND deleted_at IS NULL`,
    [id],
  );
  return rows[0] ?? null;
}

async function isProjectMember(projectId: number, userId: number): Promise<boolean> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT 1 FROM project_users WHERE project_id = ? AND user_id = ? LIMIT 1`,
    [projectId, userId],
  );
  return rows.length > 0;
}

/** true si el usuario puede leer canvas del proyecto (admin o miembro). */
async function canReadProject(projectId: number, user: LinkUser): Promise<boolean> {
  return user.isAdmin || (await isProjectMember(projectId, user.id));
}

async function canReadSource(source: ConvRow, target: ConvRow, user: LinkUser, memberCache: Map<number, boolean>): Promise<boolean> {
  if (source.generation_type !== "canvas") return false;
  if (target.project_id == null || source.project_id !== target.project_id) return false;
  if (user.isAdmin || source.user_id === user.id) return true;
  if (!memberCache.has(source.project_id)) memberCache.set(source.project_id, await isProjectMember(source.project_id, user.id));
  return memberCache.get(source.project_id)!;
}

function hashSnapshot(snapshot: LinkedSnapshot): string {
  return createHash("sha1").update(JSON.stringify(snapshot)).digest("hex").slice(0, 16);
}

/** Vista resuelta de un Personaje de su canvas. null si no existe o no es Personaje. */
async function resolveCharacter(conversationId: number, nodeId: string): Promise<LinkedSnapshot | null> {
  const [rows] = await pool.execute<NodeRow[]>(
    `SELECT id, type, label, config, status, output_url, output_text, deleted_at
     FROM canvas_nodes WHERE conversation_id = ? AND id = ?`,
    [conversationId, nodeId],
  );
  const row = rows[0];
  if (!row || row.deleted_at || row.type !== "character") return null;
  const character = rowToNode(row);

  const [edgeRows] = await pool.execute<RowDataPacket[]>(
    `SELECT source_node_id, target_handle FROM canvas_edges
     WHERE conversation_id = ? AND target_node_id = ? AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    [conversationId, nodeId],
  );
  let styleId: string | null = null;
  const galleryIds: string[] = [];
  for (const e of edgeRows) {
    const handle = baseHandleId(e.target_handle as string | null);
    if (handle === HANDLE_IDS.INPUT_CHARACTER_STYLE && !styleId) styleId = e.source_node_id as string;
    if (handle === HANDLE_IDS.INPUT_CHARACTER_GALLERY) galleryIds.push(e.source_node_id as string);
  }
  const stageImageIds = ((character.data as unknown as CharacterNodeData).stages ?? [])
    .map((s) => s.imageNodeId)
    .filter((id): id is string => !!id);

  const ids = [...new Set([...(styleId ? [styleId] : []), ...galleryIds, ...stageImageIds])];
  const byId = new Map<string, NodeLike>();
  if (ids.length > 0) {
    const [related] = await pool.execute<NodeRow[]>(
      `SELECT id, type, label, config, status, output_url, output_text, deleted_at
       FROM canvas_nodes
       WHERE conversation_id = ? AND deleted_at IS NULL AND id IN (${ids.map(() => "?").join(",")})`,
      [conversationId, ...ids],
    );
    for (const r of related) byId.set(r.id, rowToNode(r));
  }

  return buildCharacterSnapshot({
    character,
    styleNode: styleId ? byId.get(styleId) ?? null : null,
    galleries: galleryIds.map((id) => byId.get(id)).filter((n): n is NodeLike => !!n),
    stageImages: stageImageIds.map((id) => byId.get(id)).filter((n): n is NodeLike => !!n),
  });
}

export interface LinkRef {
  conversationId: number;
  nodeId: string;
}

export interface LinkResolution extends LinkRef {
  state: LinkState;
  sourceCanvasTitle?: string;
  snapshot?: LinkedSnapshot;
  hash?: string;
}

/**
 * Resuelve la vista de cada nodo vinculado de un canvas. Sin acceso al
 * origen → "forbidden" (sin datos); origen borrado → "deleted" (el cliente
 * conserva su última vista).
 */
export async function resolveLinks(targetConversationId: number, user: LinkUser, refs: LinkRef[]): Promise<LinkResolution[] | null> {
  const target = await loadConversation(targetConversationId);
  if (!target) return null;
  const memberCache = new Map<number, boolean>();
  const convCache = new Map<number, ConvRow | null>();
  const out: LinkResolution[] = [];
  for (const ref of refs.slice(0, MAX_REFS)) {
    const convId = Number(ref.conversationId);
    if (!Number.isInteger(convId) || convId <= 0 || typeof ref.nodeId !== "string" || !ref.nodeId) continue;
    if (!convCache.has(convId)) convCache.set(convId, await loadConversation(convId));
    const source = convCache.get(convId)!;
    const base = { conversationId: convId, nodeId: ref.nodeId };
    if (!source) {
      // El canvas de origen se borró: no se revela nada más.
      out.push({ ...base, state: "deleted" });
      continue;
    }
    if (!(await canReadSource(source, target, user, memberCache))) {
      out.push({ ...base, state: "forbidden" });
      continue;
    }
    const snapshot = await resolveCharacter(convId, ref.nodeId);
    const title = source.title || `Canvas ${convId}`;
    if (!snapshot) {
      out.push({ ...base, state: "deleted", sourceCanvasTitle: title });
      continue;
    }
    out.push({ ...base, state: "ok", sourceCanvasTitle: title, snapshot, hash: hashSnapshot(snapshot) });
  }
  return out;
}

export interface LinkableCharacter {
  nodeId: string;
  label: string;
  stageCount: number;
  thumbUrl: string | null;
}

export interface LinkableCanvas {
  conversationId: number;
  title: string;
  characters: LinkableCharacter[];
}

/** Personajes de los otros canvas del proyecto del canvas destino. */
export async function listLinkables(targetConversationId: number, user: LinkUser): Promise<LinkableCanvas[] | null> {
  const target = await loadConversation(targetConversationId);
  if (!target) return null;
  if (target.project_id == null) return [];
  if (!(await canReadProject(target.project_id, user)) && target.user_id !== user.id) return [];
  const isMember = user.isAdmin || (await isProjectMember(target.project_id, user.id));

  const [convs] = await pool.execute<ConvRow[]>(
    `SELECT id, user_id, project_id, title, generation_type FROM conversations
     WHERE project_id = ? AND generation_type = 'canvas' AND deleted_at IS NULL AND id <> ?
     ORDER BY updated_at DESC
     LIMIT 200`,
    [target.project_id, targetConversationId],
  );
  // Sin ser miembro (dueño del canvas destino nada más) solo ve sus canvas.
  const visible = convs.filter((c) => isMember || c.user_id === user.id);
  if (visible.length === 0) return [];

  const convIds = visible.map((c) => c.id);
  const [nodeRows] = await pool.execute<(NodeRow & { conversation_id: number })[]>(
    `SELECT id, conversation_id, type, label, config, status, output_url, output_text, deleted_at
     FROM canvas_nodes
     WHERE conversation_id IN (${convIds.map(() => "?").join(",")}) AND type = 'character' AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    convIds,
  );
  if (nodeRows.length === 0) return [];

  // Miniatura: la imagen de la primera etapa que tenga resultado.
  const imageIds = new Set<string>();
  const parsed = nodeRows.map((r) => {
    const node = rowToNode(r);
    const stages = (node.data as unknown as CharacterNodeData).stages ?? [];
    for (const s of stages) if (s.imageNodeId) imageIds.add(s.imageNodeId);
    return { convId: r.conversation_id, node, stages };
  });
  const outputs = new Map<string, string>();
  if (imageIds.size > 0) {
    const ids = [...imageIds];
    const [imgRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, conversation_id, output_url FROM canvas_nodes
       WHERE conversation_id IN (${convIds.map(() => "?").join(",")})
         AND id IN (${ids.map(() => "?").join(",")}) AND deleted_at IS NULL AND output_url IS NOT NULL`,
      [...convIds, ...ids],
    );
    for (const r of imgRows) outputs.set(`${r.conversation_id}|${r.id}`, r.output_url as string);
  }

  const byConv = new Map<number, LinkableCharacter[]>();
  for (const { convId, node, stages } of parsed) {
    const thumb = stages.map((s) => (s.imageNodeId ? outputs.get(`${convId}|${s.imageNodeId}`) : undefined)).find(Boolean) ?? null;
    const list = byConv.get(convId) ?? [];
    list.push({
      nodeId: node.id,
      label: String(node.data.label || "Personaje"),
      stageCount: stages.length,
      thumbUrl: thumb,
    });
    byConv.set(convId, list);
  }
  return visible
    .filter((c) => byConv.has(c.id))
    .map((c) => ({ conversationId: c.id, title: c.title || `Canvas ${c.id}`, characters: byConv.get(c.id)! }));
}
