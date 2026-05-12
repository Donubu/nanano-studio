"use client";

import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Loader2,
  DollarSign,
  RefreshCw,
  Cloud,
  Calendar,
  AlertCircle,
  CheckCircle,
  TrendingUp,
} from "lucide-react";
import {
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface ServiceCost {
  service_id: string;
  service_description: string;
  total_cost: number;
}

interface DailyTotal {
  date: string;
  total_cost: number;
}

interface Summary {
  today: number;
  yesterday: number;
  thisMonth: number;
  lastMonth: number;
  byService: ServiceCost[];
}

interface LastSync {
  lastSync: string | null;
  status: string | null;
  recordsSynced: number;
}

interface SummaryResponse {
  configured: boolean;
  message?: string;
  summary?: Summary;
  dailyTotals?: DailyTotal[];
  lastSync?: LastSync | null;
}

const COLORS = ["#8b5cf6", "#06b6d4", "#10b981", "#f59e0b", "#ec4899", "#3b82f6", "#ef4444", "#84cc16"];

type PeriodType = "1" | "7" | "30" | "90" | "all" | "custom";

export default function BillingPage() {
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [period, setPeriod] = useState<PeriodType>("30");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const fetchData = useCallback(async () => {
    try {
      let url = `/api/admin/gcp-costs/summary?period=${period}`;
      if (period === "custom" && dateFrom && dateTo) {
        url = `/api/admin/gcp-costs/summary?period=custom&date_from=${dateFrom}&date_to=${dateTo}`;
      }
      const res = await fetch(url);
      if (res.ok) {
        const result = await res.json();
        setData(result);
      }
    } catch (err) {
      console.error("Error fetching billing data:", err);
    } finally {
      setLoading(false);
    }
  }, [period, dateFrom, dateTo]);

  useEffect(() => {
    if (period === "custom" && (!dateFrom || !dateTo)) return;
    fetchData();
  }, [fetchData]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncError(null);
    try {
      // Para "all" o "custom" el sync no puede traer infinito: la API capa en 30.
      const syncDays = period === "all" || period === "custom" ? "30" : period;
      const res = await fetch(`/api/admin/gcp-costs/sync?days=${syncDays}`, {
        method: "POST",
      });
      const result = await res.json();
      if (res.ok) {
        // Refresh data after sync
        await fetchData();
      } else {
        const errorMsg = result.details || result.error || "Error desconocido al sincronizar";
        console.error("Sync error:", result);
        setSyncError(errorMsg);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : "Error de conexión";
      console.error("Error syncing:", err);
      setSyncError(errorMsg);
    } finally {
      setSyncing(false);
    }
  };

  const formatCost = (cost: number) => {
    if (cost === 0) return "$0.00";
    if (Math.abs(cost) < 0.01) return `$${cost.toFixed(4)}`;
    if (Math.abs(cost) < 1) return `$${cost.toFixed(3)}`;
    return `$${cost.toFixed(2)}`;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString("es-CL", { month: "short", day: "numeric" });
  };

  const formatLastSync = (dateStr: string | null) => {
    if (!dateStr) return "Nunca";
    const date = new Date(dateStr);
    return date.toLocaleString("es-CL", {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getServiceName = (description: string) => {
    // Shorten long service names
    const nameMap: Record<string, string> = {
      "Cloud AI Platform": "Vertex AI",
      "Cloud Storage": "Storage",
      "BigQuery": "BigQuery",
      "Cloud Text-to-Speech API": "Text-to-Speech",
      "Generative Language API": "Gemini API",
    };
    return nameMap[description] || description.replace("Cloud ", "").replace(" API", "");
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  // Not configured state
  if (!data?.configured) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cloud className="h-6 w-6 text-primary" />
            Facturación GCP
          </h1>
          <p className="text-muted-foreground">
            Costos de Google Cloud Platform
          </p>
        </div>

        <Card className="bg-card border-border/50">
          <CardContent className="pt-6">
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <AlertCircle className="h-16 w-16 text-amber-400 mb-4" />
              <h3 className="text-lg font-medium mb-2">Configuración Requerida</h3>
              <p className="text-muted-foreground max-w-md mb-6">
                Para ver los costos de GCP, debes habilitar el export de billing a BigQuery en la consola de Google Cloud.
              </p>
              <div className="text-left bg-muted p-4 rounded-lg text-sm">
                <p className="font-medium mb-2">Pasos:</p>
                <ol className="list-decimal list-inside space-y-1 text-muted-foreground">
                  <li>Crear un dataset en BigQuery llamado <code className="bg-background px-1 rounded">billing_export</code></li>
                  <li>Ir a Billing → Billing export en GCP Console</li>
                  <li>Habilitar "Standard usage cost" export</li>
                  <li>Esperar 24-48 horas para datos iniciales</li>
                </ol>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const summary = data.summary;
  const dailyTotals = data.dailyTotals || [];
  const lastSync = data.lastSync;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Cloud className="h-6 w-6 text-primary" />
            Facturación GCP
          </h1>
          <p className="text-muted-foreground">
            Costos de Google Cloud Platform
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Last sync info */}
          <div className="text-right text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              {lastSync?.status === "success" ? (
                <CheckCircle className="h-3 w-3 text-green-400" />
              ) : (
                <AlertCircle className="h-3 w-3 text-amber-400" />
              )}
              Última sync: {formatLastSync(lastSync?.lastSync || null)}
            </div>
            {lastSync?.recordsSynced !== undefined && (
              <div>{lastSync.recordsSynced} registros</div>
            )}
          </div>

          {/* Period selector */}
          <Select value={period} onValueChange={(v) => setPeriod(v as PeriodType)}>
            <SelectTrigger className="w-[120px] bg-muted border-border/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="1">Hoy</SelectItem>
              <SelectItem value="7">7 días</SelectItem>
              <SelectItem value="30">30 días</SelectItem>
              <SelectItem value="90">90 días</SelectItem>
              <SelectItem value="all">Todo el tiempo</SelectItem>
              <SelectItem value="custom">Rango</SelectItem>
            </SelectContent>
          </Select>
          {period === "custom" && (
            <div className="flex items-center gap-1.5">
              <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="text-xs bg-muted border border-border/50 rounded-md px-2 py-1.5 text-foreground" />
              <span className="text-xs text-muted-foreground">a</span>
              <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="text-xs bg-muted border border-border/50 rounded-md px-2 py-1.5 text-foreground" />
            </div>
          )}

          {/* Sync button */}
          <Button
            variant="outline"
            size="sm"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4 mr-2" />
            )}
            Sincronizar
          </Button>
        </div>
      </div>

      {/* Sync Error */}
      {syncError && (
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/30 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="font-medium text-red-700 dark:text-red-400">Error al sincronizar</p>
            <p className="text-sm text-red-600 dark:text-red-400/80 mt-1 break-words">{syncError}</p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSyncError(null)}
            className="shrink-0 text-red-600 dark:text-red-400 hover:text-red-700 hover:bg-red-500/10"
          >
            ✕
          </Button>
        </div>
      )}

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Hoy
            </CardTitle>
            <DollarSign className="h-4 w-4 text-green-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-400">
              {formatCost(summary?.today || 0)}
            </div>
            <p className="text-xs text-muted-foreground">USD</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Ayer
            </CardTitle>
            <Calendar className="h-4 w-4 text-blue-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCost(summary?.yesterday || 0)}
            </div>
            <p className="text-xs text-muted-foreground">USD</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Este Mes
            </CardTitle>
            <TrendingUp className="h-4 w-4 text-purple-400" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-purple-400">
              {formatCost(summary?.thisMonth || 0)}
            </div>
            <p className="text-xs text-muted-foreground">USD acumulado</p>
          </CardContent>
        </Card>

        <Card className="bg-card border-border/50">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">
              Mes Anterior
            </CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {formatCost(summary?.lastMonth || 0)}
            </div>
            <p className="text-xs text-muted-foreground">USD total</p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Daily Costs Chart */}
        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-green-400" />
              Costos Diarios
            </CardTitle>
          </CardHeader>
          <CardContent>
            {dailyTotals.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={dailyTotals}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDate}
                    stroke="#666"
                    fontSize={12}
                  />
                  <YAxis
                    stroke="#666"
                    fontSize={12}
                    tickFormatter={(v) => `$${v}`}
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#1a1a22", border: "1px solid #333", borderRadius: "8px", color: "#fff" }}
                    labelStyle={{ color: "#fff" }}
                    itemStyle={{ color: "#fff" }}
                    labelFormatter={formatDate}
                    formatter={(value) => [formatCost(Number(value) || 0), "Costo"]}
                  />
                  <Line
                    type="monotone"
                    dataKey="total_cost"
                    stroke="#10b981"
                    strokeWidth={2}
                    dot={{ fill: "#10b981", r: 3 }}
                    activeDot={{ r: 5 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-[300px] flex items-center justify-center text-muted-foreground">
                No hay datos disponibles
              </div>
            )}
          </CardContent>
        </Card>

        {/* Service Distribution Pie */}
        <Card className="bg-card border-border/50">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Cloud className="h-4 w-4 text-blue-400" />
              Distribución por Servicio
            </CardTitle>
          </CardHeader>
          <CardContent>
            {summary?.byService && summary.byService.length > 0 ? (
              <div className="flex items-center gap-4">
                <ResponsiveContainer width="50%" height={250}>
                  <PieChart>
                    <Pie
                      data={summary.byService as Array<{ service_id: string; service_description: string; total_cost: number; [key: string]: unknown }>}
                      dataKey="total_cost"
                      nameKey="service_description"
                      cx="50%"
                      cy="50%"
                      outerRadius={80}
                      label={({ percent }) => `${((percent || 0) * 100).toFixed(0)}%`}
                    >
                      {summary.byService.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{ backgroundColor: "#1a1a22", border: "1px solid #333", borderRadius: "8px", color: "#fff" }}
                      labelStyle={{ color: "#fff" }}
                      itemStyle={{ color: "#fff" }}
                      formatter={(value) => [formatCost(Number(value) || 0), "Costo"]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="flex-1 space-y-2">
                  {summary.byService.slice(0, 6).map((service, index) => (
                    <div key={service.service_id} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div
                          className="w-3 h-3 rounded-full"
                          style={{ backgroundColor: COLORS[index % COLORS.length] }}
                        />
                        <span className="text-sm truncate max-w-[120px]">
                          {getServiceName(service.service_description)}
                        </span>
                      </div>
                      <span className="text-sm font-medium">
                        {formatCost(service.total_cost)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="h-[250px] flex items-center justify-center text-muted-foreground">
                No hay datos disponibles
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Service Table */}
      <Card className="bg-card border-border/50">
        <CardHeader>
          <CardTitle className="text-base">Desglose por Servicio (Este Mes)</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {summary?.byService && summary.byService.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow className="border-border/50 bg-muted/30">
                  <TableHead>Servicio</TableHead>
                  <TableHead className="text-right">Costo Neto</TableHead>
                  <TableHead className="text-right">% del Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {summary.byService.map((service) => {
                  const percentage = summary.thisMonth > 0
                    ? (service.total_cost / summary.thisMonth) * 100
                    : 0;
                  return (
                    <TableRow key={service.service_id} className="border-border/30">
                      <TableCell>
                        <div>
                          <div className="font-medium">
                            {getServiceName(service.service_description)}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {service.service_id}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={service.total_cost > 0 ? "text-green-400" : ""}>
                          {formatCost(service.total_cost)}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground">
                        {percentage.toFixed(1)}%
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          ) : (
            <div className="flex items-center justify-center h-32 text-muted-foreground">
              No hay datos disponibles. Ejecuta una sincronización.
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
