"use client";

import { memo, useCallback } from "react";
import { Handle, Position, useNodesData, type NodeProps } from "@xyflow/react";
import { Film, ImageIcon, Video, Bot } from "lucide-react";
import { HANDLE_IDS, topHandleId, type SceneNodeData, type ScriptNodeData } from "../lib/canvas-types";
import { managedSceneId, sceneEditToScript } from "../lib/script-materialize";
import { useNodeUpdate } from "../hooks/use-node-update";
import { NodeTextarea } from "./node-textarea";
import { NodeDeleteButton } from "./node-status";
import { ResizeHandle, nodeSizeClass, useHasFixedSize } from "./resize-handle";
import { LinkUsageRow } from "./link-usage";

const targetIconMap = {
  image: ImageIcon,
  video: Video,
  "text-practicante": Bot,
  none: null,
} as const;

const targetLabelMap: Record<string, string> = {
  image: "Imagen",
  video: "Video",
  "text-practicante": "Practicante",
  none: "—",
};

export const SceneNodeComponent = memo(function SceneNode({ id, data, selected }: NodeProps) {
  const hasFixedSize = useHasFixedSize(id);
  const nodeData = data as unknown as SceneNodeData;
  const targetType = nodeData.targetNodeType || "none";
  const TargetIcon = targetIconMap[targetType];
  const { updateNodeData } = useNodeUpdate();

  // El texto se edita acá y se escribe también en el Guión (su escena o su
  // versión B), así no hay que subir al Guión y volver a "Generar escenas".
  // Si el Guión cambió desde que se generó esta escena, no se edita (se
  // pisaría otra escena): primero hay que volver a "Generar escenas". Una
  // escena suelta (copiada, de plantilla o sin Guión) se edita solo acá.
  const scriptId = nodeData.scriptNodeId;
  const script = useNodesData(scriptId ?? "");
  const managedScript =
    script?.type === "script" && id === managedSceneId(scriptId, nodeData.sceneIndex, nodeData.variant)
      ? (script.data as unknown as ScriptNodeData)
      : null;
  const sceneRef = { id, sceneIndex: nodeData.sceneIndex, variant: nodeData.variant, text: nodeData.text || "" };
  const inSync = !managedScript || sceneEditToScript(scriptId, managedScript, sceneRef, sceneRef.text) !== null;

  const handleTextChange = useCallback(
    (text: string) => {
      if (managedScript) {
        const updates = sceneEditToScript(scriptId, managedScript, { id, sceneIndex: nodeData.sceneIndex, variant: nodeData.variant, text: nodeData.text || "" }, text);
        if (!updates) return;
        updateNodeData(scriptId, updates);
      }
      updateNodeData(id, { text });
    },
    [id, nodeData.sceneIndex, nodeData.variant, nodeData.text, managedScript, scriptId, updateNodeData],
  );

  return (
    <div
      className={`group bg-card rounded-xl border-2 border-violet-500/40 ${
        selected ? "ring-2 ring-violet-500/50" : ""
      } transition-all ${nodeSizeClass(hasFixedSize, "min-w-[240px] max-w-[300px]")}`}
    >
      {/* Input handle: chain from script or previous scene */}
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.INPUT_SCRIPT_CHAIN}
        className="!w-3 !h-3 !bg-violet-500 !border-2 !border-background"
        style={{ top: "30%" }}
        title="Cadena del guion"
      />

      {/* Input handle: scene params (estilo, técnica, visual) */}
      <Handle
        type="target"
        position={Position.Left}
        id={HANDLE_IDS.INPUT_SCENE_PARAMS}
        className="!w-3 !h-3 !border-2 !border-background"
        style={{ top: "85%", backgroundColor: "#fc0" }}
        title="Params Escena (estilo)"
      />

      {/* Input handles (top twins — same logical inputs, reachable from above) */}
      <Handle
        type="target"
        position={Position.Top}
        id={topHandleId(HANDLE_IDS.INPUT_SCRIPT_CHAIN)}
        className="!w-3 !h-3 !bg-violet-500 !border-2 !border-background"
        style={{ left: "30%" }}
        title="Cadena del guion"
      />
      <Handle
        type="target"
        position={Position.Top}
        id={topHandleId(HANDLE_IDS.INPUT_SCENE_PARAMS)}
        className="!w-3 !h-3 !border-2 !border-background"
        style={{ left: "70%", backgroundColor: "#fc0" }}
        title="Params Escena (estilo)"
      />

      {/* Header */}
      <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50">
        <Film className="h-[18px] w-[18px] text-violet-400 shrink-0" />
        <span className="text-[15px] font-medium flex-1 truncate">
          Escena {nodeData.sceneIndex}{nodeData.variant ?? ""}
          <span className="text-muted-foreground">/{nodeData.totalScenes}</span>
        </span>
        {TargetIcon && (
          <span
            className="inline-flex items-center gap-0.5 text-[12px] font-semibold px-1 py-0.5 rounded bg-violet-500/10 text-violet-400 shrink-0"
            title={`Conectado a: ${targetLabelMap[targetType]}`}
          >
            <TargetIcon className="h-2.5 w-2.5" />
            {targetLabelMap[targetType]}
          </span>
        )}
        <NodeDeleteButton nodeId={id} />
      </div>

      {/* Body: texto de la escena, editable (se sincroniza con el Guión) */}
      <div className="px-3 py-2">
        <div className="mb-1.5 empty:hidden">
          <LinkUsageRow nodeId={id} kind="scene" />
        </div>
        <NodeTextarea
          value={nodeData.text || ""}
          onChange={handleTextChange}
          readOnly={!inSync}
          placeholder="Texto de la escena..."
          title={inSync ? "Se actualiza también en el Guión" : undefined}
          className="w-full text-[15px] bg-muted/40 rounded-md p-2 outline-none border border-transparent focus:border-violet-500/40 resize-none min-h-[80px] h-[180px] whitespace-pre-wrap placeholder:text-muted-foreground"
        />
        {!inSync && (
          <p className="mt-1 text-[12px] text-amber-500">
            El Guión cambió: usa &quot;Generar escenas&quot; para poder editar esta escena aquí.
          </p>
        )}
      </div>

      {/* Output to next scene (chain) */}
      <Handle
        type="source"
        position={Position.Left}
        id={HANDLE_IDS.OUTPUT_SCRIPT_CHAIN}
        className="!w-3 !h-3 !bg-violet-500 !border-2 !border-background"
        style={{ top: "70%" }}
        title="Hacia escena siguiente"
      />

      {/* Output as prompt to image/video/practicante */}
      <Handle
        type="source"
        position={Position.Right}
        id={HANDLE_IDS.OUTPUT_TEXT}
        className="!w-3 !h-3 !bg-blue-500 !border-2 !border-background"
        title="Texto de la escena (prompt)"
      />

      <ResizeHandle minWidth={220} minHeight={140} />
    </div>
  );
});
