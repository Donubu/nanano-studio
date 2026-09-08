"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Loader2, Sparkles, AlertTriangle } from "lucide-react";
import { formatDateLocal } from "@/lib/utils";

/**
 * Resumen de costos del Banner Designer para un proyecto de producción.
 * Consume GET /api/production/projects/[id]/ai-costs. Colapsado por default:
 * la cabecera muestra el total y la ventana reciente; al expandir aparece el
 * desglose por operación y las últimas invocaciones (con rationale/error).
 */

interface AiCostsResponse {
  total: {
    invocations: number;
    errors: number;
    cost_usd: number;
    input_tokens: number;
    output_tokens: number;
  };
  period: { days: number; invocations: number; errors: number; cost_usd: number };
  by_operation: {
    operation: string;
    invocations: number;
    errors: number;
    cost_usd: number;
    avg_cost_usd: number;
  }[];
  recent: {
    id: number;
    operation: string;
    agent_name: string;
    success: boolean;
    cost_usd: number | null;
    error_msg: string | null;
    rationale: string | null;
    template_id: number | null;
    target_template_id: number | null;
    created_by_name: string | null;
    created_at: string;
  }[];
}

const OPERATION_LABEL: Record<string, string> = {
  ADAPT_ORIENTATION: "Adaptar orientación",
  GENERATE_FROM_REFERENCE: "Generar desde referencia",
  GENERATE_FROM_PROMPT: "Crear con IA",
  ANIMATE_TEMPLATE: "Animar",
};

const usd = (n: number) => `USD ${n.toFixed(n >= 1 ? 2 : 4)}`;

export function AiCostsSummary({
  productionProjectId,
  refreshKey,
}: {
  productionProjectId: number;
  /** Cambiar este valor fuerza un refetch (ej. tras una invocación nueva). */
  refreshKey?: number | string;
}) {
  const [data, setData] = useState<AiCostsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const fetchCosts = useCallback(async () => {
    try {
      const res = await fetch(`/api/production/projects/${productionProjectId}/ai-costs`);
      if (res.ok) setData(await res.json());
    } catch (err) {
      console.error("Error obteniendo costos IA:", err);
    } finally {
      setLoading(false);
    }
  }, [productionProjectId]);

  useEffect(() => {
    fetchCosts();
  }, [fetchCosts, refreshKey]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        Cargando costos IA…
      </div>
    );
  }
  if (!data) return null;

  // Sin invocaciones: no vale la pena ocupar espacio con un panel vacío.
  if (data.total.invocations === 0) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5" />
        Este proyecto aún no ha usado el Banner Designer.
      </div>
    );
  }

  const errorRate = data.total.invocations
    ? Math.round((data.total.errors / data.total.invocations) * 100)
    : 0;

  return (
    <section className="rounded-lg border border-border/50 bg-card/40">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        <Sparkles className="h-4 w-4 text-primary shrink-0" />
        <span className="text-sm font-medium">Costos IA</span>
        <span className="text-sm tabular-nums">{usd(data.total.cost_usd)}</span>
        <span className="text-xs text-muted-foreground">
          · {data.total.invocations} {data.total.invocations === 1 ? "llamada" : "llamadas"}
        </span>
        <span className="text-xs text-muted-foreground hidden sm:inline">
          · últimos {data.period.days} días: {usd(data.period.cost_usd)} ({data.period.invocations})
        </span>
        {data.total.errors > 0 && (
          <span
            className={`ml-auto flex items-center gap-1 text-xs ${
              errorRate >= 30 ? "text-red-400" : "text-yellow-400"
            }`}
            title="Invocaciones que no devolvieron JSON válido tras los retries"
          >
            <AlertTriangle className="h-3.5 w-3.5" />
            {data.total.errors} {data.total.errors === 1 ? "error" : "errores"} ({errorRate}%)
          </span>
        )}
      </button>

      {open && (
        <div className="border-t border-border/50 px-4 py-3 space-y-4">
          {/* Por operación */}
          <div>
            <h4 className="text-xs font-medium text-muted-foreground mb-2">Por operación</h4>
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr>
                  <th className="text-left font-normal pb-1">Operación</th>
                  <th className="text-right font-normal pb-1">Llamadas</th>
                  <th className="text-right font-normal pb-1">Errores</th>
                  <th className="text-right font-normal pb-1">Promedio</th>
                  <th className="text-right font-normal pb-1">Total</th>
                </tr>
              </thead>
              <tbody>
                {data.by_operation.map((op) => (
                  <tr key={op.operation} className="border-t border-border/30">
                    <td className="py-1">{OPERATION_LABEL[op.operation] ?? op.operation}</td>
                    <td className="py-1 text-right tabular-nums">{op.invocations}</td>
                    <td className="py-1 text-right tabular-nums">
                      {op.errors > 0 ? (
                        <span className="text-yellow-400">{op.errors}</span>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className="py-1 text-right tabular-nums">{usd(op.avg_cost_usd)}</td>
                    <td className="py-1 text-right tabular-nums">{usd(op.cost_usd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[11px] text-muted-foreground mt-2">
              Tokens acumulados: {data.total.input_tokens.toLocaleString("es-CL")} entrada ·{" "}
              {data.total.output_tokens.toLocaleString("es-CL")} salida. Costo estimado por
              Practicante según pricing de Anthropic.
            </p>
          </div>

          {/* Últimas invocaciones */}
          <div>
            <h4 className="text-xs font-medium text-muted-foreground mb-2">
              Últimas invocaciones
            </h4>
            <ul className="space-y-1.5">
              {data.recent.map((inv) => (
                <li
                  key={inv.id}
                  className="text-xs rounded-md border border-border/30 px-3 py-2 space-y-0.5"
                >
                  <div className="flex items-center gap-2">
                    <span
                      className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                        inv.success ? "bg-green-400" : "bg-red-400"
                      }`}
                    />
                    <span className="font-medium">
                      {OPERATION_LABEL[inv.operation] ?? inv.operation}
                    </span>
                    {inv.template_id != null && (
                      <span className="text-muted-foreground">
                        tpl #{inv.template_id}
                        {inv.target_template_id != null && ` → #${inv.target_template_id}`}
                      </span>
                    )}
                    <span className="ml-auto tabular-nums">
                      {inv.cost_usd == null ? "—" : usd(inv.cost_usd)}
                    </span>
                    <span className="text-muted-foreground">
                      {formatDateLocal(inv.created_at)}
                      {inv.created_by_name ? ` · ${inv.created_by_name}` : ""}
                    </span>
                  </div>
                  {inv.success && inv.rationale && (
                    <p className="text-muted-foreground pl-3.5 line-clamp-2">{inv.rationale}</p>
                  )}
                  {!inv.success && inv.error_msg && (
                    <p className="text-red-400/80 pl-3.5 line-clamp-2">{inv.error_msg}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </section>
  );
}
