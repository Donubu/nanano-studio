"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Layers, Pencil, Check, X } from "lucide-react";

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
  definition: unknown;
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
        fetchTemplate();
      }
    } catch (err) {
      console.error("Error actualizando nombre:", err);
    } finally {
      setSavingName(false);
    }
  };

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

  return (
    <div className="min-h-screen bg-background">
      {/* Top bar */}
      <header className="border-b border-border/50 bg-card/40">
        <div className="max-w-screen-2xl mx-auto px-6 py-3 flex items-center gap-4">
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
            <span className="truncate">Template</span>
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

      <main className="max-w-screen-2xl mx-auto px-6 py-6 space-y-6">
        {/* Title */}
        {editingName ? (
          <div className="flex items-center gap-2">
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
              className="text-2xl font-bold bg-muted border border-border/50 rounded-md px-3 py-1 flex-1 max-w-xl"
              autoFocus
            />
            <Button
              size="icon"
              variant="ghost"
              onClick={handleSaveName}
              disabled={savingName}
            >
              {savingName ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={() => {
                setEditingName(false);
                setNameInput(template.name);
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <div className="flex items-center gap-2 group">
            <h1 className="text-2xl font-bold">{template.name}</h1>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
              onClick={() => setEditingName(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {/* Editor placeholder */}
        <div className="bg-card rounded-xl border border-border/50 p-6">
          <h3 className="text-sm font-medium mb-2">Editor</h3>
          <p className="text-xs text-muted-foreground mb-4">
            El editor visual de capas (texto, imagen, formas, auto-layout y constraints) se
            construirá en Fase 2.
          </p>
          <div
            className="w-full mx-auto bg-background border border-dashed border-border/50 rounded-lg flex items-center justify-center text-muted-foreground"
            style={{
              aspectRatio: `${template.base_width} / ${template.base_height}`,
              maxWidth: 600,
              minHeight: 240,
            }}
          >
            <div className="text-center">
              <Layers className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-sm">
                {template.base_width} × {template.base_height} px
              </p>
              <p className="text-xs mt-1">Canvas vacío</p>
            </div>
          </div>
        </div>

        {/* Adaptations placeholder */}
        <div className="bg-card rounded-xl border border-border/50 p-6">
          <h3 className="text-sm font-medium mb-2">Adaptaciones</h3>
          <p className="text-xs text-muted-foreground">
            Seleccionar formatos de salida (GDN, redes sociales, email) llegará en Fase 3.
          </p>
        </div>

        {/* Raw definition preview (debug) */}
        <details className="bg-card rounded-xl border border-border/50 p-6">
          <summary className="text-sm font-medium cursor-pointer">
            definition_json (debug)
          </summary>
          <pre className="text-xs text-muted-foreground mt-3 overflow-auto bg-muted/30 p-3 rounded-md max-h-96">
            {JSON.stringify(template.definition, null, 2)}
          </pre>
        </details>
      </main>
    </div>
  );
}
