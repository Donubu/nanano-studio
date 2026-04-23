"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, TrendingUp, Wallet, Settings, ArrowDown, ArrowUp, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface WeekInfo {
  index: number;
  start: string;
  end: string;
  label: string;
}

interface ClientBucket {
  clientId: number;
  name: string;
  isInternal: boolean;
  perWeek: Record<string, number>;
  trackedTotal: number;
  proratedTotal: number;
  grandTotal: number;
}

interface UserBucket {
  userId: number;
  name: string;
  email: string | null;
  perWeek: Record<string, number>;
  trackedTotal: number;
  proratedTotal: number;
  grandTotal: number;
}

interface WeeklyReport {
  year: number;
  currency: "USD";
  weeks: WeekInfo[];
  clients: ClientBucket[];
  users: UserBucket[];
  totals: { tracked: number; infra: number; grand: number };
  globalSpentUsd: number;
}

interface BreakdownRow {
  id: number;
  name: string;
  subtitle?: string;
  italic?: boolean;
  badge?: string;
  perWeek: Record<string, number>;
  grandTotal: number;
}

interface MonthGroup {
  key: string;
  label: string;
  span: number;
}

function BreakdownTable({
  firstColLabel,
  weeks,
  monthGroups,
  rows,
  grandTotal,
  toDisplay,
}: {
  firstColLabel: string;
  weeks: WeekInfo[];
  monthGroups: MonthGroup[];
  rows: BreakdownRow[];
  grandTotal: number;
  toDisplay: (usd: number) => string;
}) {
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  const sortedRows = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) =>
      sortDir === "desc" ? b.grandTotal - a.grandTotal : a.grandTotal - b.grandTotal
    );
    return arr;
  }, [rows, sortDir]);

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm border-collapse [&_th]:border [&_td]:border [&_th]:border-border/60 [&_td]:border-border/60">
        <thead>
          <tr className="border-b">
            <th
              rowSpan={2}
              className="sticky left-0 bg-background text-left font-medium px-3 py-2 min-w-[200px] z-10 align-bottom"
            >
              {firstColLabel}
            </th>
            {monthGroups.map((g, i) => (
              <th
                key={g.key}
                colSpan={g.span}
                className={`text-center text-xs font-semibold uppercase tracking-wide px-2 py-1.5 whitespace-nowrap border-b border-border/60 ${
                  i % 2 === 0
                    ? "bg-indigo-200 dark:bg-indigo-900 text-indigo-950 dark:text-indigo-100"
                    : "bg-amber-200 dark:bg-amber-900 text-amber-950 dark:text-amber-100"
                }`}
              >
                {g.label}
              </th>
            ))}
            <th
              rowSpan={2}
              className="text-right font-semibold px-3 py-2 whitespace-nowrap bg-muted align-bottom cursor-pointer select-none hover:bg-muted/80"
              onClick={() => setSortDir((d) => (d === "desc" ? "asc" : "desc"))}
              title="Ordenar por total"
            >
              <span className="inline-flex items-center gap-1">
                Total
                {sortDir === "desc" ? (
                  <ArrowDown className="h-3.5 w-3.5" />
                ) : (
                  <ArrowUp className="h-3.5 w-3.5" />
                )}
              </span>
            </th>
          </tr>
          <tr className="border-b">
            {weeks.map((w) => (
              <th
                key={w.start}
                className={`text-right font-medium px-2 py-2 whitespace-nowrap text-slate-900 dark:text-slate-100 ${
                  w.index % 2 === 0
                    ? "bg-slate-300 dark:bg-slate-700"
                    : "bg-slate-200 dark:bg-slate-800"
                }`}
                title={`${w.start} → ${w.end}`}
              >
                S{w.index}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((r) => (
            <tr key={r.id} className="border-b hover:bg-muted/30">
              <td className="sticky left-0 bg-background px-3 py-2 font-medium z-10">
                <div className="flex flex-col">
                  <div className="flex items-center gap-2">
                    <span className={r.italic ? "text-muted-foreground italic" : ""}>{r.name}</span>
                    {r.badge && (
                      <span className="text-[10px] bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded">
                        {r.badge}
                      </span>
                    )}
                  </div>
                  {r.subtitle && (
                    <span className="text-[11px] text-muted-foreground">{r.subtitle}</span>
                  )}
                </div>
              </td>
              {weeks.map((w) => {
                const val = r.perWeek[w.start] || 0;
                return (
                  <td
                    key={w.start}
                    className={`text-right px-2 py-2 whitespace-nowrap ${
                      w.index % 2 === 0 ? "bg-muted/20" : ""
                    } ${val === 0 ? "text-muted-foreground/40" : ""}`}
                  >
                    {val === 0 ? "—" : toDisplay(val)}
                  </td>
                );
              })}
              <td className="text-right px-3 py-2 font-semibold whitespace-nowrap bg-muted/50">
                {toDisplay(r.grandTotal)}
              </td>
            </tr>
          ))}
          {/* Fila de totales por semana */}
          <tr className="border-t-2 font-semibold bg-muted/40">
            <td className="sticky left-0 bg-muted/40 px-3 py-2 z-10">TOTAL</td>
            {weeks.map((w) => {
              const weekTotal = rows.reduce((s, r) => s + (r.perWeek[w.start] || 0), 0);
              return (
                <td
                  key={w.start}
                  className={`text-right px-2 py-2 whitespace-nowrap ${
                    w.index % 2 === 0 ? "bg-muted/60" : ""
                  } ${weekTotal === 0 ? "text-muted-foreground/40" : ""}`}
                >
                  {weekTotal === 0 ? "—" : toDisplay(weekTotal)}
                </td>
              );
            })}
            <td className="text-right px-3 py-2 whitespace-nowrap bg-muted">
              {toDisplay(grandTotal)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

interface FinanceSettings {
  available_balance_usd: number | null;
  usd_clp_rate: number | null;
}

const CURRENT_YEAR = new Date().getFullYear();
const YEAR_OPTIONS = [CURRENT_YEAR - 2, CURRENT_YEAR - 1, CURRENT_YEAR];

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtClp(n: number): string {
  return `$${Math.round(n).toLocaleString("es-CL")}`;
}

export default function WeeklyReportPage() {
  const [year, setYear] = useState<number>(CURRENT_YEAR);
  const [currency, setCurrency] = useState<"USD" | "CLP">("USD");
  const [rateStr, setRateStr] = useState<string>("");
  const [balanceUsd, setBalanceUsd] = useState<number | null>(null);
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const rate = useMemo(() => {
    const n = Number(rateStr);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }, [rateStr]);

  const fetchSettings = useCallback(async () => {
    const res = await fetch("/api/settings/finance");
    if (!res.ok) return;
    const data: FinanceSettings = await res.json();
    setBalanceUsd(data.available_balance_usd);
    if (data.usd_clp_rate != null) setRateStr(String(data.usd_clp_rate));
  }, []);

  const fetchReport = useCallback(async (y: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/dashboard/analytics/weekly?year=${y}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: WeeklyReport = await res.json();
      setReport(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error cargando reporte");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    void fetchReport(year);
  }, [year, fetchReport]);

  // Rows para la tabla de clientes (shape unificado de BreakdownTable)
  const clientRows: BreakdownRow[] = useMemo(() => {
    if (!report) return [];
    return report.clients.map((c) => ({
      id: c.clientId,
      name: c.name,
      italic: c.clientId === 0,
      badge: c.isInternal ? "interno" : undefined,
      perWeek: c.perWeek,
      grandTotal: c.grandTotal,
    }));
  }, [report]);

  // Rows para la tabla de usuarios
  const userRows: BreakdownRow[] = useMemo(() => {
    if (!report) return [];
    return report.users.map((u) => ({
      id: u.userId,
      name: u.name,
      subtitle: u.email ?? undefined,
      perWeek: u.perWeek,
      grandTotal: u.grandTotal,
    }));
  }, [report]);

  // Agrupa semanas por mes (del lunes w.start) para encabezado de cortes mensuales
  const monthGroups = useMemo(() => {
    if (!report) return [];
    const MONTHS_ES = [
      "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
      "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
    ];
    const groups: { key: string; label: string; span: number }[] = [];
    for (const w of report.weeks) {
      const key = w.start.slice(0, 7); // YYYY-MM
      const monthIdx = Number(w.start.slice(5, 7)) - 1;
      if (groups.length === 0 || groups[groups.length - 1].key !== key) {
        groups.push({ key, label: MONTHS_ES[monthIdx] ?? key, span: 1 });
      } else {
        groups[groups.length - 1].span++;
      }
    }
    return groups;
  }, [report]);

  // Conversión según currency actual
  const toDisplay = useCallback(
    (usd: number): string => {
      if (currency === "USD") return fmtUsd(usd);
      if (rate <= 0) return "—";
      return fmtClp(usd * rate);
    },
    [currency, rate]
  );

  const remainingUsd = balanceUsd != null && report ? balanceUsd - report.globalSpentUsd : null;

  const printSection = useCallback((mode: "clients" | "users" | "both") => {
    const cls = `print-${mode}`;
    document.body.classList.add(cls);
    const cleanup = () => {
      document.body.classList.remove(cls);
      window.removeEventListener("afterprint", cleanup);
    };
    window.addEventListener("afterprint", cleanup);
    // requestAnimationFrame asegura que la clase se aplique antes del diálogo de impresión
    requestAnimationFrame(() => window.print());
  }, []);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-2">
            <TrendingUp className="h-7 w-7 text-primary" />
            Reporte Semanal por Cliente
          </h1>
          <p className="text-muted-foreground mt-1">
            Costo por cliente y semana (incluye infra GCP prorateada).
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => printSection("both")}
            disabled={!report || loading}
            title="Descargar ambas tablas en un mismo PDF"
          >
            <FileDown className="h-4 w-4 mr-2" />
            Ambas tablas (PDF)
          </Button>
          <Link href="/dashboard/settings/finance">
            <Button variant="outline" size="sm">
              <Settings className="h-4 w-4 mr-2" />
              Ajustes Financieros
            </Button>
          </Link>
        </div>
      </div>

      {/* Controls */}
      <Card data-print-section="controls">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="year">Año</Label>
              <select
                id="year"
                value={year}
                onChange={(e) => setYear(Number(e.target.value))}
                className="h-9 w-28 rounded-md border border-input bg-background px-3 text-sm"
              >
                {YEAR_OPTIONS.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label>Moneda</Label>
              <div className="inline-flex rounded-md border border-input overflow-hidden">
                <button
                  type="button"
                  onClick={() => setCurrency("USD")}
                  className={`px-4 h-9 text-sm ${
                    currency === "USD" ? "bg-primary text-primary-foreground" : "bg-background"
                  }`}
                >
                  USD
                </button>
                <button
                  type="button"
                  onClick={() => setCurrency("CLP")}
                  className={`px-4 h-9 text-sm ${
                    currency === "CLP" ? "bg-primary text-primary-foreground" : "bg-background"
                  }`}
                >
                  CLP
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="rate">Tasa USD→CLP</Label>
              <Input
                id="rate"
                type="number"
                step="0.01"
                min="0"
                value={rateStr}
                onChange={(e) => setRateStr(e.target.value)}
                placeholder="Ej: 920"
                className="w-32"
              />
            </div>

            {currency === "CLP" && rate <= 0 && (
              <p className="text-xs text-amber-600 dark:text-amber-500 self-center">
                Ingresa una tasa válida para ver valores en CLP.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Saldo */}
      <Card data-print-section="balance">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Saldo
          </CardTitle>
        </CardHeader>
        <CardContent>
          {balanceUsd == null ? (
            <p className="text-sm text-muted-foreground">
              Sin saldo configurado.{" "}
              <Link href="/dashboard/settings/finance" className="text-primary underline">
                Configúralo aquí
              </Link>
              .
            </p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Disponible</p>
                <p className="text-2xl font-bold">{toDisplay(balanceUsd)}</p>
                {currency === "CLP" && rate > 0 && (
                  <p className="text-xs text-muted-foreground">{fmtUsd(balanceUsd)}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">
                  Gastado (histórico)
                </p>
                <p className="text-2xl font-bold">
                  {report ? toDisplay(report.globalSpentUsd) : "—"}
                </p>
                {report && currency === "CLP" && rate > 0 && (
                  <p className="text-xs text-muted-foreground">{fmtUsd(report.globalSpentUsd)}</p>
                )}
              </div>
              <div>
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Restante</p>
                <p
                  className={`text-2xl font-bold ${
                    remainingUsd != null && remainingUsd < 0 ? "text-destructive" : ""
                  }`}
                >
                  {remainingUsd != null ? toDisplay(remainingUsd) : "—"}
                </p>
                {remainingUsd != null && currency === "CLP" && rate > 0 && (
                  <p className="text-xs text-muted-foreground">{fmtUsd(remainingUsd)}</p>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tabla clientes */}
      <Card data-print-section="clients">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Desglose por cliente · Año {year}</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => printSection("clients")}
            disabled={!report || loading}
            className="no-print"
          >
            <FileDown className="h-4 w-4 mr-2" />
            PDF
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : !report || report.weeks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin datos para este año.</p>
          ) : (
            <BreakdownTable
              firstColLabel="Cliente"
              weeks={report.weeks}
              monthGroups={monthGroups}
              rows={clientRows}
              grandTotal={report.totals.grand}
              toDisplay={toDisplay}
            />
          )}
        </CardContent>
      </Card>

      {/* Tabla usuarios */}
      <Card data-print-section="users">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Desglose por usuario · Año {year}</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => printSection("users")}
            disabled={!report || loading}
            className="no-print"
          >
            <FileDown className="h-4 w-4 mr-2" />
            PDF
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : !report || report.weeks.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin datos para este año.</p>
          ) : (
            <BreakdownTable
              firstColLabel="Usuario"
              weeks={report.weeks}
              monthGroups={monthGroups}
              rows={userRows}
              grandTotal={report.totals.grand}
              toDisplay={toDisplay}
            />
          )}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground no-print" data-print-section="notes">
        Tracked: {report ? fmtUsd(report.totals.tracked) : "—"} · Infra prorrateada:{" "}
        {report ? fmtUsd(report.totals.infra) : "—"}. La infra GCP (Cloud SQL, Compute, Storage,
        Support, etc.) se reparte entre clientes según su % de consumo estimado de IA dentro de cada
        semana. Los costos están en USD; la tasa a CLP es solo visual.
      </p>

      <style
        dangerouslySetInnerHTML={{
          __html: `
@media print {
  @page { size: A4 landscape; margin: 10mm; }
  body { background: white !important; }
  /* Oculta chrome del dashboard */
  header, aside, nav[class*="sidebar"] { display: none !important; }
  main { padding: 0 !important; }
  .no-print { display: none !important; }

  /* Ocultar secciones según la clase activa en body */
  body.print-clients [data-print-section="users"],
  body.print-clients [data-print-section="controls"],
  body.print-clients [data-print-section="balance"],
  body.print-clients [data-print-section="notes"] { display: none !important; }

  body.print-users [data-print-section="clients"],
  body.print-users [data-print-section="controls"],
  body.print-users [data-print-section="balance"],
  body.print-users [data-print-section="notes"] { display: none !important; }

  body.print-both [data-print-section="controls"],
  body.print-both [data-print-section="notes"] { display: none !important; }
  body.print-both [data-print-section="clients"] { page-break-after: always; break-after: page; }

  /* Mostrar la tabla completa sin scroll horizontal y en tamaño reducido para fit */
  [data-print-section] .overflow-x-auto { overflow: visible !important; }
  [data-print-section] table { font-size: 8px !important; }
  [data-print-section] table th,
  [data-print-section] table td { padding: 2px 4px !important; }
  /* Mantener fondos de color en impresión */
  [data-print-section] * {
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }
}
`,
        }}
      />
    </div>
  );
}
