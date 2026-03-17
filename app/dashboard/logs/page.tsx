"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Loader2,
  ScrollText,
  RefreshCw,
  Server,
  ArrowDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface Container {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
}

export default function LogsPage() {
  const [containers, setContainers] = useState<Container[]>([]);
  const [selectedContainer, setSelectedContainer] = useState<string>("");
  const [logs, setLogs] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [tail, setTail] = useState(300);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [available, setAvailable] = useState(true);
  const logRef = useRef<HTMLPreElement>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchContainers = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard/logs");
      if (res.ok) {
        const data = await res.json();
        setAvailable(data.available !== false);
        setContainers(data.containers || []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchLogs = useCallback(async (containerId?: string) => {
    const target = containerId || selectedContainer;
    if (!target) return;
    setLoadingLogs(true);
    try {
      const res = await fetch(`/api/dashboard/logs?container=${target}&tail=${tail}`);
      if (res.ok) {
        const data = await res.json();
        setLogs(data.logs || "");
      }
    } catch {
      // silent
    } finally {
      setLoadingLogs(false);
    }
  }, [selectedContainer, tail]);

  useEffect(() => {
    fetchContainers();
  }, [fetchContainers]);

  // Auto-refresh
  useEffect(() => {
    if (autoRefresh && selectedContainer) {
      intervalRef.current = setInterval(() => fetchLogs(), 5000);
      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
    }
  }, [autoRefresh, selectedContainer, fetchLogs]);

  const handleSelectContainer = (id: string) => {
    setSelectedContainer(id);
    setLogs("");
    if (id) fetchLogs(id);
  };

  const scrollToBottom = () => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  };

  useEffect(() => {
    if (logs && logRef.current) {
      scrollToBottom();
    }
  }, [logs]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!available) {
    return (
      <div className="flex items-center justify-center h-96 text-muted-foreground">
        Docker socket no disponible (solo funciona en producción)
      </div>
    );
  }

  const stateColor = (state: string) => {
    if (state === "running") return "bg-emerald-500/20 text-emerald-400";
    if (state === "exited") return "bg-red-500/20 text-red-400";
    return "bg-yellow-500/20 text-yellow-400";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Docker Logs</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Visualizar logs de contenedores en tiempo real
        </p>
      </div>

      {/* Container selector */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {containers.map((c) => (
          <button
            key={c.id}
            onClick={() => handleSelectContainer(c.id)}
            className={cn(
              "text-left p-3 rounded-lg border transition-colors",
              selectedContainer === c.id
                ? "border-primary bg-primary/10"
                : "border-border/50 hover:border-border hover:bg-muted/50"
            )}
          >
            <div className="flex items-center gap-2 mb-1">
              <Server className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-sm font-medium truncate">{c.name}</span>
            </div>
            <Badge className={cn("text-[10px] px-1.5 py-0", stateColor(c.state))}>
              {c.state}
            </Badge>
            <p className="text-[10px] text-muted-foreground mt-1 truncate">{c.status}</p>
          </button>
        ))}
      </div>

      {/* Log viewer */}
      {selectedContainer && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg flex items-center gap-2">
                <ScrollText className="h-5 w-5" />
                {containers.find((c) => c.id === selectedContainer)?.name}
              </CardTitle>
              <div className="flex items-center gap-3">
                <select
                  className="bg-muted border border-border/50 rounded px-2 py-1 text-xs"
                  value={tail}
                  onChange={(e) => setTail(parseInt(e.target.value))}
                >
                  <option value={100}>100 líneas</option>
                  <option value={300}>300 líneas</option>
                  <option value={500}>500 líneas</option>
                  <option value={1000}>1000 líneas</option>
                  <option value={3000}>3000 líneas</option>
                </select>
                <button
                  onClick={() => setAutoRefresh(!autoRefresh)}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border transition-colors",
                    autoRefresh
                      ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
                      : "border-border/50 text-muted-foreground hover:text-foreground"
                  )}
                >
                  <RefreshCw className={cn("h-3 w-3", autoRefresh && "animate-spin")} />
                  Auto
                </button>
                <button
                  onClick={() => fetchLogs()}
                  disabled={loadingLogs}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border border-border/50 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
                >
                  {loadingLogs ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  Refresh
                </button>
                <button
                  onClick={scrollToBottom}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border border-border/50 text-muted-foreground hover:text-foreground transition-colors"
                >
                  <ArrowDown className="h-3 w-3" />
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <pre
              ref={logRef}
              className="bg-black/80 text-green-400 text-[11px] leading-[1.4] font-mono p-4 rounded-lg overflow-auto max-h-[70vh] whitespace-pre-wrap break-all"
            >
              {logs || (loadingLogs ? "Cargando..." : "Sin logs")}
            </pre>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
