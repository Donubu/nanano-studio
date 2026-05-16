"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Building2, Pencil, Check, X } from "lucide-react";
import Image from "next/image";
import ProductionTemplatesList from "@/components/dashboard/production-templates-list";

interface ProductionProject {
  id: number;
  client_id: number;
  client_name: string;
  client_logo: string | null;
  title: string;
  description: string | null;
  status: "active" | "paused" | "completed" | "archived";
  hidden: number;
  created_at: string;
  updated_at: string;
}

const STATUS_LABEL: Record<ProductionProject["status"], string> = {
  active: "Activo",
  paused: "En pausa",
  completed: "Completado",
  archived: "Archivado",
};

const STATUS_CLASS: Record<ProductionProject["status"], string> = {
  active: "bg-green-500/15 text-green-400",
  paused: "bg-yellow-500/15 text-yellow-400",
  completed: "bg-blue-500/15 text-blue-400",
  archived: "bg-muted text-muted-foreground",
};

export default function ProductionProjectPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const projectId = params.id as string;

  const [project, setProject] = useState<ProductionProject | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState("");
  const [savingTitle, setSavingTitle] = useState(false);

  const fetchProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/production/projects/${projectId}`);
      if (res.ok) {
        const data = await res.json();
        setProject(data);
        setTitleInput(data.title);
      } else if (res.status === 404) {
        router.push("/");
      } else if (res.status === 401) {
        router.push("/");
      }
    } catch (err) {
      console.error("Error obteniendo proyecto:", err);
    } finally {
      setLoading(false);
    }
  }, [projectId, router]);

  useEffect(() => {
    if (sessionStatus === "loading") return;
    if (!session?.user) {
      router.push("/login");
      return;
    }
    if (session.user.role !== "admin") {
      router.push("/");
      return;
    }
    fetchProject();
  }, [fetchProject, session, sessionStatus, router]);

  const handleSaveTitle = async () => {
    if (!project || !titleInput.trim() || titleInput.trim() === project.title) {
      setEditingTitle(false);
      setTitleInput(project?.title || "");
      return;
    }
    setSavingTitle(true);
    try {
      const res = await fetch(`/api/production/projects/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: titleInput.trim() }),
      });
      if (res.ok) {
        setEditingTitle(false);
        fetchProject();
      }
    } catch (err) {
      console.error("Error actualizando título:", err);
    } finally {
      setSavingTitle(false);
    }
  };

  const handleStatusChange = async (status: ProductionProject["status"]) => {
    try {
      const res = await fetch(`/api/production/projects/${projectId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (res.ok) fetchProject();
    } catch (err) {
      console.error("Error actualizando estado:", err);
    }
  };

  if (loading || sessionStatus === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Proyecto no encontrado</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b border-border/50 bg-card/40">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.push("/")}
            title="Volver al home"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>

          <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
            {project.client_logo ? (
              <Image
                src={project.client_logo}
                alt={project.client_name}
                width={20}
                height={20}
                className="rounded object-cover shrink-0"
              />
            ) : (
              <Building2 className="h-4 w-4 shrink-0" />
            )}
            <span className="truncate">{project.client_name}</span>
            <span className="text-muted-foreground/50">/</span>
            <span className="truncate">Producción</span>
          </div>

          <div className="flex-1" />

          <select
            value={project.status}
            onChange={(e) =>
              handleStatusChange(e.target.value as ProductionProject["status"])
            }
            className={`text-xs font-medium rounded-full px-3 py-1.5 border-0 cursor-pointer ${STATUS_CLASS[project.status]}`}
          >
            {(Object.keys(STATUS_LABEL) as ProductionProject["status"][]).map((s) => (
              <option key={s} value={s} className="bg-background text-foreground">
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 py-6 space-y-6">
        {/* Title */}
        {editingTitle ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={titleInput}
              onChange={(e) => setTitleInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveTitle();
                if (e.key === "Escape") {
                  setEditingTitle(false);
                  setTitleInput(project.title);
                }
              }}
              className="text-2xl font-bold bg-muted border border-border/50 rounded-md px-3 py-1 flex-1 max-w-xl"
              autoFocus
            />
            <Button
              size="icon"
              variant="ghost"
              onClick={handleSaveTitle}
              disabled={savingTitle}
            >
              {savingTitle ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                setEditingTitle(false);
                setTitleInput(project.title);
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 group">
            <h1 className="text-2xl font-bold">{project.title}</h1>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => setEditingTitle(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
        {project.description && (
          <p className="text-sm text-muted-foreground -mt-4">{project.description}</p>
        )}

        <ProductionTemplatesList productionProjectId={Number(projectId)} />
      </main>
    </div>
  );
}
