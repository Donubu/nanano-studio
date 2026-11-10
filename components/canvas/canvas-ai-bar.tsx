"use client";

// Barra "Pídele a la IA" del canvas. El usuario escribe lo que quiere armar
// o cambiar ("arma un flujo de 4 escenas con imagen y video cada una",
// "conecta el texto a todas las imágenes") y el workspace aplica el plan que
// devuelve /api/conversations/[id]/canvas/ai/assist como un cambio normal
// (persistido y compartido con los colaboradores). "Deshacer" lo revierte.

import { useEffect, useRef, useState } from "react";
import { ChevronDown, Loader2, Sparkles, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface CanvasAiResult {
  reply: string;
  warnings: string[];
  applied: boolean;
  summary?: string;
}

interface Props {
  canEdit: boolean;
  selectedCount: number;
  onSubmit: (instruction: string, signal: AbortSignal) => Promise<CanvasAiResult>;
  canUndo: boolean;
  onUndo: () => Promise<void>;
}

export function CanvasAiBar({ canEdit, selectedCount, onSubmit, canUndo, onUndo }: Props) {
  const [open, setOpen] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState<"ask" | "undo" | null>(null);
  const [result, setResult] = useState<(CanvasAiResult & { error?: boolean }) | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const submit = async () => {
    const text = instruction.trim();
    if (text.length < 2 || busy || !canEdit) return;
    setBusy("ask");
    setResult(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const r = await onSubmit(text, ctrl.signal);
      setResult(r);
      if (r.applied) setInstruction("");
    } catch (e) {
      if (!ctrl.signal.aborted) {
        setResult({ reply: (e as Error).message, warnings: [], applied: false, error: true });
      }
    } finally {
      abortRef.current = null;
      setBusy(null);
    }
  };

  const undo = async () => {
    setBusy("undo");
    try {
      await onUndo();
      setResult(null);
    } finally {
      setBusy(null);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={!canEdit}
        title={canEdit ? "Pídele a la IA que arme o cambie el canvas" : "Solo el editor del canvas puede usar la IA"}
        className="flex items-center gap-2 rounded-full border border-violet-500/40 bg-background/95 px-4 py-2 text-sm shadow-lg backdrop-blur hover:border-violet-400 disabled:opacity-50"
      >
        <Sparkles className="h-4 w-4 text-violet-400" />
        Pídele a la IA
      </button>
    );
  }

  const placeholder =
    selectedCount > 0
      ? "Ej: conecta estos nodos a un Params Imagen 9:16 · reescribe sus prompts con luz de atardecer"
      : "Ej: arma un flujo de 4 escenas con imagen y video para cada una, estilo acuarela";

  return (
    <div className="w-[min(680px,calc(100vw-32px))] rounded-xl border border-violet-500/30 bg-background/95 shadow-2xl backdrop-blur">
      <div className="flex items-start gap-2 p-2">
        <Sparkles className="mt-2 h-4 w-4 shrink-0 text-violet-400" />
        <textarea
          ref={inputRef}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            // Que el canvas no tome los atajos (borrar nodo, V/H, copiar…).
            e.stopPropagation();
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
            if (e.key === "Escape") {
              if (busy === "ask") abortRef.current?.abort();
              else setOpen(false);
            }
          }}
          rows={instruction.length > 90 || instruction.includes("\n") ? 3 : 1}
          placeholder={placeholder}
          disabled={!canEdit || busy === "ask"}
          className="min-w-0 flex-1 resize-none bg-transparent py-1.5 text-sm placeholder:text-muted-foreground/60 focus:outline-none disabled:opacity-60"
        />
        {selectedCount > 0 && (
          <span className="mt-2 shrink-0 text-[10px] text-violet-300">
            {selectedCount === 1 ? "sobre el nodo seleccionado" : `sobre ${selectedCount} nodos`}
          </span>
        )}
        {busy === "ask" ? (
          <button
            type="button"
            onClick={() => abortRef.current?.abort()}
            className="flex shrink-0 items-center gap-1 rounded bg-muted px-2.5 py-1.5 text-xs hover:bg-muted/70"
          >
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cancelar
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!canEdit || busy !== null || instruction.trim().length < 2}
            className="flex shrink-0 items-center gap-1 rounded bg-violet-600 px-2.5 py-1.5 text-xs text-white hover:bg-violet-500 disabled:opacity-40"
          >
            <Sparkles className="h-3.5 w-3.5" /> Pedir
          </button>
        )}
        <button
          type="button"
          onClick={() => setOpen(false)}
          title="Cerrar"
          className="mt-1 shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
        >
          <ChevronDown className="h-4 w-4" />
        </button>
      </div>

      {(result || canUndo) && (
        <div className="space-y-1 border-t border-border/50 px-3 py-2 text-xs">
          {result && (
            <div className={cn("flex items-start gap-2", result.error ? "text-amber-300" : "text-foreground/90")}>
              <span className="min-w-0 flex-1">
                {result.reply || (result.applied ? "Listo." : "La IA no propuso cambios.")}
                {result.summary && <span className="ml-1 text-muted-foreground">({result.summary})</span>}
              </span>
              <button type="button" onClick={() => setResult(null)} className="shrink-0 text-muted-foreground hover:text-foreground">
                <X className="h-3 w-3" />
              </button>
            </div>
          )}
          {result?.warnings.map((w, i) => (
            <div key={i} className="text-[11px] text-amber-300/90">
              · {w}
            </div>
          ))}
          {canUndo && (
            <button
              type="button"
              onClick={undo}
              disabled={busy !== null}
              className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {busy === "undo" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
              Deshacer lo que hizo la IA
            </button>
          )}
        </div>
      )}
    </div>
  );
}
