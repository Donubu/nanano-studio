"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Trash2, History, X, Loader2, RotateCcw, ImageIcon, MessageSquare, Video, Type, ImagePlus, Images, Settings, Bot, Sparkles, Film, StickyNote, AlertTriangle } from "lucide-react";

interface TrashNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  width?: number;
  height?: number;
  data: {
    label?: string;
    outputUrl?: string | null;
    outputText?: string | null;
    [k: string]: unknown;
  };
  deletedAt: string;
  originallyCreatedAt: string;
}

interface TrashEdge {
  id: string;
  source: string;
  target: string;
  deletedAt: string;
}

interface Snapshot {
  history_id: number;
  snapshot_id: string;
  snapshot_reason: "autosave" | "manual" | "pre-restore" | "pre-wipe";
  saved_by_user_id: number | null;
  nodes_count: number;
  edges_count: number;
  created_at: string;
}

interface HistoryPanelProps {
  conversationId: number;
  isOpen: boolean;
  onClose: () => void;
  onCanvasRestored: () => void;
}

const nodeIcon: Record<string, typeof MessageSquare> = {
  text: MessageSquare,
  "text-practicante": Bot,
  image: ImageIcon,
  video: Video,
  note: StickyNote,
  "static-text": Type,
  "static-image": ImagePlus,
  "static-image-group": Images,
  "params-text": Settings,
  "params-image": Settings,
  "params-video": Settings,
  "params-scene": Settings,
  script: Sparkles,
  scene: Film,
};

function formatRelative(iso: string) {
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `hace ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `hace ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `hace ${h}h`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
}

const reasonLabel: Record<Snapshot["snapshot_reason"], { label: string; cls: string }> = {
  autosave: { label: "Auto", cls: "bg-muted text-muted-foreground" },
  manual: { label: "Manual", cls: "bg-blue-500/15 text-blue-400" },
  "pre-restore": { label: "Antes de restaurar", cls: "bg-violet-500/15 text-violet-400" },
  "pre-wipe": { label: "Antes de wipe", cls: "bg-amber-500/15 text-amber-400" },
};

export function HistoryPanel({ conversationId, isOpen, onClose, onCanvasRestored }: HistoryPanelProps) {
  const [tab, setTab] = useState<"trash" | "snapshots">("trash");
  const [trashNodes, setTrashNodes] = useState<TrashNode[]>([]);
  const [trashEdges, setTrashEdges] = useState<TrashEdge[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
  const [restoreEdges, setRestoreEdges] = useState(true);
  const [loading, setLoading] = useState(false);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchTrash = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/canvas/trash`);
      if (!res.ok) throw new Error("Error cargando papelera");
      const data = await res.json();
      setTrashNodes(data.nodes || []);
      setTrashEdges(data.edges || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  const fetchSnapshots = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/canvas/history`);
      if (!res.ok) throw new Error("Error cargando historial");
      const data = await res.json();
      setSnapshots(data.snapshots || []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  useEffect(() => {
    if (!isOpen) return;
    if (tab === "trash") fetchTrash();
    else fetchSnapshots();
  }, [isOpen, tab, fetchTrash, fetchSnapshots]);

  const toggleSelect = (id: string) => {
    setSelectedNodeIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelectedNodeIds(new Set(trashNodes.map((n) => n.id)));
  const clearSelection = () => setSelectedNodeIds(new Set());

  const restoreSelected = async () => {
    if (selectedNodeIds.size === 0 && !restoreEdges) return;
    setBusyAction("restore-trash");
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/canvas/trash`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nodeIds: [...selectedNodeIds],
          restoreIncidentEdges: restoreEdges,
        }),
      });
      if (!res.ok) throw new Error("Error restaurando");
      clearSelection();
      onCanvasRestored();
      await fetchTrash();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  const restoreSnapshot = async (snapshotId: string) => {
    if (!confirm("Restaurar este snapshot reemplazará el estado actual del canvas. ¿Continuar?")) return;
    setBusyAction(`snap-${snapshotId}`);
    setError(null);
    try {
      const res = await fetch(`/api/conversations/${conversationId}/canvas/history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ snapshotId }),
      });
      if (!res.ok) throw new Error("Error restaurando snapshot");
      onCanvasRestored();
      await fetchSnapshots();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusyAction(null);
    }
  };

  const incidentEdgeCount = useMemo(() => {
    if (selectedNodeIds.size === 0) return 0;
    return trashEdges.filter((e) => selectedNodeIds.has(e.source) || selectedNodeIds.has(e.target)).length;
  }, [trashEdges, selectedNodeIds]);

  if (!isOpen) return null;

  return (
    <div className="fixed top-0 right-0 h-full w-[400px] bg-background border-l border-border shadow-2xl z-40 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-semibold">Historial del canvas</span>
        </div>
        <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>

      <div className="flex border-b border-border">
        <button
          onClick={() => setTab("trash")}
          className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
            tab === "trash" ? "text-foreground border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            <Trash2 className="h-3.5 w-3.5" />
            Papelera {trashNodes.length > 0 && `(${trashNodes.length})`}
          </span>
        </button>
        <button
          onClick={() => setTab("snapshots")}
          className={`flex-1 px-4 py-2 text-xs font-medium transition-colors ${
            tab === "snapshots" ? "text-foreground border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <span className="inline-flex items-center gap-1.5">
            <History className="h-3.5 w-3.5" />
            Snapshots
          </span>
        </button>
      </div>

      {error && (
        <div className="px-4 py-2 bg-red-500/10 border-b border-red-500/30 text-xs text-red-400 flex items-center gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {loading && (
          <div className="flex items-center justify-center py-12 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
          </div>
        )}

        {!loading && tab === "trash" && (
          <>
            {trashNodes.length === 0 ? (
              <div className="px-4 py-12 text-center text-xs text-muted-foreground">
                No hay nodos eliminados.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {trashNodes.map((n) => {
                  const Icon = nodeIcon[n.type] || MessageSquare;
                  const isSelected = selectedNodeIds.has(n.id);
                  const previewImg = typeof n.data.outputUrl === "string" ? n.data.outputUrl : null;
                  const previewText = typeof n.data.outputText === "string" ? n.data.outputText.slice(0, 80) : null;
                  return (
                    <li key={n.id} className="px-3 py-2.5 hover:bg-accent/30">
                      <label className="flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          className="mt-1 shrink-0"
                          checked={isSelected}
                          onChange={() => toggleSelect(n.id)}
                        />
                        <div className="shrink-0 mt-0.5">
                          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium truncate">{n.data.label || n.type}</span>
                            <span className="text-[10px] text-muted-foreground shrink-0">{formatRelative(n.deletedAt)}</span>
                          </div>
                          {previewImg && (
                            <div className="mt-1.5 w-full max-w-[200px] aspect-video bg-muted rounded overflow-hidden">
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={previewImg} alt="" className="w-full h-full object-cover" loading="lazy" />
                            </div>
                          )}
                          {!previewImg && previewText && (
                            <div className="mt-1 text-[11px] text-muted-foreground line-clamp-2">{previewText}</div>
                          )}
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}

        {!loading && tab === "snapshots" && (
          <>
            {snapshots.length === 0 ? (
              <div className="px-4 py-12 text-center text-xs text-muted-foreground">
                No hay snapshots todavía.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {snapshots.map((s) => {
                  const reason = reasonLabel[s.snapshot_reason] || reasonLabel.autosave;
                  return (
                    <li key={s.history_id} className="px-3 py-2.5 hover:bg-accent/30 flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${reason.cls}`}>{reason.label}</span>
                          <span className="text-xs text-muted-foreground">{formatRelative(s.created_at)}</span>
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          {s.nodes_count} nodos · {s.edges_count} conexiones
                        </div>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs gap-1"
                        disabled={busyAction !== null}
                        onClick={() => restoreSnapshot(s.snapshot_id)}
                      >
                        {busyAction === `snap-${s.snapshot_id}` ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3 w-3" />
                        )}
                        Restaurar
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>

      {tab === "trash" && trashNodes.length > 0 && (
        <div className="border-t border-border p-3 space-y-2 bg-background">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{selectedNodeIds.size} seleccionado(s)</span>
            <div className="flex gap-2">
              <button onClick={selectAll} className="hover:text-foreground">Todos</button>
              <button onClick={clearSelection} className="hover:text-foreground">Ninguno</button>
            </div>
          </div>
          <label className="flex items-center gap-2 text-[11px] text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={restoreEdges}
              onChange={(e) => setRestoreEdges(e.target.checked)}
            />
            Restaurar también conexiones cuyos extremos queden vivos
            {incidentEdgeCount > 0 && (
              <span className="text-[10px]">({incidentEdgeCount} candidatas)</span>
            )}
          </label>
          <Button
            size="sm"
            className="w-full gap-1.5"
            disabled={busyAction !== null || (selectedNodeIds.size === 0 && !restoreEdges)}
            onClick={restoreSelected}
          >
            {busyAction === "restore-trash" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCcw className="h-3.5 w-3.5" />
            )}
            Restaurar selección
          </Button>
        </div>
      )}
    </div>
  );
}
