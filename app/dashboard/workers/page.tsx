"use client";

import { useEffect, useState, useCallback, useRef, Fragment } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  Activity,
  Clock,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Server,
  ChevronDown,
  ChevronUp,
  BarChart3,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface ActiveJob {
  id: string;
  model: string;
  conversationId: string;
  generationType: string;
  user: string;
  project: string;
  worker: string;
  startedAt: number | null;
}

interface CompletedJob {
  id: string;
  model: string;
  generationType: string;
  user: string;
  project: string;
  worker: string;
  completedAt: number | null;
  duration: number | null;
}

interface FailedJob {
  id: string;
  model: string;
  generationType: string;
  user: string;
  project: string;
  worker: string;
  error: string;
  failedAt: number | null;
}

interface StatEntry {
  key: string;
  count: number;
  avgMs: number;
  minMs: number;
  maxMs: number;
}

interface WorkerStats {
  byModel: StatEntry[];
  byType: StatEntry[];
  byWorker: StatEntry[];
  sampleSize: number;
}

interface WorkerData {
  configured: boolean;
  workers: number;
  queue: {
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  };
  activeJobs: ActiveJob[];
  completedJobs: CompletedJob[];
  failedJobs: FailedJob[];
  stats?: WorkerStats;
}

function formatElapsed(startedAt: number | null): string {
  if (!startedAt) return "—";
  const elapsed = Math.floor((Date.now() - startedAt) / 1000);
  if (elapsed < 60) return `${elapsed}s`;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return `${mins}m ${secs}s`;
}

function formatDuration(ms: number | null): string {
  if (!ms) return "—";
  const secs = Math.floor(ms / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  const remSecs = secs % 60;
  return `${mins}m ${remSecs}s`;
}

function formatDate(timestamp: number | null): string {
  if (!timestamp) return "—";
  return new Date(timestamp).toLocaleString("es-CL", {
    timeZone: "America/Santiago",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function StatsTable({ title, entries }: { title: string; entries: StatEntry[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <BarChart3 className="h-4 w-4" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="text-xs">Nombre</TableHead>
              <TableHead className="text-xs text-right">Jobs</TableHead>
              <TableHead className="text-xs text-right">Prom.</TableHead>
              <TableHead className="text-xs text-right">Min</TableHead>
              <TableHead className="text-xs text-right">Max</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {entries.map((e) => (
              <TableRow key={e.key}>
                <TableCell className="text-xs font-mono truncate max-w-[140px]">{e.key}</TableCell>
                <TableCell className="text-xs text-right">{e.count}</TableCell>
                <TableCell className="text-xs text-right font-mono">{formatDuration(e.avgMs)}</TableCell>
                <TableCell className="text-xs text-right font-mono text-muted-foreground">{formatDuration(e.minMs)}</TableCell>
                <TableCell className="text-xs text-right font-mono text-muted-foreground">{formatDuration(e.maxMs)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

export default function WorkersPage() {
  const [data, setData] = useState<WorkerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [, setTick] = useState(0);
  const [expandedErrors, setExpandedErrors] = useState<Set<string>>(new Set());

  const toggleError = (jobId: string) => {
    setExpandedErrors((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchingRef = useRef(false);

  const fetchData = useCallback(async (isInitial = false) => {
    // Prevent concurrent fetches (previous one still running)
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const res = await fetch("/api/dashboard/workers");
      if (res.ok) {
        const json = await res.json();
        setData(json);
      }
    } catch {
      // Keep existing data on error — don't clear the UI
    } finally {
      if (isInitial) setLoading(false);
      fetchingRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchData(true);
    const id = setInterval(() => fetchData(false), 5000);
    return () => clearInterval(id);
  }, [fetchData]);

  // Tick every second to update elapsed times
  useEffect(() => {
    intervalRef.current = setInterval(() => setTick((t) => t + 1), 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-96 text-muted-foreground">
        Error al cargar datos
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold">Workers</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Monitoreo de cola de generaciones en tiempo real
        </p>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Estado
            </CardTitle>
          </CardHeader>
          <CardContent>
            {data.configured ? (
              <Badge className="bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 border-0">
                Conectado
              </Badge>
            ) : (
              <Badge variant="destructive">Sin Redis</Badge>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Server className="h-4 w-4" />
              Workers
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className={cn(
              "text-2xl font-bold",
              data.configured && data.workers === 0 && "text-red-400"
            )}>
              {data.configured ? data.workers : "—"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Clock className="h-4 w-4" />
              En espera
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.queue.waiting}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-4 w-4" />
              Activos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.queue.active}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" />
              Completados
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{data.queue.completed}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <XCircle className="h-4 w-4" />
              Fallidos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p
              className={cn(
                "text-2xl font-bold",
                data.queue.failed > 0 && "text-red-400"
              )}
            >
              {data.queue.failed}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Stats */}
      {data.stats && data.stats.sampleSize > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <StatsTable title="Por Modelo" entries={data.stats.byModel} />
          <StatsTable title="Por Tipo" entries={data.stats.byType} />
          <StatsTable title="Por Worker" entries={data.stats.byWorker} />
        </div>
      )}

      {/* Active Jobs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Jobs Activos
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.activeJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No hay jobs activos
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job ID</TableHead>
                  <TableHead>Worker</TableHead>
                  <TableHead>Modelo</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Proyecto</TableHead>
                  <TableHead>Tiempo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.activeJobs.map((job) => (
                  <TableRow key={job.id}>
                    <TableCell className="font-mono text-xs">
                      {job.id}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono text-xs">
                        {job.worker}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{job.model}</Badge>
                    </TableCell>
                    <TableCell>{job.generationType}</TableCell>
                    <TableCell>{job.user}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {job.project}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatElapsed(job.startedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Completed Jobs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2 text-emerald-400">
            <CheckCircle2 className="h-5 w-5" />
            Ultimos Jobs Completados
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.completedJobs.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">
              No hay jobs completados recientes
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job ID</TableHead>
                  <TableHead>Worker</TableHead>
                  <TableHead>Modelo</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead>Usuario</TableHead>
                  <TableHead>Proyecto</TableHead>
                  <TableHead>Duracion</TableHead>
                  <TableHead>Fecha</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.completedJobs.map((job, idx) => (
                  <TableRow key={`${job.id}-${idx}`}>
                    <TableCell className="font-mono text-xs">
                      {job.id}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono text-xs">
                        {job.worker}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{job.model}</Badge>
                    </TableCell>
                    <TableCell>{job.generationType}</TableCell>
                    <TableCell>{job.user}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {job.project}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {formatDuration(job.duration)}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatDate(job.completedAt)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Failed Jobs */}
      {data.failedJobs.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2 text-red-400">
              <AlertTriangle className="h-5 w-5" />
              Ultimos Jobs Fallidos
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[80px]">Job ID</TableHead>
                    <TableHead>Worker</TableHead>
                    <TableHead>Modelo</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Usuario</TableHead>
                    <TableHead>Proyecto</TableHead>
                    <TableHead>Error</TableHead>
                    <TableHead className="w-[160px]">Fecha</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.failedJobs.map((job, idx) => (
                    <Fragment key={`${job.id}-${idx}`}>
                      <TableRow
                        className="cursor-pointer hover:bg-muted/50"
                        onClick={() => toggleError(job.id)}
                      >
                        <TableCell className="font-mono text-xs">
                          {job.id}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="font-mono text-xs">
                            {job.worker}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{job.model}</Badge>
                        </TableCell>
                        <TableCell>{job.generationType}</TableCell>
                        <TableCell>{job.user}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {job.project}
                        </TableCell>
                        <TableCell className="text-sm text-red-400">
                          <div className="flex items-center gap-2 min-w-0">
                            {expandedErrors.has(job.id) ? (
                              <ChevronUp className="h-3 w-3 flex-shrink-0" />
                            ) : (
                              <ChevronDown className="h-3 w-3 flex-shrink-0" />
                            )}
                            <span className="truncate max-w-[300px] inline-block">
                              {job.error.split("\n")[0]}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {formatDate(job.failedAt)}
                        </TableCell>
                      </TableRow>
                      {expandedErrors.has(job.id) && (
                        <TableRow>
                          <TableCell colSpan={8} className="p-0">
                            <pre className="text-xs text-red-700 dark:text-red-300 bg-red-100 dark:bg-red-950/30 p-3 m-2 rounded overflow-x-auto whitespace-pre-wrap break-words">
                              {job.error}
                            </pre>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
