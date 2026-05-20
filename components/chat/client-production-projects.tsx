"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Layers } from "lucide-react";

interface ProductionProject {
  id: number;
  client_id: number;
  title: string;
  status: "active" | "paused" | "completed" | "archived";
  template_count: number;
  updated_at: string;
}

interface Props {
  clientId: number;
}

// Compact sidebar widget that lists production projects for the currently
// selected client. Renders nothing while empty. Caller is responsible for
// gating visibility by role (admin-only in MVP).
export default function ClientProductionProjects({ clientId }: Props) {
  const router = useRouter();
  const [projects, setProjects] = useState<ProductionProject[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchProjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/production/projects?client_id=${clientId}`);
      if (res.ok) {
        const data = await res.json();
        setProjects(data);
      }
    } catch (err) {
      console.error("Error obteniendo proyectos de producción:", err);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    fetchProjects();
  }, [fetchProjects]);

  if (loading) {
    return (
      <div className="p-3">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
          Producción
        </div>
        <div className="flex items-center justify-center py-2">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        </div>
      </div>
    );
  }

  if (projects.length === 0) return null;

  return (
    <div className="p-3 border-t border-border/50">
      <div className="flex items-center justify-between mb-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Producción
        </div>
      </div>
      <div className="space-y-1">
        {projects.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => router.push(`/produccion/proyecto/${p.id}`)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-accent text-left transition-colors group"
            title={p.title}
          >
            <Layers className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-sm truncate flex-1">{p.title}</span>
            {p.template_count > 0 && (
              <span className="text-[10px] text-muted-foreground">
                {p.template_count}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
