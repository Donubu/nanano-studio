"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Loader2,
  TrendingUp,
  Wallet,
  Settings,
  ArrowDown,
  ArrowUp,
  FileDown,
  ImageIcon,
  Video,
  FileText,
  Volume2,
  Music,
} from "lucide-react";
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

interface PieceCounts {
  images: number;
  videos: number;
  texts: number;
  audios: number;
  music: number;
}

interface ClientBucket {
  clientId: number;
  name: string;
  isInternal: boolean;
  perWeek: Record<string, number>;
  countsPerWeek: Record<string, PieceCounts>;
  trackedTotal: number;
  proratedTotal: number;
  grandTotal: number;
  countsTotal: PieceCounts;
}

interface UserBucket {
  userId: number;
  name: string;
  email: string | null;
  perWeek: Record<string, number>;
  countsPerWeek: Record<string, PieceCounts>;
  trackedTotal: number;
  proratedTotal: number;
  grandTotal: number;
  countsTotal: PieceCounts;
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
  countsPerWeek: Record<string, PieceCounts>;
  grandTotal: number;
  countsTotal: PieceCounts;
}

const EMPTY_COUNTS: PieceCounts = { images: 0, videos: 0, texts: 0, audios: 0, music: 0 };

function addCounts(a: PieceCounts, b: PieceCounts): PieceCounts {
  return {
    images: a.images + b.images,
    videos: a.videos + b.videos,
    texts: a.texts + b.texts,
    audios: a.audios + b.audios,
    music: a.music + b.music,
  };
}

function CountsRow({ c }: { c: PieceCounts }) {
  const items: Array<{ key: keyof PieceCounts; icon: typeof ImageIcon }> = [
    { key: "images", icon: ImageIcon },
    { key: "videos", icon: Video },
    { key: "texts", icon: FileText },
    { key: "audios", icon: Volume2 },
    { key: "music", icon: Music },
  ];
  const any = items.some((it) => c[it.key] > 0);
  if (!any) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] text-muted-foreground font-normal">
      {items.map((it) =>
        c[it.key] > 0 ? (
          <span key={it.key} className="inline-flex items-center gap-0.5">
            <it.icon className="h-3 w-3" />
            {c[it.key]}
          </span>
        ) : null
      )}
    </span>
  );
}

function CountsLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span className="font-medium">Piezas:</span>
      <span className="inline-flex items-center gap-1">
        <ImageIcon className="h-3.5 w-3.5" /> imágenes
      </span>
      <span className="inline-flex items-center gap-1">
        <Video className="h-3.5 w-3.5" /> videos
      </span>
      <span className="inline-flex items-center gap-1">
        <FileText className="h-3.5 w-3.5" /> textos
      </span>
      <span className="inline-flex items-center gap-1">
        <Volume2 className="h-3.5 w-3.5" /> audios
      </span>
      <span className="inline-flex items-center gap-1">
        <Music className="h-3.5 w-3.5" /> música
      </span>
    </div>
  );
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
  showCounts,
  rangeFrom,
  rangeTo,
  showSubtotal,
}: {
  firstColLabel: string;
  weeks: WeekInfo[];
  monthGroups: MonthGroup[];
  rows: BreakdownRow[];
  grandTotal: number;
  toDisplay: (usd: number) => string;
  showCounts: boolean;
  rangeFrom?: string;
  rangeTo?: string;
  showSubtotal?: boolean;
}) {
  const [sortKey, setSortKey] = useState<"subtotal" | "total">("total");
  const [sortDir, setSortDir] = useState<"desc" | "asc">("desc");

  const isInRange = useCallback(
    (weekStart: string) => {
      if (!rangeFrom || !rangeTo) return false;
      return weekStart >= rangeFrom && weekStart <= rangeTo;
    },
    [rangeFrom, rangeTo]
  );

  const subtotalForRow = useCallback(
    (r: BreakdownRow): number => {
      if (!rangeFrom || !rangeTo) return 0;
      let sum = 0;
      for (const w of weeks) {
        if (isInRange(w.start)) sum += r.perWeek[w.start] || 0;
      }
      return sum;
    },
    [rangeFrom, rangeTo, weeks, isInRange]
  );

  const subtotalCountsForRow = useCallback(
    (r: BreakdownRow): PieceCounts => {
      if (!rangeFrom || !rangeTo) return EMPTY_COUNTS;
      let acc: PieceCounts = { ...EMPTY_COUNTS };
      for (const w of weeks) {
        if (isInRange(w.start)) {
          const c = r.countsPerWeek[w.start];
          if (c) acc = addCounts(acc, c);
        }
      }
      return acc;
    },
    [rangeFrom, rangeTo, weeks, isInRange]
  );

  const sortedRows = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) => {
      const aVal = sortKey === "subtotal" ? subtotalForRow(a) : a.grandTotal;
      const bVal = sortKey === "subtotal" ? subtotalForRow(b) : b.grandTotal;
      return sortDir === "desc" ? bVal - aVal : aVal - bVal;
    });
    return arr;
  }, [rows, sortKey, sortDir, subtotalForRow]);

  const onSortClick = (key: "subtotal" | "total") => {
    if (sortKey === key) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  };

  const subtotalGrand = useMemo(
    () => (showSubtotal ? rows.reduce((s, r) => s + subtotalForRow(r), 0) : 0),
    [rows, showSubtotal, subtotalForRow]
  );

  const subtotalGrandCounts = useMemo(
    () =>
      showSubtotal
        ? rows.reduce((s, r) => addCounts(s, subtotalCountsForRow(r)), { ...EMPTY_COUNTS })
        : EMPTY_COUNTS,
    [rows, showSubtotal, subtotalCountsForRow]
  );

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
            {showSubtotal && (
              <th
                rowSpan={2}
                className="text-right font-semibold px-3 py-2 whitespace-nowrap bg-amber-100 dark:bg-amber-950 align-bottom cursor-pointer select-none hover:bg-amber-200 dark:hover:bg-amber-900"
                onClick={() => onSortClick("subtotal")}
                title="Ordenar por subtotal del rango"
              >
                <span className="inline-flex items-center gap-1">
                  Subtotal
                  {sortKey === "subtotal" &&
                    (sortDir === "desc" ? (
                      <ArrowDown className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowUp className="h-3.5 w-3.5" />
                    ))}
                </span>
              </th>
            )}
            <th
              rowSpan={2}
              className="text-right font-semibold px-3 py-2 whitespace-nowrap bg-muted align-bottom cursor-pointer select-none hover:bg-muted/80"
              onClick={() => onSortClick("total")}
              title="Ordenar por total"
            >
              <span className="inline-flex items-center gap-1">
                Total
                {sortKey === "total" &&
                  (sortDir === "desc" ? (
                    <ArrowDown className="h-3.5 w-3.5" />
                  ) : (
                    <ArrowUp className="h-3.5 w-3.5" />
                  ))}
              </span>
            </th>
          </tr>
          <tr className="border-b">
            {weeks.map((w) => {
              const inRange = isInRange(w.start);
              return (
                <th
                  key={w.start}
                  className={`text-right font-medium px-2 py-2 whitespace-nowrap text-slate-900 dark:text-slate-100 ${
                    inRange
                      ? "bg-amber-200 dark:bg-amber-900 ring-1 ring-amber-400 dark:ring-amber-700"
                      : w.index % 2 === 0
                      ? "bg-slate-300 dark:bg-slate-700"
                      : "bg-slate-200 dark:bg-slate-800"
                  }`}
                  title={`${w.start} → ${w.end}`}
                >
                  S{w.index}
                </th>
              );
            })}
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
                const counts = r.countsPerWeek[w.start] || EMPTY_COUNTS;
                const inRange = isInRange(w.start);
                return (
                  <td
                    key={w.start}
                    className={`text-right px-2 py-2 whitespace-nowrap ${
                      inRange
                        ? "bg-amber-50 dark:bg-amber-950/40"
                        : w.index % 2 === 0
                        ? "bg-muted/20"
                        : ""
                    } ${val === 0 ? "text-muted-foreground/40" : ""}`}
                  >
                    <div className="flex flex-col items-end leading-tight">
                      <span>{val === 0 ? "—" : toDisplay(val)}</span>
                      {showCounts && <CountsRow c={counts} />}
                    </div>
                  </td>
                );
              })}
              {showSubtotal && (
                <td className="text-right px-3 py-2 font-semibold whitespace-nowrap bg-amber-100/70 dark:bg-amber-950/60">
                  {(() => {
                    const sub = subtotalForRow(r);
                    return (
                      <div className="flex flex-col items-end leading-tight">
                        <span className={sub === 0 ? "text-muted-foreground/60" : ""}>
                          {sub === 0 ? "—" : toDisplay(sub)}
                        </span>
                        {showCounts && <CountsRow c={subtotalCountsForRow(r)} />}
                      </div>
                    );
                  })()}
                </td>
              )}
              <td className="text-right px-3 py-2 font-semibold whitespace-nowrap bg-muted/50">
                <div className="flex flex-col items-end leading-tight">
                  <span>{toDisplay(r.grandTotal)}</span>
                  {showCounts && <CountsRow c={r.countsTotal} />}
                </div>
              </td>
            </tr>
          ))}
          {/* Fila de totales por semana */}
          <tr className="border-t-2 font-semibold bg-muted/40">
            <td className="sticky left-0 bg-muted/40 px-3 py-2 z-10">TOTAL</td>
            {weeks.map((w) => {
              const weekTotal = rows.reduce((s, r) => s + (r.perWeek[w.start] || 0), 0);
              const weekCounts = rows.reduce(
                (s, r) => addCounts(s, r.countsPerWeek[w.start] || EMPTY_COUNTS),
                EMPTY_COUNTS
              );
              const inRange = isInRange(w.start);
              return (
                <td
                  key={w.start}
                  className={`text-right px-2 py-2 whitespace-nowrap ${
                    inRange
                      ? "bg-amber-100 dark:bg-amber-900/60"
                      : w.index % 2 === 0
                      ? "bg-muted/60"
                      : ""
                  } ${weekTotal === 0 ? "text-muted-foreground/40" : ""}`}
                >
                  <div className="flex flex-col items-end leading-tight">
                    <span>{weekTotal === 0 ? "—" : toDisplay(weekTotal)}</span>
                    {showCounts && <CountsRow c={weekCounts} />}
                  </div>
                </td>
              );
            })}
            {showSubtotal && (
              <td className="text-right px-3 py-2 whitespace-nowrap bg-amber-200 dark:bg-amber-900">
                <div className="flex flex-col items-end leading-tight">
                  <span>{toDisplay(subtotalGrand)}</span>
                  {showCounts && <CountsRow c={subtotalGrandCounts} />}
                </div>
              </td>
            )}
            <td className="text-right px-3 py-2 whitespace-nowrap bg-muted">
              <div className="flex flex-col items-end leading-tight">
                <span>{toDisplay(grandTotal)}</span>
                {showCounts && (
                  <CountsRow
                    c={rows.reduce((s, r) => addCounts(s, r.countsTotal), EMPTY_COUNTS)}
                  />
                )}
              </div>
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

function rangeLabel(report: WeeklyReport | null, weekStart: string): string {
  const w = report?.weeks.find((x) => x.start === weekStart);
  return w ? `S${w.index}` : weekStart;
}

export default function WeeklyReportPage() {
  const [year, setYear] = useState<number>(CURRENT_YEAR);
  const [currency, setCurrency] = useState<"USD" | "CLP">("USD");
  const [rateStr, setRateStr] = useState<string>("");
  const [balanceUsd, setBalanceUsd] = useState<number | null>(null);
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCounts, setShowCounts] = useState(true);
  const [weekFrom, setWeekFrom] = useState<string>("");
  const [weekTo, setWeekTo] = useState<string>("");

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

  // Reinicia el rango cuando cambia el reporte (cambio de año o recarga).
  useEffect(() => {
    if (report && report.weeks.length > 0) {
      setWeekFrom(report.weeks[0].start);
      setWeekTo(report.weeks[report.weeks.length - 1].start);
    } else {
      setWeekFrom("");
      setWeekTo("");
    }
  }, [report]);

  // Normaliza el rango (asegura from <= to) y detecta si cubre el año entero.
  const effectiveRange = useMemo(() => {
    if (!report || report.weeks.length === 0 || !weekFrom || !weekTo) return null;
    const from = weekFrom <= weekTo ? weekFrom : weekTo;
    const to = weekFrom <= weekTo ? weekTo : weekFrom;
    return { from, to };
  }, [report, weekFrom, weekTo]);

  const rangeIsFull = useMemo(() => {
    if (!report || !effectiveRange) return true;
    return (
      effectiveRange.from === report.weeks[0].start &&
      effectiveRange.to === report.weeks[report.weeks.length - 1].start
    );
  }, [report, effectiveRange]);

  const showSubtotal = !rangeIsFull && !!effectiveRange;

  // Subtotal global del rango (suma tracked + prorrateo de las semanas en rango).
  const rangeSubtotal = useMemo(() => {
    if (!report || !effectiveRange) return 0;
    let sum = 0;
    for (const w of report.weeks) {
      if (w.start >= effectiveRange.from && w.start <= effectiveRange.to) {
        sum += report.clients.reduce((s, c) => s + (c.perWeek[w.start] || 0), 0);
      }
    }
    return sum;
  }, [report, effectiveRange]);

  const resetRange = useCallback(() => {
    if (report && report.weeks.length > 0) {
      setWeekFrom(report.weeks[0].start);
      setWeekTo(report.weeks[report.weeks.length - 1].start);
    }
  }, [report]);

  // Rows para la tabla de clientes (shape unificado de BreakdownTable)
  const clientRows: BreakdownRow[] = useMemo(() => {
    if (!report) return [];
    return report.clients.map((c) => ({
      id: c.clientId,
      name: c.name,
      italic: c.clientId === 0,
      badge: c.isInternal ? "interno" : undefined,
      perWeek: c.perWeek,
      countsPerWeek: c.countsPerWeek,
      grandTotal: c.grandTotal,
      countsTotal: c.countsTotal,
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
      countsPerWeek: u.countsPerWeek,
      grandTotal: u.grandTotal,
      countsTotal: u.countsTotal,
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
              <Label htmlFor="week-from">Desde semana</Label>
              <select
                id="week-from"
                value={weekFrom}
                onChange={(e) => setWeekFrom(e.target.value)}
                disabled={!report || report.weeks.length === 0}
                className="h-9 max-w-[260px] rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
              >
                {report?.weeks.map((w) => (
                  <option key={w.start} value={w.start}>
                    {w.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="week-to">Hasta semana</Label>
              <select
                id="week-to"
                value={weekTo}
                onChange={(e) => setWeekTo(e.target.value)}
                disabled={!report || report.weeks.length === 0}
                className="h-9 max-w-[260px] rounded-md border border-input bg-background px-3 text-sm disabled:opacity-50"
              >
                {report?.weeks.map((w) => (
                  <option key={w.start} value={w.start}>
                    {w.label}
                  </option>
                ))}
              </select>
            </div>

            {showSubtotal && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={resetRange}
                className="self-end h-9"
              >
                Año completo
              </Button>
            )}

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

            <div className="space-y-1.5">
              <Label>Piezas generadas</Label>
              <div className="inline-flex rounded-md border border-input overflow-hidden">
                <button
                  type="button"
                  onClick={() => setShowCounts(true)}
                  className={`px-3 h-9 text-sm ${
                    showCounts ? "bg-primary text-primary-foreground" : "bg-background"
                  }`}
                  title="Imagenes | Videos | Textos | Audios | Música"
                >
                  Mostrar
                </button>
                <button
                  type="button"
                  onClick={() => setShowCounts(false)}
                  className={`px-3 h-9 text-sm ${
                    !showCounts ? "bg-primary text-primary-foreground" : "bg-background"
                  }`}
                >
                  Ocultar
                </button>
              </div>
            </div>
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

      {showCounts && (
        <div className="no-print">
          <CountsLegend />
        </div>
      )}

      {/* Tabla clientes */}
      <Card data-print-section="clients">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Desglose por cliente · Año {year}</CardTitle>
            {showSubtotal && effectiveRange && (
              <p className="text-xs text-muted-foreground mt-1" data-range-subtitle>
                Subtotal rango{" "}
                <span className="font-medium">
                  {rangeLabel(report, effectiveRange.from)} → {rangeLabel(report, effectiveRange.to)}
                </span>
                : <span className="font-semibold text-foreground">{toDisplay(rangeSubtotal)}</span>
                {" · "}
                Total año: <span className="font-semibold text-foreground">{toDisplay(report?.totals.grand ?? 0)}</span>
              </p>
            )}
          </div>
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
              showCounts={showCounts}
              rangeFrom={effectiveRange?.from}
              rangeTo={effectiveRange?.to}
              showSubtotal={showSubtotal}
            />
          )}
        </CardContent>
      </Card>

      {/* Tabla usuarios */}
      <Card data-print-section="users">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Desglose por usuario · Año {year}</CardTitle>
            {showSubtotal && effectiveRange && (
              <p className="text-xs text-muted-foreground mt-1" data-range-subtitle>
                Subtotal rango{" "}
                <span className="font-medium">
                  {rangeLabel(report, effectiveRange.from)} → {rangeLabel(report, effectiveRange.to)}
                </span>
                : <span className="font-semibold text-foreground">{toDisplay(rangeSubtotal)}</span>
                {" · "}
                Total año: <span className="font-semibold text-foreground">{toDisplay(report?.totals.grand ?? 0)}</span>
              </p>
            )}
          </div>
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
              showCounts={showCounts}
              rangeFrom={effectiveRange?.from}
              rangeTo={effectiveRange?.to}
              showSubtotal={showSubtotal}
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
  /* Asegura que el subtítulo del rango sea legible incluso en dark mode */
  [data-print-section] [data-range-subtitle],
  [data-print-section] [data-range-subtitle] * { color: #1f2937 !important; }
}
`,
        }}
      />
    </div>
  );
}
