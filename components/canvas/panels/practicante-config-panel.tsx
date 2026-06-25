"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Play, Trash2, Bot, Loader2, Lock, Unlock, FlaskConical, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Node } from "@xyflow/react";
import type { CanvasNodeData, TextPracticanteNodeData } from "../lib/canvas-types";
import { useCanvasContext } from "../canvas-context";

interface PracticanteAgent {
  id: string;
  name: string;
  description?: string;
}

interface PracticanteConfigPanelProps {
  node: Node;
  edges: Array<{ source: string; target: string; targetHandle?: string | null }>;
  onUpdateData: (nodeId: string, updates: Partial<CanvasNodeData>) => void;
  onDelete: (nodeId: string) => void;
  onExecute: (nodeId: string) => void;
  isExecuting: boolean;
  onClose: () => void;
}

export function PracticanteConfigPanel({
  node,
  edges,
  onUpdateData,
  onDelete,
  onExecute,
  isExecuting,
  onClose,
}: PracticanteConfigPanelProps) {
  const { canEdit } = useCanvasContext();
  const data = node.data as unknown as TextPracticanteNodeData;
  const isGenerating = data.status === "generating";
  const isLocked = data.locked === true;

  const [agents, setAgents] = useState<PracticanteAgent[]>([]);
  const [loadingAgents, setLoadingAgents] = useState(false);
  const [agentsError, setAgentsError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingAgents(true);
    setAgentsError(null);
    fetch("/api/practicante/agents", { cache: "no-store" })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
        return body as { agents: PracticanteAgent[] };
      })
      .then((body) => {
        if (cancelled) return;
        setAgents(body.agents || []);
      })
      .catch((err) => {
        if (cancelled) return;
        setAgentsError(err.message || "No se pudo cargar el catálogo de agentes");
      })
      .finally(() => {
        if (!cancelled) setLoadingAgents(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleAgentChange = useCallback(
    (agentId: string) => {
      if (!agentId) {
        onUpdateData(node.id, { agentId: undefined, agentName: undefined } as Partial<CanvasNodeData>);
        return;
      }
      const agent = agents.find((a) => a.id === agentId);
      onUpdateData(node.id, {
        agentId,
        agentName: agent?.name,
      } as Partial<CanvasNodeData>);
    },
    [agents, node.id, onUpdateData]
  );

  const handleClearConversation = useCallback(() => {
    if (!data.conversationId) return;
    if (!window.confirm("¿Limpiar el hilo de conversación con Practicante? Se iniciará una nueva conversación en la próxima ejecución.")) return;
    onUpdateData(node.id, { conversationId: undefined } as Partial<CanvasNodeData>);
  }, [data.conversationId, node.id, onUpdateData]);

  return (
    <div className="w-[360px] h-full border-l border-border bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <Bot className="h-4 w-4 text-amber-400" />
        <span className="text-sm font-medium flex-1">Configurar Practicante</span>
        {canEdit && (
          <>
            <button
              onClick={() => onUpdateData(node.id, { locked: !isLocked } as Partial<CanvasNodeData>)}
              className={`p-1 rounded transition-colors ${isLocked ? "text-amber-500 bg-amber-500/10" : "text-muted-foreground hover:text-foreground"}`}
              title={isLocked ? "Desbloquear nodo" : "Bloquear nodo"}
            >
              {isLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
            </button>
            <button
              onClick={() => {
                const connected = edges.some((e) => e.source === node.id || e.target === node.id);
                if (connected && !window.confirm("Este nodo tiene conexiones. ¿Eliminar?")) return;
                onDelete(node.id);
                onClose();
              }}
              className="p-1 rounded text-muted-foreground hover:text-red-400 hover:bg-red-500/10 transition-colors"
              title="Eliminar nodo"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
        <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
          <X className="h-4 w-4" />
        </button>
      </div>

      {isLocked && (
        <div className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 text-amber-500 text-xs">
          <Lock className="h-3 w-3" /> Nodo bloqueado
        </div>
      )}
      {!canEdit && (
        <div className="flex items-center gap-2 px-4 py-2 bg-muted text-muted-foreground text-xs">
          <Lock className="h-3 w-3" /> Solo lectura
        </div>
      )}

      {/* Content */}
      <div className={`flex-1 overflow-y-auto p-4 space-y-4 ${isLocked ? "opacity-50 pointer-events-none" : !canEdit ? "pointer-events-none" : ""}`}>
        {/* Prompt */}
        <div className="space-y-1.5">
          <Label className="text-xs">Prompt</Label>
          <Textarea
            value={data.prompt || ""}
            onChange={(e) => onUpdateData(node.id, { prompt: e.target.value } as Partial<CanvasNodeData>)}
            placeholder="Instrucción para el orquestador o el agente..."
            className="text-sm min-h-[100px] resize-y"
          />
          <p className="text-[10px] text-muted-foreground">
            Si hay un nodo conectado al input de prompt, ese texto se antepone al prompt de arriba.
          </p>
        </div>

        {/* Agent selector */}
        <div className="space-y-1.5">
          <Label className="text-xs">Agente</Label>
          <select
            value={data.agentId || ""}
            onChange={(e) => handleAgentChange(e.target.value)}
            disabled={loadingAgents || agents.length === 0}
            className="w-full h-8 rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
          >
            <option value="">Orquestador (auto)</option>
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {loadingAgents && (
            <p className="text-[10px] text-muted-foreground flex items-center gap-1">
              <Loader2 className="h-2.5 w-2.5 animate-spin" /> Cargando catálogo...
            </p>
          )}
          {agentsError && (
            <p className="text-[10px] text-red-400">{agentsError}</p>
          )}
          {data.agentId && data.agentName && (
            <p className="text-[10px] text-muted-foreground">
              Delegación directa a: <span className="text-foreground">{data.agentName}</span>
            </p>
          )}
          {!data.agentId && (
            <p className="text-[10px] text-muted-foreground">
              El orquestador decide qué agente usar.
            </p>
          )}
        </div>

        {/* Output mode toggle */}
        <div className="space-y-1.5">
          <Label className="text-xs">Modo de salida</Label>
          <div className="flex gap-1.5">
            <button
              onClick={() => onUpdateData(node.id, { outputAsPrompt: true } as Partial<CanvasNodeData>)}
              className={`flex-1 px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
                data.outputAsPrompt !== false
                  ? "bg-purple-500/15 text-purple-400 border-purple-500/30"
                  : "border-border hover:bg-accent"
              }`}
            >
              Prompt
            </button>
            <button
              onClick={() => onUpdateData(node.id, { outputAsPrompt: false } as Partial<CanvasNodeData>)}
              className={`flex-1 px-2.5 py-1.5 text-xs rounded-md border transition-colors ${
                data.outputAsPrompt === false
                  ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
                  : "border-border hover:bg-accent"
              }`}
            >
              Libre
            </button>
          </div>
          <p className="text-[10px] text-muted-foreground">
            {data.outputAsPrompt !== false
              ? "Se inyecta una instrucción al agente para que responda SOLO con el texto útil, sin saludos, explicaciones ni preguntas. Ideal para encadenar con otros nodos."
              : "El agente responde libremente como lo haría en una conversación normal."}
          </p>
        </div>

        {/* Dry-run toggle */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={data.dryRun === true}
              onChange={(e) => onUpdateData(node.id, { dryRun: e.target.checked } as Partial<CanvasNodeData>)}
              id="practicante-dry-run"
              className="rounded"
            />
            <Label htmlFor="practicante-dry-run" className="text-xs flex items-center gap-1">
              <FlaskConical className="h-3 w-3 text-purple-400" />
              Dry-run (solo analizar)
            </Label>
          </div>
          <p className="text-[10px] text-muted-foreground">
            En modo dry-run, Practicante no ejecuta herramientas: describe qué agente y tools usaría. El análisis se muestra en el panel lateral. El modo de salida &quot;Prompt&quot; se ignora en dry-run.
          </p>
        </div>

        {/* Conversation state */}
        <div className="space-y-1.5 pt-2 border-t border-border/50">
          <div className="flex items-center justify-between">
            <Label className="text-xs text-muted-foreground">Conversación</Label>
            {data.conversationId && (
              <button
                type="button"
                onClick={handleClearConversation}
                className="text-[10px] flex items-center gap-1 text-muted-foreground hover:text-red-400 transition-colors"
                title="Iniciar nueva conversación en la próxima ejecución"
              >
                <RotateCcw className="h-3 w-3" /> Limpiar hilo
              </button>
            )}
          </div>
          {data.conversationId ? (
            <p className="text-[10px] text-muted-foreground truncate">
              ID: <span className="text-foreground/70 font-mono">{data.conversationId}</span>
            </p>
          ) : (
            <p className="text-[10px] text-muted-foreground">
              Aún no se ha ejecutado. Se creará al primer run y se reutilizará en re-ejecuciones.
            </p>
          )}
        </div>

        {/* Execution summary */}
        {data.status === "completed" && (
          <div className="space-y-2 pt-2 border-t border-border/50">
            {data.delegatedTo && (
              <p className="text-[10px] text-muted-foreground">
                Delegó a: <span className="text-foreground">{data.delegatedTo}</span>
              </p>
            )}
            {data.toolsUsed && data.toolsUsed.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Tools usadas</Label>
                <div className="flex flex-wrap gap-1">
                  {data.toolsUsed.map((t, i) => (
                    <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-300">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {data.outputText && !data.dryRun && (
              <div className="space-y-1">
                <Label className="text-xs">Resultado</Label>
                <div className="bg-muted/50 rounded-md p-3 text-xs max-h-[200px] overflow-y-auto whitespace-pre-wrap">
                  {data.outputText}
                </div>
              </div>
            )}
          </div>
        )}

        {data.status === "error" && data.errorMessage && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-md p-3 text-xs text-red-400">
            {data.errorMessage}
          </div>
        )}
      </div>

      {/* Footer actions — en solo-ver no se puede ejecutar */}
      {canEdit && (
        <div className="flex items-center gap-2 px-4 py-3 border-t border-border">
          <Button
            size="sm"
            onClick={() => onExecute(node.id)}
            disabled={isGenerating || isExecuting || isLocked}
            className="flex-1 gap-1.5"
          >
            {isGenerating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {isGenerating ? "Ejecutando..." : data.dryRun ? "Analizar (dry-run)" : "Ejecutar"}
          </Button>
        </div>
      )}
    </div>
  );
}
