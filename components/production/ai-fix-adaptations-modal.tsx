"use client";

// Modal "Revisar con IA" del paso Formatos.
//
// 1. Corre el lint (lib/production/layout-lint.ts) sobre cada formato tal
//    como lo muestra su card y preselecciona los que tienen errores.
// 2. Captura el render de los seleccionados (off-screen, ≤1024 px) y los
//    manda en un lote a /api/production/designs/[id]/ai/fix-adaptations,
//    que los corrige con Gemini en paralelo y transmite cada resultado por
//    SSE apenas termina.
// 3. El productor ve antes/después por formato y aplica los que quiera:
//    se guardan como manual_layout de la adaptación (mismo efecto que
//    ajustarla a mano en el editor; "Restablecer" la devuelve a automático).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { TemplateDefinition } from "@/lib/production/types";
import { BrandKitContent, resolveTreeTokens } from "@/lib/production/brand-kit";
import { lintLayout, hasLintErrors, LintIssue } from "@/lib/production/layout-lint";
import { serializeOverrides } from "@/lib/production/overrides";
import { DataRow, substituteVariables } from "@/lib/production/variables";
import { captureNodeToJpeg } from "@/lib/production/export";
import { prepareImageForAgent } from "@/lib/production/prepare-image";
import { AdaptationRenderer } from "@/components/production/render/adaptation-renderer";
import type { SafeZone } from "@/lib/production/safe-zone";

export interface FixCandidate {
  // Zona segura de la plataforma del formato (safe-zone.ts).
  safe?: SafeZone | null;
  adaptationId: number;
  label: string;
  width: number;
  height: number;
  // Árbol que hoy muestra la card, sin resolver tokens.
  tree: TemplateDefinition;
  // Orientación de origen (intención del diseño).
  sourceTree: TemplateDefinition | null;
  // Ya tiene ajuste manual: se puede revisar, pero no se preselecciona.
  isManual: boolean;
}

type ItemStatus = "idle" | "working" | "done" | "error" | "applied";

interface ItemResult {
  ok: boolean;
  tree?: TemplateDefinition;
  patches?: unknown[];
  rationale?: string;
  issues_before: LintIssue[];
  issues_after?: LintIssue[];
  passes: number;
  duration_ms: number;
  error?: string;
}

// Captura más chica que la de "Adaptar con IA": el modelo solo necesita ver
// la composición, y cada imagen se cobra por baldosas.
const CAPTURE_MAX_SIDE = 1024;

function asOverride(tree: TemplateDefinition) {
  return {
    width: Math.round(tree.size.w),
    height: Math.round(tree.size.h),
    fit_mode: "responsive" as const,
    overrides_json: serializeOverrides({ manual_layout: tree }),
  };
}

function TreePreview({
  tree,
  brandKit,
  dataRow,
  maxW,
  maxH,
}: {
  tree: TemplateDefinition;
  brandKit: BrandKitContent;
  dataRow: DataRow | null;
  maxW: number;
  maxH: number;
}) {
  const w = tree.size.w;
  const h = tree.size.h;
  const s = Math.min(maxW / w, maxH / h, 1);
  return (
    <div
      className="overflow-hidden rounded border border-border/40 shrink-0"
      style={{ width: w * s, height: h * s }}
    >
      <div style={{ width: w, height: h, transform: `scale(${s})`, transformOrigin: "0 0" }}>
        <AdaptationRenderer
          adaptation={asOverride(tree)}
          master={tree}
          brandKit={brandKit}
          dataRow={dataRow}
        />
      </div>
    </div>
  );
}

function IssueChips({ issues }: { issues: LintIssue[] }) {
  if (issues.length === 0) {
    return <span className="text-[11px] text-emerald-400">Sin problemas detectados</span>;
  }
  const errors = issues.filter((i) => i.severity === "error").length;
  const warnings = issues.length - errors;
  return (
    <span className="text-[11px] flex items-center gap-2">
      {errors > 0 && (
        <span className="text-red-400">
          {errors} error{errors === 1 ? "" : "es"}
        </span>
      )}
      {warnings > 0 && (
        <span className="text-amber-400">
          {warnings} aviso{warnings === 1 ? "" : "s"}
        </span>
      )}
    </span>
  );
}

export function AiFixAdaptationsModal({
  designId,
  candidates,
  brandKit,
  dataRow,
  onClose,
  onApplied,
}: {
  designId: number;
  candidates: FixCandidate[];
  brandKit: BrandKitContent;
  // Fila activa del dataset: el chequeo y la IA miden los textos con sus
  // valores reales (como las cards), no con el placeholder {{var}}. Lo que
  // se guarda sigue siendo el árbol con las variables.
  dataRow: DataRow | null;
  onClose: () => void;
  // Se llama al cerrar si se aplicó al menos un formato (refetch de la lista).
  onApplied: () => void;
}) {
  const issuesById = useMemo(() => {
    const m = new Map<number, LintIssue[]>();
    for (const c of candidates) {
      const tree = dataRow ? substituteVariables(c.tree, dataRow) : c.tree;
      m.set(c.adaptationId, lintLayout(resolveTreeTokens(tree, brandKit), { safe: c.safe }));
    }
    return m;
  }, [candidates, brandKit, dataRow]);

  const [selected, setSelected] = useState<Set<number>>(
    () =>
      new Set(
        candidates
          .filter((c) => !c.isManual && hasLintErrors(issuesById.get(c.adaptationId) ?? []))
          .map((c) => c.adaptationId),
      ),
  );
  const [instructions, setInstructions] = useState("");
  const [phase, setPhase] = useState<"select" | "capturing" | "running" | "finished">("select");
  const [status, setStatus] = useState<Map<number, ItemStatus>>(new Map());
  const [results, setResults] = useState<Map<number, ItemResult>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ cost: number; ms: number } | null>(null);
  const [applying, setApplying] = useState(false);
  const appliedAny = useRef(false);
  const captureRefs = useRef(new Map<number, HTMLDivElement>());
  const abortRef = useRef<AbortController | null>(null);

  const withErrors = candidates.filter((c) => hasLintErrors(issuesById.get(c.adaptationId) ?? []));
  const running = phase === "capturing" || phase === "running";
  // Memo: la captura y el lote dependen de esta lista; si cambiara de
  // identidad en cada render (cada evento SSE re-renderiza) el efecto de
  // captura se cancelaría a mitad de camino.
  const selectedCandidates = useMemo(
    () => candidates.filter((c) => selected.has(c.adaptationId)),
    [candidates, selected],
  );

  const setItemStatus = (id: number, s: ItemStatus) =>
    setStatus((cur) => new Map(cur).set(id, s));

  const handleClose = useCallback(() => {
    abortRef.current?.abort();
    if (appliedAny.current) onApplied();
    onClose();
  }, [onApplied, onClose]);

  const toggle = (id: number) =>
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Lectura del stream SSE: eventos `data: {...}` separados por línea vacía.
  const runBatch = useCallback(
    async (images: Map<number, string>) => {
      setPhase("running");
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await fetch(`/api/production/designs/${designId}/ai/fix-adaptations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            instructions: instructions.trim() || undefined,
            data_row: dataRow ?? undefined,
            items: selectedCandidates.map((c) => ({
              adaptation_id: c.adaptationId,
              tree: c.tree,
              source_tree: c.sourceTree ?? undefined,
              image: images.get(c.adaptationId),
            })),
          }),
        });
        if (!res.ok || !res.body) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `HTTP ${res.status}`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          let sep: number;
          while ((sep = buffer.indexOf("\n\n")) >= 0) {
            const chunk = buffer.slice(0, sep);
            buffer = buffer.slice(sep + 2);
            const line = chunk.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            const ev = JSON.parse(line.slice(6));
            if (ev.type === "start") {
              setItemStatus(ev.adaptation_id, "working");
            } else if (ev.type === "item") {
              setResults((cur) => new Map(cur).set(ev.adaptation_id, ev as ItemResult));
              setItemStatus(ev.adaptation_id, ev.ok ? "done" : "error");
            } else if (ev.type === "done") {
              setSummary({ cost: ev.usage?.estimatedCost ?? 0, ms: ev.duration_ms ?? 0 });
            }
          }
        }
        setPhase("finished");
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setError((e as Error).message);
        setPhase("finished");
      }
    },
    [designId, instructions, selectedCandidates, dataRow],
  );

  // Captura off-screen de los seleccionados y después el lote. Si una
  // captura falla, ese formato va sin imagen (el modelo igual tiene las
  // coordenadas).
  useEffect(() => {
    if (phase !== "capturing") return;
    let cancelled = false;
    (async () => {
      await new Promise<void>((resolve) => requestAnimationFrame(() => setTimeout(resolve, 80)));
      const images = new Map<number, string>();
      for (const c of selectedCandidates) {
        if (cancelled) return;
        const node = captureRefs.current.get(c.adaptationId);
        if (!node) continue;
        try {
          const blob = await captureNodeToJpeg(node);
          const prepared = await prepareImageForAgent(blob, { maxSide: CAPTURE_MAX_SIDE });
          images.set(c.adaptationId, prepared.dataUri);
        } catch (e) {
          console.warn(`Captura de ${c.width}×${c.height} falló:`, (e as Error).message);
        }
      }
      if (!cancelled) runBatch(images);
    })();
    return () => {
      cancelled = true;
    };
  }, [phase, selectedCandidates, runBatch]);

  const start = () => {
    if (selectedCandidates.length === 0) return;
    setError(null);
    setSummary(null);
    setResults(new Map());
    setStatus(new Map(selectedCandidates.map((c) => [c.adaptationId, "idle" as ItemStatus])));
    setPhase("capturing");
  };

  const apply = async (ids: number[]) => {
    setApplying(true);
    try {
      for (const id of ids) {
        const r = results.get(id);
        if (!r?.ok || !r.tree) continue;
        const res = await fetch(`/api/production/designs/${designId}/adaptations/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ overrides_json: { manual_layout: r.tree } }),
        });
        if (res.ok) {
          appliedAny.current = true;
          setItemStatus(id, "applied");
        } else {
          const body = await res.json().catch(() => ({}));
          setError(body?.error || `No se pudo guardar ${id} (HTTP ${res.status})`);
        }
      }
    } finally {
      setApplying(false);
    }
  };

  const discard = (id: number) => {
    setResults((cur) => {
      const next = new Map(cur);
      next.delete(id);
      return next;
    });
    setItemStatus(id, "idle");
  };

  // Sin correcciones = la IA dio el formato por bueno: nada que aplicar.
  const hasChanges = (r: ItemResult | undefined) => !!r?.ok && (r.patches?.length ?? 0) > 0;
  const pendingApply = [...results.entries()]
    .filter(([id, r]) => hasChanges(r) && status.get(id) === "done")
    .map(([id]) => id);

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget && !running && !applying) handleClose();
      }}
    >
      <div className="bg-background border border-border/50 rounded-xl shadow-2xl w-full max-w-4xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/50">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-violet-400" />
            <div>
              <h2 className="text-sm font-semibold">Revisar formatos con IA</h2>
              <p className="text-xs text-muted-foreground">
                {withErrors.length === 0
                  ? `Los ${candidates.length} formatos pasan el chequeo automático`
                  : `${withErrors.length} de ${candidates.length} formatos tienen problemas`}
              </p>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={handleClose} disabled={applying}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {phase === "select" && (
            <div>
              <label className="text-xs text-muted-foreground block mb-1">
                Instrucciones (opcional)
              </label>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Ej: en los formatos chicos prioriza el precio por sobre la bajada"
                rows={2}
                className="w-full bg-muted border border-border/50 rounded-md px-3 py-2 text-sm"
              />
            </div>
          )}

          {error && (
            <div className="text-xs text-red-400 flex items-start gap-1.5">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {candidates.map((c) => {
            const issues = issuesById.get(c.adaptationId) ?? [];
            const st = status.get(c.adaptationId);
            const r = results.get(c.adaptationId);
            const isSelected = selected.has(c.adaptationId);
            if (phase !== "select" && !isSelected) return null;
            return (
              <div
                key={c.adaptationId}
                className={cn(
                  "rounded-lg border p-3 flex gap-4 items-start",
                  isSelected ? "border-violet-500/40 bg-violet-500/5" : "border-border/50",
                )}
              >
                {phase === "select" && (
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggle(c.adaptationId)}
                    className="accent-violet-500 mt-1"
                  />
                )}
                <div className="flex flex-col gap-1 min-w-[150px] max-w-[200px]">
                  <span className="text-sm font-medium truncate">{c.label}</span>
                  <span className="text-[11px] font-mono text-muted-foreground">
                    {c.width}×{c.height}
                    {c.isManual ? " · ajuste manual" : ""}
                  </span>
                  <IssueChips issues={r?.issues_after ?? issues} />
                  {phase === "select" && issues.length > 0 && (
                    <ul className="text-[11px] text-muted-foreground list-disc pl-4 space-y-0.5">
                      {issues.slice(0, 4).map((i, k) => (
                        <li key={k}>{i.detail}</li>
                      ))}
                      {issues.length > 4 && <li>y {issues.length - 4} más</li>}
                    </ul>
                  )}
                </div>

                <div className="flex gap-3 items-start flex-1 min-w-0">
                  <div className="flex flex-col gap-1">
                    {hasChanges(r) && <span className="text-[10px] text-muted-foreground">Actual</span>}
                    <TreePreview tree={c.tree} brandKit={brandKit} dataRow={dataRow} maxW={220} maxH={160} />
                  </div>
                  {hasChanges(r) && r?.tree && (
                    <div className="flex flex-col gap-1">
                      <span className="text-[10px] text-violet-300">Propuesta IA</span>
                      <TreePreview tree={r.tree} brandKit={brandKit} dataRow={dataRow} maxW={220} maxH={160} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0 text-xs space-y-2">
                    {st === "idle" && running && (
                      <span className="text-muted-foreground flex items-center gap-1.5">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {phase === "capturing" ? "Preparando captura…" : "En cola…"}
                      </span>
                    )}
                    {st === "working" && (
                      <span className="text-violet-300 flex items-center gap-1.5">
                        <Loader2 className="h-3 w-3 animate-spin" /> Corrigiendo…
                      </span>
                    )}
                    {r && !r.ok && <span className="text-red-400">{r.error}</span>}
                    {r?.ok && (
                      <>
                        {r.rationale && <p className="text-muted-foreground">{r.rationale}</p>}
                        <p className="text-[10px] text-muted-foreground/70">
                          {(r.duration_ms / 1000).toFixed(1)} s
                          {r.passes > 1 ? ` · ${r.passes} pasadas` : ""}
                        </p>
                        {!hasChanges(r) ? (
                          <span className="text-muted-foreground">Sin cambios: el formato queda como está.</span>
                        ) : st === "applied" ? (
                          <span className="text-emerald-400 flex items-center gap-1">
                            <Check className="h-3.5 w-3.5" /> Aplicado
                          </span>
                        ) : (
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="h-7 text-xs"
                              disabled={applying}
                              onClick={() => apply([c.adaptationId])}
                            >
                              Aplicar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 text-xs"
                              disabled={applying}
                              onClick={() => discard(c.adaptationId)}
                            >
                              Descartar
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between gap-3 px-5 py-3 border-t border-border/50">
          <p className="text-[11px] text-muted-foreground">
            {summary
              ? `Listo en ${(summary.ms / 1000).toFixed(1)} s · USD ${summary.cost.toFixed(3)}`
              : "Lo aplicado queda como ajuste manual del formato; puedes restablecerlo cuando quieras."}
          </p>
          <div className="flex gap-2">
            {phase === "select" && (
              <Button
                size="sm"
                onClick={start}
                disabled={selectedCandidates.length === 0}
                className="gap-1"
              >
                <Sparkles className="h-4 w-4" />
                Corregir {selectedCandidates.length}{" "}
                {selectedCandidates.length === 1 ? "formato" : "formatos"}
              </Button>
            )}
            {running && (
              <Button size="sm" variant="outline" disabled className="gap-1">
                <Loader2 className="h-4 w-4 animate-spin" /> Corrigiendo…
              </Button>
            )}
            {phase === "finished" && pendingApply.length > 0 && (
              <Button size="sm" onClick={() => apply(pendingApply)} disabled={applying} className="gap-1">
                {applying ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Aplicar {pendingApply.length > 1 ? `las ${pendingApply.length}` : "la propuesta"}
              </Button>
            )}
            {phase === "finished" && (
              <Button size="sm" variant="ghost" onClick={handleClose} disabled={applying}>
                Cerrar
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Render off-screen a tamaño nativo para capturar lo que el modelo
          va a corregir. Solo existe durante la fase de captura. */}
      {phase === "capturing" && (
        <div style={{ position: "fixed", left: -100000, top: 0, pointerEvents: "none" }} aria-hidden>
          {selectedCandidates.map((c) => (
            <AdaptationRenderer
              key={c.adaptationId}
              ref={(el) => {
                if (el) captureRefs.current.set(c.adaptationId, el);
                else captureRefs.current.delete(c.adaptationId);
              }}
              adaptation={asOverride(c.tree)}
              master={c.tree}
              brandKit={brandKit}
              dataRow={dataRow}
            />
          ))}
        </div>
      )}
    </div>
  );
}
