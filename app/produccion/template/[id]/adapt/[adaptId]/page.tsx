"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, RotateCcw } from "lucide-react";
import { TemplateEditor } from "@/components/production/editor/template-editor";
import { TemplateDefinition, newRootFrame } from "@/lib/production/types";
import {
  BrandKit,
  BrandKitContent,
  EMPTY_KIT_CONTENT,
  brandKitFromApi,
  mergeKits,
} from "@/lib/production/brand-kit";
import {
  parseOverrides,
  deriveManualLayoutFromMaster,
} from "@/lib/production/overrides";

interface Template {
  id: number;
  production_project_id: number;
  design_id: number | null;
  name: string;
  base_width: number;
  base_height: number;
  definition: TemplateDefinition | null;
}

interface Adaptation {
  id: number;
  design_id: number;
  source_template_id: number | null;
  format_preset_id: number | null;
  custom_name: string | null;
  preset_name: string | null;
  preset_channel: string | null;
  width: number;
  height: number;
  overrides_json: string | null;
}

export default function AdaptationEditorPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const templateId = params.id as string;
  const adaptId = params.adaptId as string;

  const [template, setTemplate] = useState<Template | null>(null);
  const [adaptation, setAdaptation] = useState<Adaptation | null>(null);
  const [initialDefinition, setInitialDefinition] = useState<TemplateDefinition | null>(null);
  const [clientId, setClientId] = useState<number | null>(null);
  const [brandKits, setBrandKits] = useState<BrandKit[]>([]);
  const [brandKitContent, setBrandKitContent] = useState<BrandKitContent>(EMPTY_KIT_CONTENT);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);

  const fetchBrandKits = useCallback(
    async (cid: number, projectId: number) => {
      const res = await fetch(
        `/api/production/brand-kits?client_id=${cid}&production_project_id=${projectId}`
      );
      if (!res.ok) return;
      const rows: unknown[] = await res.json();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parsed: BrandKit[] = rows.map((r: any) => brandKitFromApi(r));
      setBrandKits(parsed);
      const clientWide = parsed.filter((k) => k.production_project_id === null);
      const projectScoped = parsed.filter((k) => k.production_project_id != null);
      const baseClient = clientWide.find((k) => k.is_default) ?? clientWide[0];
      const baseProject = projectScoped.find((k) => k.is_default) ?? projectScoped[0];
      setBrandKitContent(
        mergeKits(...[baseClient, baseProject].filter((x): x is BrandKit => !!x))
      );
    },
    []
  );

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const tplRes = await fetch(`/api/production/templates/${templateId}`);
      if (!tplRes.ok) {
        if (tplRes.status === 404 || tplRes.status === 401) router.push("/");
        return;
      }
      const tpl: Template = await tplRes.json();
      setTemplate(tpl);

      if (tpl.design_id == null) {
        router.push(`/produccion/template/${templateId}/producir`);
        return;
      }
      const adaptListRes = await fetch(
        `/api/production/designs/${tpl.design_id}/adaptations`
      );
      if (!adaptListRes.ok) return;
      const adaptList: Adaptation[] = await adaptListRes.json();
      const adapt = adaptList.find((a) => String(a.id) === adaptId);
      if (!adapt) {
        router.push(`/produccion/template/${templateId}/producir`);
        return;
      }
      setAdaptation(adapt);

      const projRes = await fetch(
        `/api/production/projects/${tpl.production_project_id}`
      );
      if (projRes.ok) {
        const proj = await projRes.json();
        setClientId(proj.client_id);
        await fetchBrandKits(proj.client_id, tpl.production_project_id);
      }

      // Decidir layout inicial:
      //  - Si ya hay manual_layout guardado: usarlo.
      //  - Si no: derivar desde el master + reflow (smart constraints).
      const overrides = parseOverrides(adapt.overrides_json);
      const masterDef: TemplateDefinition =
        tpl.definition && (tpl.definition as TemplateDefinition).type === "frame"
          ? (tpl.definition as TemplateDefinition)
          : newRootFrame(tpl.base_width, tpl.base_height);
      const initial =
        overrides.manual_layout ??
        deriveManualLayoutFromMaster(masterDef, adapt.width, adapt.height);
      setInitialDefinition(initial);
    } catch (err) {
      console.error("Error cargando datos:", err);
    } finally {
      setLoading(false);
    }
  }, [templateId, adaptId, router, fetchBrandKits]);

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
    fetchAll();
  }, [fetchAll, session, sessionStatus, router]);

  const designId = template?.design_id ?? null;

  const handleSaveOverride = useCallback(
    async (def: TemplateDefinition) => {
      if (designId == null) {
        throw new Error("design_id no resuelto — no se puede guardar");
      }
      const res = await fetch(
        `/api/production/designs/${designId}/adaptations/${adaptId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            overrides_json: { manual_layout: def },
          }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        const detail = body?.error ? ` — ${body.error}` : "";
        console.error("PATCH override failed:", res.status, body);
        throw new Error(`Save failed: ${res.status}${detail}`);
      }
    },
    [designId, adaptId]
  );

  const handleResetToMaster = async () => {
    if (designId == null) return;
    if (!confirm("¿Descartar los ajustes manuales? La adaptación volverá a generarse automáticamente desde el master.")) {
      return;
    }
    setResetting(true);
    try {
      const res = await fetch(
        `/api/production/designs/${designId}/adaptations/${adaptId}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reset_overrides: true }),
        }
      );
      if (res.ok) {
        router.push(`/produccion/template/${templateId}/producir`);
      }
    } finally {
      setResetting(false);
    }
  };

  if (loading || sessionStatus === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!template || !adaptation || !initialDefinition) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <p className="text-muted-foreground">Adaptación no encontrada</p>
      </div>
    );
  }

  const adaptLabel =
    adaptation.custom_name ||
    adaptation.preset_name ||
    `${adaptation.width}×${adaptation.height}`;
  const hasOverride = !!parseOverrides(adaptation.overrides_json).manual_layout;

  return (
    <div className="flex flex-col h-screen bg-background">
      <header className="border-b border-border/50 bg-card/40 shrink-0">
        <div className="px-6 py-3 flex items-center gap-4">
          <Button
            variant="ghost"
            size="icon"
            onClick={() =>
              router.push(`/produccion/template/${template.id}/producir`)
            }
            title="Volver a producir"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>

          <div className="flex items-center gap-2 text-sm text-muted-foreground min-w-0">
            <span className="text-foreground font-medium">{template.name}</span>
            <span className="text-muted-foreground/50">/</span>
            <span className="text-foreground">{adaptLabel}</span>
            <span className="text-muted-foreground/50">·</span>
            <span>
              {adaptation.width}×{adaptation.height}
            </span>
            <span className="text-muted-foreground/50">·</span>
            <span className="text-amber-300">Ajuste manual</span>
          </div>

          <div className="flex-1" />

          {hasOverride && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetToMaster}
              disabled={resetting}
              className="gap-1.5 text-amber-300 hover:text-amber-200"
            >
              {resetting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RotateCcw className="h-3.5 w-3.5" />
              )}
              Volver a auto
            </Button>
          )}
        </div>
      </header>

      <div className="flex-1 min-h-0">
        <TemplateEditor
          initial={initialDefinition}
          baseWidth={adaptation.width}
          baseHeight={adaptation.height}
          onSave={handleSaveOverride}
          brandKit={brandKitContent}
          clientId={clientId}
          projectId={template.production_project_id}
          allBrandKits={brandKits}
          onBrandKitsChange={() => {
            if (clientId) fetchBrandKits(clientId, template.production_project_id);
          }}
        />
      </div>
    </div>
  );
}
