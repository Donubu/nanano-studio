"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Layers, Pencil, Check, X } from "lucide-react";
import { TemplateEditor } from "@/components/production/editor/template-editor";
import { TemplateDefinition, newRootFrame } from "@/lib/production/types";

interface Template {
  id: number;
  production_project_id: number;
  name: string;
  description: string | null;
  base_width: number;
  base_height: number;
  thumbnail_url: string | null;
  brand_kit_id: number | null;
  status: "draft" | "published" | "archived";
  version: number;
  created_at: string;
  updated_at: string;
  definition: TemplateDefinition | null;
}

export default function TemplateDetailPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const templateId = params.id as string;

  const [template, setTemplate] = useState<Template | null>(null);
  const [loading, setLoading] = useState(true);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");
  const [savingName, setSavingName] = useState(false);

  const fetchTemplate = useCallback(async () => {
    try {
      const res = await fetch(`/api/production/templates/${templateId}`);
      if (res.ok) {
        const data = await res.json();
        setTemplate(data);
        setNameInput(data.name);
      } else if (res.status === 404 || res.status === 401) {
        router.push("/");
      }
    } catch (err) {
      console.error("Error obteniendo template:", err);
    } finally {
      setLoading(false);
    }
  }, [templateId, router]);

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
    fetchTemplate();
  }, [fetchTemplate, session, sessionStatus, router]);

  const handleSaveName = async () => {
    if (!template || !nameInput.trim() || nameInput.trim() === template.name) {
      setEditingName(false);
      setNameInput(template?.name || "");
      return;
    }
    setSavingName(true);
    try {
      const res = await fetch(`/api/production/templates/${templateId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nameInput.trim() }),
      });
      if (res.ok) {
        setEditingName(false);
        // Refresh just the name without refetching the whole template
        // (avoid blowing away the editor state mid-edit).
        setTemplate((t) => (t ? { ...t, name: nameInput.trim() } : t));
      }
    } catch (err) {
      console.error("Error actualizando nombre:", err);
    } finally {
      setSavingName(false);
    }
  };

  const handleSaveDefinition = useCallback(
    async (definition: TemplateDefinition) => {
      const res = await fetch(`/api/production/templates/${templateId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ definition }),
      });
      if (!res.ok) {
        throw new Error(`Save failed: ${res.status}`);
      }
    },
    [templateId]
  );

  if (loading || sessionStatus === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!template) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Template no encontrado</p>
      </div>
    );
  }

  const initialDefinition: TemplateDefinition =
    template.definition && (template.definition as TemplateDefinition).type === "frame"
      ? (template.definition as TemplateDefinition)
      : newRootFrame(template.base_width, template.base_height);

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Top bar */}
      <header className="border-b border-border/50 bg-card/40 shrink-0">
        <div className="px-6 py-3 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              router.push(`/produccion/proyecto/${template.production_project_id}`)
            }
            title="Volver al proyecto"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>

          <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
            <Layers className="h-4 w-4 shrink-0" />
            {editingName ? (
              <input
                type="text"
                value={nameInput}
                onChange={(e) => setNameInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveName();
                  if (e.key === "Escape") {
                    setEditingName(false);
                    setNameInput(template.name);
                  }
                }}
                className="bg-muted border border-border/50 rounded-md px-2 py-0.5 text-sm font-medium text-foreground"
                autoFocus
              />
            ) : (
              <button
                type="button"
                onClick={() => setEditingName(true)}
                className="group flex items-center gap-1 text-foreground hover:text-foreground"
              >
                <span className="font-medium">{template.name}</span>
                <Pencil className="h-3 w-3 opacity-0 group-hover:opacity-60 transition-opacity" />
              </button>
            )}
            {editingName && (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={handleSaveName}
                  disabled={savingName}
                >
                  {savingName ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Check className="h-3.5 w-3.5" />
                  )}
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  onClick={() => {
                    setEditingName(false);
                    setNameInput(template.name);
                  }}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </>
            )}
            <span className="text-muted-foreground/50">·</span>
            <span>
              {template.base_width}×{template.base_height}
            </span>
            <span className="text-muted-foreground/50">·</span>
            <span>v{template.version}</span>
          </div>

          <div className="flex-1" />
        </div>
      </header>

      {/* Editor takes the rest of the screen */}
      <div className="flex-1 min-h-0">
        <TemplateEditor
          initial={initialDefinition}
          baseWidth={template.base_width}
          baseHeight={template.base_height}
          onSave={handleSaveDefinition}
        />
      </div>
    </div>
  );
}
