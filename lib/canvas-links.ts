// Nodos vinculados entre canvas (servidor): control de acceso, vista resuelta
// de un Personaje de otro canvas y listado de lo que se puede vincular.
//
// Regla de acceso: el canvas de origen debe ser del MISMO proyecto que el
// canvas destino (proyecto no nulo) y el usuario debe ser admin, dueño del
// canvas de origen o miembro del proyecto.

import { createHash } from "crypto";
import type { RowDataPacket } from "mysql2";
import pool from "@/lib/db";
import { HANDLE_IDS, baseHandleId, type CharacterNodeData, type LinkState, type LinkedSnapshot, type LinkUsage, type LinkUsageCanvas, type SceneNodeData } from "@/components/canvas/lib/canvas-types";
import { buildCharacterSnapshot } from "@/components/canvas/lib/linked";
import { collectSceneContext } from "@/components/canvas/lib/scene-context";
import { galleryOutput, lookupFrom, nodeTextOutput, type NodeLookup, type OutEdge } from "@/components/canvas/lib/node-outputs";

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

type NodeLike = { id: string; type?: string; data: Record<string, unknown> };

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

interface SourceCanvas {
  nodes: NodeLike[];
  edges: OutEdge[];
  lookup: NodeLookup;
}

/**
 * Canvas de origen completo (nodos y conexiones vivos). Se carga una vez por
 * llamada y la vista se arma con las mismas funciones puras que usa el
 * cliente (textos concatenados, galerías con imágenes conectadas, cadena de
 * escenas), así lo vinculado entrega exactamente lo mismo que el original.
 */
async function loadSourceCanvas(conversationId: number): Promise<SourceCanvas> {
  const [nodeRows] = await pool.execute<NodeRow[]>(
    `SELECT id, type, label, config, status, output_url, output_text, deleted_at
     FROM canvas_nodes WHERE conversation_id = ? AND deleted_at IS NULL`,
    [conversationId],
  );
  const [edgeRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, source_node_id, source_handle, target_node_id, target_handle FROM canvas_edges
     WHERE conversation_id = ? AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    [conversationId],
  );
  const nodes = nodeRows.map(rowToNode);
  const edges: OutEdge[] = edgeRows.map((e) => ({
    id: e.id as string,
    source: e.source_node_id as string,
    sourceHandle: (e.source_handle as string | null) ?? null,
    target: e.target_node_id as string,
    targetHandle: (e.target_handle as string | null) ?? null,
  }));
  return { nodes, edges, lookup: lookupFrom(nodes) };
}

/** Vista resuelta de un nodo (Personaje o Escena). null si no existe o no se puede vincular. */
function resolveNode(canvas: SourceCanvas, nodeId: string): LinkedSnapshot | null {
  const node = canvas.lookup(nodeId);
  if (node?.type === "character") return resolveCharacter(canvas, node);
  if (node?.type === "scene") return resolveScene(canvas, node);
  if (node?.type === "image" || node?.type === "static-image") return resolveImage(node);
  return null;
}

/** Vista de una imagen generada (o estática): su URL actual. */
function resolveImage(node: NodeLike): LinkedSnapshot {
  const d = node.data;
  const url = node.type === "image" ? (d.status === "completed" ? d.outputUrl : null) : d.imageUrl;
  return {
    kind: "image",
    label: String(d.label || (node.type === "image" ? "Imagen" : "Imagen estática")),
    imageUrl: typeof url === "string" && url ? url : null,
    prompt: typeof d.prompt === "string" ? d.prompt : "",
  };
}

/** Vista de una Escena: su texto y los ingredientes del contexto de guion. */
function resolveScene(canvas: SourceCanvas, scene: NodeLike): LinkedSnapshot | null {
  const sceneData = scene.data as unknown as SceneNodeData;
  const context = collectSceneContext(scene.id, canvas.nodes, canvas.edges as never);
  if (!context) return null;
  const script = sceneData.scriptNodeId ? canvas.lookup(sceneData.scriptNodeId) : undefined;
  return {
    kind: "scene",
    label: String(scene.data.label || `Escena ${sceneData.sceneIndex}`),
    scriptLabel: String(script?.data.label || "Guión"),
    text: sceneData.text ?? "",
    context,
  };
}

/** Vista resuelta de un Personaje. */
function resolveCharacter(canvas: SourceCanvas, character: NodeLike): LinkedSnapshot {
  const into = canvas.edges.filter((e) => e.target === character.id);
  const styleEdge = into.find((e) => baseHandleId(e.targetHandle) === HANDLE_IDS.INPUT_CHARACTER_STYLE);
  const galleries = into
    .filter((e) => baseHandleId(e.targetHandle) === HANDLE_IDS.INPUT_CHARACTER_GALLERY)
    .map((e) => canvas.lookup(e.source))
    .filter((n): n is NodeLike => !!n);
  const stageImages = ((character.data as unknown as CharacterNodeData).stages ?? [])
    .map((s) => (s.imageNodeId ? canvas.lookup(s.imageNodeId) : undefined))
    .filter((n): n is NodeLike => !!n);
  return buildCharacterSnapshot({
    character,
    styleText: styleEdge ? nodeTextOutput(canvas.lookup(styleEdge.source), canvas.lookup, canvas.edges, styleEdge) : "",
    galleries,
    galleryImages: (g) => galleryOutput(g, canvas.lookup, canvas.edges),
    stageImages,
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
  const canvasCache = new Map<number, SourceCanvas>();
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
    if (!canvasCache.has(convId)) canvasCache.set(convId, await loadSourceCanvas(convId));
    const snapshot = resolveNode(canvasCache.get(convId)!, ref.nodeId);
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

export interface LinkableScene {
  nodeId: string;
  label: string;
  sceneIndex: number;
  totalScenes: number;
  scriptLabel: string;
  excerpt: string;
}

export interface LinkableImage {
  nodeId: string;
  label: string;
  thumbUrl: string;
}

export interface LinkableCanvas {
  conversationId: number;
  title: string;
  characters: LinkableCharacter[];
  scenes: LinkableScene[];
  images: LinkableImage[];
}

/** Personajes y Escenas de los otros canvas del proyecto del canvas destino. */
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
  const inConvs = convIds.map(() => "?").join(",");
  const [nodeRows] = await pool.execute<(NodeRow & { conversation_id: number })[]>(
    `SELECT id, conversation_id, type, label, config, status, output_url, output_text, deleted_at
     FROM canvas_nodes
     WHERE conversation_id IN (${inConvs}) AND type IN ('character', 'scene', 'script', 'image', 'static-image') AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    convIds,
  );
  if (nodeRows.length === 0) return [];

  // Miniatura del Personaje: la imagen de la primera etapa que tenga resultado.
  const imageIds = new Set<string>();
  const scriptLabels = new Map<string, string>();
  const parsed = nodeRows.map((r) => {
    const node = rowToNode(r);
    if (node.type === "character") {
      for (const s of (node.data as unknown as CharacterNodeData).stages ?? []) if (s.imageNodeId) imageIds.add(s.imageNodeId);
    }
    if (node.type === "script") scriptLabels.set(`${r.conversation_id}|${node.id}`, String(node.data.label || "Guión"));
    return { convId: r.conversation_id, node };
  });
  const outputs = new Map<string, string>();
  if (imageIds.size > 0) {
    const ids = [...imageIds];
    const [imgRows] = await pool.execute<RowDataPacket[]>(
      `SELECT id, conversation_id, output_url FROM canvas_nodes
       WHERE conversation_id IN (${inConvs})
         AND id IN (${ids.map(() => "?").join(",")}) AND deleted_at IS NULL AND output_url IS NOT NULL`,
      [...convIds, ...ids],
    );
    for (const r of imgRows) outputs.set(`${r.conversation_id}|${r.id}`, r.output_url as string);
  }

  const byConv = new Map<number, { characters: LinkableCharacter[]; scenes: LinkableScene[]; images: LinkableImage[] }>();
  const bucket = (convId: number) => {
    const b = byConv.get(convId) ?? { characters: [], scenes: [], images: [] };
    byConv.set(convId, b);
    return b;
  };
  // Imágenes de las etapas de un Personaje: ya se vinculan con el Personaje.
  const stageImageKeys = new Set(
    parsed.flatMap(({ convId, node }) =>
      node.type === "character"
        ? ((node.data as unknown as CharacterNodeData).stages ?? []).filter((s) => s.imageNodeId).map((s) => `${convId}|${s.imageNodeId}`)
        : [],
    ),
  );
  for (const { convId, node } of parsed) {
    if (node.type === "image" || node.type === "static-image") {
      // Solo las que tienen imagen (generada o subida).
      const snap = resolveImage(node) as { imageUrl: string | null; label: string };
      if (!snap.imageUrl || stageImageKeys.has(`${convId}|${node.id}`)) continue;
      bucket(convId).images.push({ nodeId: node.id, label: snap.label, thumbUrl: snap.imageUrl });
      continue;
    }
    if (node.type === "character") {
      const stages = (node.data as unknown as CharacterNodeData).stages ?? [];
      const thumb = stages.map((s) => (s.imageNodeId ? outputs.get(`${convId}|${s.imageNodeId}`) : undefined)).find(Boolean) ?? null;
      bucket(convId).characters.push({
        nodeId: node.id,
        label: String(node.data.label || "Personaje"),
        stageCount: stages.length,
        thumbUrl: thumb,
      });
    } else if (node.type === "scene") {
      const sd = node.data as unknown as SceneNodeData;
      const text = (sd.text ?? "").replace(/\s+/g, " ").trim();
      bucket(convId).scenes.push({
        nodeId: node.id,
        label: String(node.data.label || `Escena ${sd.sceneIndex}`),
        sceneIndex: sd.sceneIndex,
        totalScenes: sd.totalScenes,
        scriptLabel: (sd.scriptNodeId && scriptLabels.get(`${convId}|${sd.scriptNodeId}`)) || "Guión",
        excerpt: text.length > 90 ? `${text.slice(0, 90)}…` : text,
      });
    }
  }
  for (const b of byConv.values()) {
    b.scenes.sort((a, z) => a.scriptLabel.localeCompare(z.scriptLabel) || a.sceneIndex - z.sceneIndex);
  }
  return visible
    .filter((c) => {
      const b = byConv.get(c.id);
      return !!b && (b.characters.length > 0 || b.scenes.length > 0 || b.images.length > 0);
    })
    .map((c) => ({ conversationId: c.id, title: c.title || `Canvas ${c.id}`, ...byConv.get(c.id)! }));
}


/**
 * Uso de los nodos de un canvas como vinculados en OTROS canvas del mismo
 * proyecto. Mismo acceso que leer el canvas de origen (admin, dueño o miembro
 * del proyecto); sin ser miembro solo se ven los canvas propios.
 */
export async function listLinkUsage(sourceConversationId: number, user: LinkUser): Promise<LinkUsage | null> {
  const source = await loadConversation(sourceConversationId);
  if (!source) return null;
  if (source.project_id == null) return {};
  const isMember = user.isAdmin || (await isProjectMember(source.project_id, user.id));
  if (!isMember && source.user_id !== user.id) return {};

  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT n.id, n.conversation_id, c.title, c.user_id,
            JSON_UNQUOTE(JSON_EXTRACT(n.config, '$.sourceNodeId')) AS source_node_id,
            JSON_EXTRACT(n.config, '$.imageOutputs') AS image_outputs
     FROM canvas_nodes n
     JOIN conversations c ON c.id = n.conversation_id
     WHERE c.project_id = ? AND c.deleted_at IS NULL AND c.id <> ?
       AND n.type = 'linked' AND n.deleted_at IS NULL
       AND JSON_EXTRACT(n.config, '$.sourceConversationId') = ?`,
    [source.project_id, sourceConversationId, sourceConversationId],
  );
  const visible = rows.filter((r) => isMember || r.user_id === user.id);
  if (visible.length === 0) return {};

  const convIds = [...new Set(visible.map((r) => r.conversation_id as number))];
  const linkedIds = visible.map((r) => r.id as string);
  const [edgeRows] = await pool.execute<RowDataPacket[]>(
    `SELECT id, conversation_id, source_node_id FROM canvas_edges
     WHERE deleted_at IS NULL
       AND conversation_id IN (${convIds.map(() => "?").join(",")})
       AND source_node_id IN (${linkedIds.map(() => "?").join(",")})`,
    [...convIds, ...linkedIds],
  );
  const edgesOf = new Map<string, string[]>();
  for (const e of edgeRows) {
    const key = `${e.conversation_id}|${e.source_node_id}`;
    edgesOf.set(key, [...(edgesOf.get(key) ?? []), e.id as string]);
  }

  const usage: LinkUsage = {};
  for (const r of visible) {
    const sourceNodeId = r.source_node_id as string | null;
    if (!sourceNodeId) continue;
    const convId = r.conversation_id as number;
    const raw = r.image_outputs;
    const outputs: Record<string, string> = (typeof raw === "string" ? JSON.parse(raw || "null") : raw) ?? {};
    const edgeIds = edgesOf.get(`${convId}|${r.id}`) ?? [];
    const list = (usage[sourceNodeId] ??= []);
    let entry = list.find((u) => u.conversationId === convId);
    if (!entry) {
      entry = { conversationId: convId, title: (r.title as string) || `Canvas ${convId}`, linkedNodeIds: [], connections: 0, stageUses: {} };
      list.push(entry);
    }
    entry.linkedNodeIds.push(r.id as string);
    entry.connections += edgeIds.length;
    for (const edgeId of edgeIds) {
      const stageId = outputs[edgeId];
      if (stageId) entry.stageUses[stageId] = (entry.stageUses[stageId] ?? 0) + 1;
    }
  }
  for (const list of Object.values(usage)) list.sort((a, b) => a.title.localeCompare(b.title));
  return usage;
}
