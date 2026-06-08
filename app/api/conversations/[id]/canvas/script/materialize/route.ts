import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import pool from "@/lib/db";
import { RowDataPacket, type PoolConnection } from "mysql2/promise";
import type { ScriptAnalysis, ScriptSceneAnalysis, SceneTargetNodeType } from "@/components/canvas/lib/canvas-types";
import { HANDLE_IDS, baseHandleId } from "@/components/canvas/lib/canvas-types";

interface ConversationRow extends RowDataPacket {
  id: number;
  user_id: number;
  project_id: number;
}

interface NodeRow extends RowDataPacket {
  id: string;
  type: string;
  position_x: number;
  position_y: number;
  config: string;
}

interface EdgeRow extends RowDataPacket {
  id: string;
  source_node_id: string;
  target_node_id: string;
  source_handle: string | null;
  target_handle: string | null;
}

interface SceneTargetOverride {
  sceneIndex: number;
  targetNodeType: SceneTargetNodeType;
}

// Layout: Guión | ParamsEscena | Escenas | Targets (image/video/practicante).
// All offsets are relative to the script's X. Generous spacing so cards don't
// touch (typical card widths: guion ~360, params ~290, scene ~270, target ~280).
const PARAMS_SCENE_X_OFFSET = 460;
const SCENE_X_OFFSET = 860;
const TARGET_X_OFFSET = 1240;
const SCENE_Y_SPACING = 340;

function defaultDataForTarget(type: SceneTargetNodeType, label: string): Record<string, unknown> {
  switch (type) {
    case "image":
      return { type: "image", label, status: "idle", prompt: "", aspectRatio: "16:9", resolution: "1K", numberOfImages: 1 };
    case "video":
      return { type: "video", label, status: "idle", prompt: "", duration: 8, aspectRatio: "16:9", resolution: "720p", audioEnabled: true };
    case "text-practicante":
      return { type: "text-practicante", label, status: "idle", prompt: "", dryRun: false, outputAsPrompt: true };
    default:
      return {};
  }
}

// POST - Materialize scenes from a script node's analysis: cascade-delete previous downstream
// nodes/edges and create scene nodes (chained) + optional target nodes.
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  let conn: PoolConnection | null = null;
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;

    const [convRows] = await pool.execute<ConversationRow[]>(
      `SELECT id, user_id, project_id FROM conversations WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );
    if (convRows.length === 0) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    }

    const body = await request.json();
    const { scriptNodeId, sceneTargets, linkPreviousOutput, visualReferenceSourceId, paramsSceneSourceId } = body as {
      scriptNodeId: string;
      sceneTargets?: SceneTargetOverride[];
      linkPreviousOutput?: boolean;
      // Frontend-supplied ID of the gallery/static-image connected to the
      // script's INPUT_VISUAL_REFERENCE. We trust the frontend over the DB read
      // because autosave is debounced — the edge may not be persisted yet.
      visualReferenceSourceId?: string | null;
      // Frontend-supplied ID of a custom Params Escena connected to the
      // script's INPUT_PARAMS_SCENE_REF. When present, that node is wired to
      // all scenes (preserving the user's gallery/content) instead of
      // auto-creating params-scene-${scriptNodeId}.
      paramsSceneSourceId?: string | null;
    };

    if (!scriptNodeId) {
      return NextResponse.json({ error: "scriptNodeId requerido" }, { status: 400 });
    }

    // Cargar el nodo Guión
    const [scriptRows] = await pool.execute<NodeRow[]>(
      `SELECT id, type, position_x, position_y, config FROM canvas_nodes WHERE id = ? AND conversation_id = ?`,
      [scriptNodeId, id]
    );
    if (scriptRows.length === 0) {
      return NextResponse.json({ error: "Nodo Guión no encontrado" }, { status: 404 });
    }
    if (scriptRows[0].type !== "script") {
      return NextResponse.json({ error: "El nodo no es de tipo Guión" }, { status: 400 });
    }

    let scriptConfig: Record<string, unknown> = {};
    try {
      const raw = scriptRows[0].config;
      scriptConfig = JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw)) as Record<string, unknown>;
    } catch {}

    const analysis = scriptConfig.scriptAnalysis as ScriptAnalysis | undefined;
    if (!analysis || !Array.isArray(analysis.scenes) || analysis.scenes.length === 0) {
      return NextResponse.json({ error: "El Guión no tiene escenas analizadas. Ejecuta 'Leer guión' primero." }, { status: 400 });
    }

    // Aplicar overrides de targetNodeType (lo que el usuario eligió en cada caja)
    const overrideMap = new Map<number, SceneTargetNodeType>();
    if (Array.isArray(sceneTargets)) {
      for (const o of sceneTargets) {
        if (typeof o.sceneIndex === "number") overrideMap.set(o.sceneIndex, o.targetNodeType);
      }
    }
    const scenes: ScriptSceneAnalysis[] = analysis.scenes.map((s) => ({
      ...s,
      targetNodeType: overrideMap.get(s.index) ?? s.targetNodeType ?? "image",
    }));

    const scriptX = scriptRows[0].position_x;
    const scriptY = scriptRows[0].position_y;

    // BFS aguas abajo desde scriptNodeId — cascada completa
    const [allEdges] = await pool.execute<EdgeRow[]>(
      `SELECT id, source_node_id, target_node_id, source_handle, target_handle FROM canvas_edges WHERE conversation_id = ?`,
      [id]
    );
    const downstream = new Set<string>();
    const queue: string[] = [scriptNodeId];
    const visited = new Set<string>([scriptNodeId]);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const e of allEdges) {
        if (e.source_node_id === current && !visited.has(e.target_node_id)) {
          visited.add(e.target_node_id);
          downstream.add(e.target_node_id);
          queue.push(e.target_node_id);
        }
      }
    }

    // Construir IDs nuevos
    const sceneIdFor = (idx: number) => `scene-${scriptNodeId}-${idx}`;
    const targetIdFor = (idx: number) => `dst-${scriptNodeId}-${idx}`;
    const chainEdgeId = (idx: number) => `edge-chain-${scriptNodeId}-${idx}`;
    const targetEdgeId = (idx: number) => `edge-target-${scriptNodeId}-${idx}`;

    // Params Escena resolution: if the user wired their own Params Escena to
    // the script's INPUT_PARAMS_SCENE_REF, use THAT node id. Otherwise fall
    // back to the determinístic id (auto-create / reuse).
    const paramsSceneId = paramsSceneSourceId || `params-scene-${scriptNodeId}`;
    const usingCustomParamsScene = !!paramsSceneSourceId;
    const paramsSceneEdgeId = (idx: number) => `edge-params-scene-${scriptNodeId}-${idx}`;

    // Reuse existing params-scene (auto or custom). Custom is assumed to
    // exist since the user wired it; the auto one we check explicitly to
    // decide whether to create it fresh or reuse the prior content.
    let paramsSceneExists = usingCustomParamsScene;
    if (!usingCustomParamsScene) {
      const [existingParamsRows] = await pool.execute<NodeRow[]>(
        `SELECT id, type, position_x, position_y, config FROM canvas_nodes WHERE id = ? AND conversation_id = ?`,
        [paramsSceneId, id]
      );
      paramsSceneExists = existingParamsRows.length > 0;
    }

    const totalScenes = scenes.length;
    const generalInfo = analysis.generalInfo;

    const addedNodes: Array<{
      id: string;
      type: string;
      position: { x: number; y: number };
      data: Record<string, unknown>;
    }> = [];
    const addedEdges: Array<{
      id: string;
      source: string;
      sourceHandle: string;
      target: string;
      targetHandle: string;
    }> = [];

    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const sceneId = sceneIdFor(scene.index);
      const sceneX = scriptX + SCENE_X_OFFSET;
      const sceneY = scriptY + i * SCENE_Y_SPACING;

      addedNodes.push({
        id: sceneId,
        type: "scene",
        position: { x: sceneX, y: sceneY },
        data: {
          type: "scene",
          label: `Escena ${scene.index}`,
          status: "completed",
          sceneIndex: scene.index,
          totalScenes,
          text: scene.text,
          scriptNodeId,
          generalInfo,
          targetNodeType: scene.targetNodeType,
        },
      });

      // Encadenar Guion → Esc1 y Esc_i → Esc_{i+1}
      const sourceForChain = i === 0 ? scriptNodeId : sceneIdFor(scenes[i - 1].index);
      addedEdges.push({
        id: chainEdgeId(scene.index),
        source: sourceForChain,
        sourceHandle: HANDLE_IDS.OUTPUT_SCRIPT_CHAIN,
        target: sceneId,
        targetHandle: HANDLE_IDS.INPUT_SCRIPT_CHAIN,
      });

      // Crear nodo destino si corresponde
      if (scene.targetNodeType && scene.targetNodeType !== "none") {
        const targetId = targetIdFor(scene.index);
        const targetLabel =
          scene.targetNodeType === "image" ? `Imagen ${scene.index}` :
          scene.targetNodeType === "video" ? `Video ${scene.index}` :
          `Practicante ${scene.index}`;

        addedNodes.push({
          id: targetId,
          type: scene.targetNodeType,
          position: { x: scriptX + TARGET_X_OFFSET, y: sceneY },
          data: defaultDataForTarget(scene.targetNodeType, targetLabel),
        });

        addedEdges.push({
          id: targetEdgeId(scene.index),
          source: sceneId,
          sourceHandle: HANDLE_IDS.OUTPUT_TEXT,
          target: targetId,
          targetHandle: HANDLE_IDS.INPUT_PROMPT,
        });
      }
    }

    // Crear el Params Escena compartido (uno solo, conectado a TODAS las escenas).
    // Si ya existe en DB, lo reusamos (no se sobrescribe el content que el usuario haya tipeado).
    if (!paramsSceneExists) {
      addedNodes.push({
        id: paramsSceneId,
        type: "params-scene",
        position: { x: scriptX + PARAMS_SCENE_X_OFFSET, y: scriptY },
        data: {
          type: "params-scene",
          label: "Params Escena",
          status: "completed",
          content: "",
        },
      });
    }
    // Conectar params-scene → cada escena (siempre, exista o no el nodo).
    for (const scene of scenes) {
      addedEdges.push({
        id: paramsSceneEdgeId(scene.index),
        source: paramsSceneId,
        sourceHandle: HANDLE_IDS.OUTPUT_PARAMS,
        target: sceneIdFor(scene.index),
        targetHandle: HANDLE_IDS.INPUT_SCENE_PARAMS,
      });
    }

    // Visual reference: if there's a gallery (or static image) connected to
    // the Script's INPUT_VISUAL_REFERENCE, wire it to the FIRST scene's
    // destination so the first image/video has visual context (it has no
    // previous output to reference yet).
    //
    // We prefer the frontend-supplied ID (visualReferenceSourceId) because the
    // user may have just connected the gallery and the autosave PUT hasn't
    // fired yet — DB would show no edge. Fallback to scanning DB for legacy
    // calls or when the frontend doesn't supply the field.
    let visualRefSource: string | null = visualReferenceSourceId || null;
    if (!visualRefSource) {
      const visualRefEdge = allEdges.find(
        (e) => e.target_node_id === scriptNodeId && baseHandleId(e.target_handle) === HANDLE_IDS.INPUT_VISUAL_REFERENCE
      );
      if (visualRefEdge) visualRefSource = visualRefEdge.source_node_id;
    }
    if (visualRefSource && scenes.length > 0) {
      const firstScene = scenes[0];
      if (firstScene.targetNodeType && firstScene.targetNodeType !== "none") {
        const firstTargetId = targetIdFor(firstScene.index);
        let targetHandle: string | null = null;
        if (firstScene.targetNodeType === "image") targetHandle = HANDLE_IDS.INPUT_REFERENCE;
        else if (firstScene.targetNodeType === "video") targetHandle = HANDLE_IDS.INPUT_FIRST_FRAME;
        else if (firstScene.targetNodeType === "text-practicante") targetHandle = HANDLE_IDS.INPUT_MEDIA;
        if (targetHandle) {
          addedEdges.push({
            id: `edge-visual-ref-${scriptNodeId}`,
            source: visualRefSource,
            sourceHandle: HANDLE_IDS.OUTPUT_IMAGE,
            target: firstTargetId,
            targetHandle,
          });
        }
      }
    }

    // Auto-link: connect output of destination N to input of destination N+1
    // for visual continuity. Only applies for compatible type pairs based on
    // existing connection rules.
    if (linkPreviousOutput) {
      for (let i = 1; i < scenes.length; i++) {
        const prev = scenes[i - 1];
        const curr = scenes[i];
        if (!prev.targetNodeType || prev.targetNodeType === "none") continue;
        if (!curr.targetNodeType || curr.targetNodeType === "none") continue;

        let sourceHandle: string | null = null;
        let targetHandle: string | null = null;

        if (prev.targetNodeType === "image" && curr.targetNodeType === "image") {
          sourceHandle = HANDLE_IDS.OUTPUT_IMAGE;
          targetHandle = HANDLE_IDS.INPUT_REFERENCE;
        } else if (prev.targetNodeType === "image" && curr.targetNodeType === "video") {
          sourceHandle = HANDLE_IDS.OUTPUT_IMAGE;
          targetHandle = HANDLE_IDS.INPUT_FIRST_FRAME;
        } else if (
          (prev.targetNodeType === "image" || prev.targetNodeType === "video") &&
          curr.targetNodeType === "text-practicante"
        ) {
          sourceHandle =
            prev.targetNodeType === "image" ? HANDLE_IDS.OUTPUT_IMAGE : HANDLE_IDS.OUTPUT_VIDEO;
          targetHandle = HANDLE_IDS.INPUT_MEDIA;
        }
        // Other combos (video→image, video→video, etc.) have no natural link.

        if (sourceHandle && targetHandle) {
          addedEdges.push({
            id: `edge-link-${scriptNodeId}-${curr.index}`,
            source: targetIdFor(prev.index),
            sourceHandle,
            target: targetIdFor(curr.index),
            targetHandle,
          });
        }
      }
    }

    // Transacción: borrar cascada + insertar nuevos
    conn = await pool.getConnection();
    await conn.beginTransaction();

    const downstreamIds = Array.from(downstream);
    const deletedEdgeIds: string[] = [];

    if (downstreamIds.length > 0) {
      const placeholders = downstreamIds.map(() => "?").join(",");
      // Capturar edges que serán borradas (las que tocan algún nodo aguas abajo o salen del script)
      const [edgesToDelete] = await conn.execute<EdgeRow[]>(
        `SELECT id FROM canvas_edges
         WHERE conversation_id = ?
           AND (source_node_id IN (${placeholders}) OR target_node_id IN (${placeholders}) OR source_node_id = ?)`,
        [id, ...downstreamIds, ...downstreamIds, scriptNodeId]
      );
      for (const e of edgesToDelete) deletedEdgeIds.push(e.id);

      await conn.execute(
        `DELETE FROM canvas_edges
         WHERE conversation_id = ?
           AND (source_node_id IN (${placeholders}) OR target_node_id IN (${placeholders}) OR source_node_id = ?)`,
        [id, ...downstreamIds, ...downstreamIds, scriptNodeId]
      );

      await conn.execute(
        `DELETE FROM canvas_nodes WHERE conversation_id = ? AND id IN (${placeholders})`,
        [id, ...downstreamIds]
      );
    } else {
      // No hay aguas abajo, pero el script puede tener edges colgantes (sin destino)
      const [scriptEdges] = await conn.execute<EdgeRow[]>(
        `SELECT id FROM canvas_edges WHERE conversation_id = ? AND source_node_id = ?`,
        [id, scriptNodeId]
      );
      for (const e of scriptEdges) deletedEdgeIds.push(e.id);
      await conn.execute(
        `DELETE FROM canvas_edges WHERE conversation_id = ? AND source_node_id = ?`,
        [id, scriptNodeId]
      );
    }

    // Defense against orphan rows that share the deterministic IDs we're about
    // to insert. The cascade BFS misses them when the chain was broken upstream
    // (e.g. user manually deleted a scene without proper edge cleanup).
    const newNodeIds = addedNodes.map((n) => n.id);
    if (newNodeIds.length > 0) {
      const ph = newNodeIds.map(() => "?").join(",");
      await conn.execute(
        `DELETE FROM canvas_nodes WHERE conversation_id = ? AND id IN (${ph})`,
        [id, ...newNodeIds]
      );
    }
    const newEdgeIds = addedEdges.map((e) => e.id);
    if (newEdgeIds.length > 0) {
      const ph = newEdgeIds.map(() => "?").join(",");
      await conn.execute(
        `DELETE FROM canvas_edges WHERE conversation_id = ? AND id IN (${ph})`,
        [id, ...newEdgeIds]
      );
    }
    // Also wipe any orphan edges that touch the deterministic node IDs we'll
    // recreate (covers edges with target in addedNodes but ID we didn't predict).
    if (newNodeIds.length > 0) {
      const ph = newNodeIds.map(() => "?").join(",");
      await conn.execute(
        `DELETE FROM canvas_edges
         WHERE conversation_id = ?
           AND (source_node_id IN (${ph}) OR target_node_id IN (${ph}))`,
        [id, ...newNodeIds, ...newNodeIds]
      );
    }

    // Insertar nuevos nodos
    for (const node of addedNodes) {
      const { label, status, ...configData } = node.data;
      await conn.execute(
        `INSERT INTO canvas_nodes (id, conversation_id, type, label, position_x, position_y, config, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          node.id,
          id,
          node.type,
          (label as string) || "",
          node.position.x,
          node.position.y,
          JSON.stringify(configData),
          (status as string) || "idle",
        ]
      );
    }

    // Insertar nuevas edges
    for (const edge of addedEdges) {
      await conn.execute(
        `INSERT INTO canvas_edges (id, conversation_id, source_node_id, source_handle, target_node_id, target_handle)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [edge.id, id, edge.source, edge.sourceHandle, edge.target, edge.targetHandle]
      );
    }

    await conn.commit();

    return NextResponse.json({
      deletedNodeIds: downstreamIds,
      deletedEdgeIds,
      addedNodes,
      addedEdges,
    });
  } catch (error) {
    if (conn) await conn.rollback().catch(() => {});
    console.error("Error materializing scenes:", error);
    const msg = error instanceof Error ? error.message : "Error interno del servidor";
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    if (conn) conn.release();
  }
}

// GET - Preview which nodes will be deleted in cascade (for the confirmation modal)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 });
    }

    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const scriptNodeId = searchParams.get("scriptNodeId");
    if (!scriptNodeId) {
      return NextResponse.json({ error: "scriptNodeId requerido" }, { status: 400 });
    }

    const [convRows] = await pool.execute<ConversationRow[]>(
      `SELECT id FROM conversations WHERE id = ? AND deleted_at IS NULL`,
      [id]
    );
    if (convRows.length === 0) {
      return NextResponse.json({ error: "Conversación no encontrada" }, { status: 404 });
    }

    const [allEdges] = await pool.execute<EdgeRow[]>(
      `SELECT id, source_node_id, target_node_id FROM canvas_edges WHERE conversation_id = ?`,
      [id]
    );
    const downstream = new Set<string>();
    const queue: string[] = [scriptNodeId];
    const visited = new Set<string>([scriptNodeId]);
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const e of allEdges) {
        if (e.source_node_id === current && !visited.has(e.target_node_id)) {
          visited.add(e.target_node_id);
          downstream.add(e.target_node_id);
          queue.push(e.target_node_id);
        }
      }
    }

    const downstreamIds = Array.from(downstream);
    if (downstreamIds.length === 0) {
      return NextResponse.json({ nodes: [] });
    }
    const placeholders = downstreamIds.map(() => "?").join(",");
    const [nodes] = await pool.execute<NodeRow[]>(
      `SELECT id, type FROM canvas_nodes WHERE conversation_id = ? AND id IN (${placeholders})`,
      [id, ...downstreamIds]
    );
    return NextResponse.json({ nodes });
  } catch (error) {
    console.error("Error previewing cascade:", error);
    return NextResponse.json({ error: "Error interno del servidor" }, { status: 500 });
  }
}
