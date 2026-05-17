"use client";

import { useCallback, useEffect, useMemo, useRef, useState, CSSProperties } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import JSZip from "jszip";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckSquare,
  Download,
  Loader2,
  Package,
  Pencil,
  Plus,
  Rocket,
  Trash2,
  X,
} from "lucide-react";
import { hasExtremeAspectMismatch } from "@/lib/production/fit-mode";
import { parseOverrides } from "@/lib/production/overrides";
import {
  captureNodeToJpeg,
  downloadBlob,
  sanitizeFilename,
} from "@/lib/production/export";
import { AdaptationRenderer } from "@/components/production/render/adaptation-renderer";
import {
  TemplateDefinition,
  TemplateLayer,
  StackLayout,
  newRootFrame,
} from "@/lib/production/types";
import {
  BrandKit,
  BrandKitContent,
  EMPTY_KIT_CONTENT,
  brandKitFromApi,
  mergeKits,
  resolveTreeTokens,
} from "@/lib/production/brand-kit";
import { reflowForPreview } from "@/lib/production/reflow";
import {
  TemplateLayerView,
  stackToFlexStyle,
} from "@/components/production/editor/template-layer";

const CHANNEL_LABEL: Record<string, string> = {
  gdn: "Google Display",
  meta: "Meta / Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  x: "X (Twitter)",
  tiktok: "TikTok",
  youtube: "YouTube",
  email: "Email",
  print: "Imprenta",
  custom: "Personalizado",
};

const CHANNEL_ORDER: string[] = [
  "gdn",
  "meta",
  "instagram",
  "linkedin",
  "x",
  "tiktok",
  "youtube",
  "email",
  "print",
];

interface Template {
  id: number;
  production_project_id: number;
  design_id: number | null;
  name: string;
  base_width: number;
  base_height: number;
  thumbnail_url: string | null;
  status: "draft" | "published" | "archived";
  version: number;
  definition: TemplateDefinition | null;
}

interface SiblingTemplate {
  id: number;
  name: string;
  base_width: number;
  base_height: number;
  thumbnail_url: string | null;
  design_id: number | null;
  design_name: string | null;
}

interface FormatPreset {
  id: number;
  channel: string;
  group_name: string | null;
  name: string;
  width: number;
  height: number;
  orientation: "horizontal" | "vertical" | "square";
  is_system: number;
  client_id: number | null;
  sort_order: number;
}

type FitMode = "contain" | "cover" | "width" | "height" | "responsive";

const FIT_MODE_LABEL: Record<FitMode, string> = {
  contain: "Contain",
  cover: "Cover",
  width: "Ancho 100%",
  height: "Alto 100%",
  responsive: "Responsive",
};

const FIT_MODE_DESCRIPTION: Record<FitMode, string> = {
  contain: "Master entero a escala uniforme; puede dejar bordes vacíos",
  cover: "Llena toda la adaptación; recorta lo que sobra",
  width: "Ajusta al ancho de la adaptación; recorta o extiende vertical",
  height: "Ajusta al alto de la adaptación; recorta o extiende horizontal",
  responsive: "Usa los constraints por capa del master (layout fluido)",
};

interface Adaptation {
  id: number;
  template_id: number;
  format_preset_id: number | null;
  custom_name: string | null;
  width: number;
  height: number;
  fit_mode: FitMode;
  is_active: number;
  thumbnail_url: string | null;
  overrides_json: string | null;
  preset_channel: string | null;
  preset_group_name: string | null;
  preset_name: string | null;
  preset_orientation: "horizontal" | "vertical" | "square" | null;
}

export default function ProducirPage() {
  const params = useParams();
  const router = useRouter();
  const { data: session, status: sessionStatus } = useSession();
  const templateId = params.id as string;

  const [template, setTemplate] = useState<Template | null>(null);
  const [siblings, setSiblings] = useState<SiblingTemplate[]>([]);
  const [brandKitContent, setBrandKitContent] = useState<BrandKitContent>(EMPTY_KIT_CONTENT);
  const [adaptations, setAdaptations] = useState<Adaptation[]>([]);
  const [presets, setPresets] = useState<FormatPreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [showPicker, setShowPicker] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fetchAdaptations = useCallback(async () => {
    const res = await fetch(`/api/production/templates/${templateId}/adaptations`);
    if (res.ok) setAdaptations(await res.json());
  }, [templateId]);

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

      const [projRes, presetsBaseRes, siblingsRes] = await Promise.all([
        fetch(`/api/production/projects/${tpl.production_project_id}`),
        fetch(`/api/production/format-presets`),
        // Templates hermanos: comparten production_project; los filtramos por
        // design_id en el cliente para quedarnos con las variantes del mismo
        // design (excluido el actual).
        fetch(
          `/api/production/templates?production_project_id=${tpl.production_project_id}`
        ),
      ]);
      if (siblingsRes.ok && tpl.design_id != null) {
        const allTemplates: SiblingTemplate[] = await siblingsRes.json();
        setSiblings(
          allTemplates.filter(
            (t) => t.design_id === tpl.design_id && t.id !== tpl.id
          )
        );
      } else {
        setSiblings([]);
      }
      let clientId: number | null = null;
      if (projRes.ok) {
        const proj = await projRes.json();
        clientId = proj.client_id;
      }
      // Re-fetch presets including client-specific ones if we have a client.
      const presetsRes = clientId
        ? await fetch(`/api/production/format-presets?client_id=${clientId}`)
        : presetsBaseRes;
      if (presetsRes.ok) setPresets(await presetsRes.json());

      // Brand kit cascade (mismo pattern que el editor).
      if (clientId) {
        const bkRes = await fetch(
          `/api/production/brand-kits?client_id=${clientId}&production_project_id=${tpl.production_project_id}`
        );
        if (bkRes.ok) {
          const rows: unknown[] = await bkRes.json();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const parsed: BrandKit[] = rows.map((r: any) => brandKitFromApi(r));
          const clientWide = parsed.filter((k) => k.production_project_id === null);
          const projectScoped = parsed.filter((k) => k.production_project_id != null);
          const baseClient = clientWide.find((k) => k.is_default) ?? clientWide[0];
          const baseProject = projectScoped.find((k) => k.is_default) ?? projectScoped[0];
          setBrandKitContent(
            mergeKits(...[baseClient, baseProject].filter((x): x is BrandKit => !!x))
          );
        }
      }

      await fetchAdaptations();
    } catch (err) {
      console.error("Error cargando datos:", err);
    } finally {
      setLoading(false);
    }
  }, [templateId, router, fetchAdaptations]);

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

  const definition: TemplateDefinition = useMemo(() => {
    if (!template) return newRootFrame(1080, 1080);
    return template.definition && template.definition.type === "frame"
      ? template.definition
      : newRootFrame(template.base_width, template.base_height);
  }, [template]);

  const handleAddBulk = async (presetIds: number[], autoDistribute: boolean) => {
    if (presetIds.length === 0) return;
    // Si no hay design o el productor optó por no distribuir, todo cae en el
    // template actual.
    if (!autoDistribute || siblings.length === 0) {
      const res = await fetch(`/api/production/templates/${templateId}/adaptations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format_preset_ids: presetIds }),
      });
      if (res.ok) {
        setShowPicker(false);
        fetchAdaptations();
      }
      return;
    }

    // Modo auto-distribuir: cada preset va al template (master actual o
    // hermano del design) cuyo aspect ratio sea más cercano. Llamamos POST
    // por template en paralelo con su lote de presets.
    const candidates: { id: number; base_width: number; base_height: number }[] = [
      ...(template
        ? [{ id: template.id, base_width: template.base_width, base_height: template.base_height }]
        : []),
      ...siblings.map((s) => ({ id: s.id, base_width: s.base_width, base_height: s.base_height })),
    ];

    const groups = new Map<number, number[]>();
    for (const pid of presetIds) {
      const preset = presets.find((p) => p.id === pid);
      if (!preset) continue;
      const best = pickBestTemplate(preset.width, preset.height, candidates);
      const arr = groups.get(best) ?? [];
      arr.push(pid);
      groups.set(best, arr);
    }

    await Promise.all(
      Array.from(groups.entries()).map(([tplId, ids]) =>
        fetch(`/api/production/templates/${tplId}/adaptations`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ format_preset_ids: ids }),
        })
      )
    );
    setShowPicker(false);
    fetchAdaptations();
  };

  const handleAddCustom = async (name: string, w: number, h: number) => {
    const res = await fetch(`/api/production/templates/${templateId}/adaptations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ custom_name: name, width: w, height: h }),
    });
    if (res.ok) {
      setShowPicker(false);
      fetchAdaptations();
    }
  };

  // --- Export pipeline ---
  // currentlyRendering: la adaptación que está montada en el container oculto
  // a su tamaño nativo. captureResolverRef sostiene el resolve del Promise que
  // espera el blob capturado. Trabajamos con un slot único: exportSingle
  // serializa cualquier llamada (single-download o ítem de un batch).
  const [currentlyRendering, setCurrentlyRendering] = useState<Adaptation | null>(null);
  const captureResolverRef = useRef<((blob: Blob | null) => void) | null>(null);
  const renderRef = useRef<HTMLDivElement | null>(null);
  const [singleDownloadingId, setSingleDownloadingId] = useState<number | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);

  useEffect(() => {
    if (!currentlyRendering) return;
    let cancelled = false;
    (async () => {
      // Esperamos dos rAF para asegurar que React commit y el browser pinte.
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      if (cancelled) return;
      const node = renderRef.current;
      if (!node) {
        captureResolverRef.current?.(null);
        captureResolverRef.current = null;
        setCurrentlyRendering(null);
        return;
      }
      try {
        const blob = await captureNodeToJpeg(node);
        if (cancelled) return;
        captureResolverRef.current?.(blob);
      } catch (err) {
        console.error("Capture failed:", err);
        captureResolverRef.current?.(null);
      } finally {
        if (!cancelled) {
          captureResolverRef.current = null;
          setCurrentlyRendering(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentlyRendering]);

  const exportAdaptation = useCallback(
    (a: Adaptation): Promise<Blob | null> => {
      return new Promise((resolve) => {
        captureResolverRef.current = resolve;
        setCurrentlyRendering(a);
      });
    },
    []
  );

  const filenameFor = useCallback(
    (a: Adaptation): string => {
      const label = a.custom_name || a.preset_name || `${a.width}x${a.height}`;
      const tpl = template?.name ?? "template";
      return sanitizeFilename(`${tpl}_${label}_${a.width}x${a.height}.jpg`);
    },
    [template]
  );

  const handleDownloadSingle = async (a: Adaptation) => {
    setSingleDownloadingId(a.id);
    try {
      const blob = await exportAdaptation(a);
      if (blob) downloadBlob(blob, filenameFor(a));
    } finally {
      setSingleDownloadingId(null);
    }
  };

  const handleDownloadAll = async () => {
    if (adaptations.length === 0) return;
    setBatchProgress({ current: 0, total: adaptations.length });
    try {
      const zip = new JSZip();
      for (let i = 0; i < adaptations.length; i++) {
        const a = adaptations[i];
        setBatchProgress({ current: i + 1, total: adaptations.length });
        const blob = await exportAdaptation(a);
        if (blob) {
          zip.file(filenameFor(a), blob);
        }
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const tplName = template?.name ?? "template";
      downloadBlob(zipBlob, sanitizeFilename(`${tplName}_adaptaciones.zip`));
    } finally {
      setBatchProgress(null);
    }
  };

  const handleFitModeChange = async (adaptationId: number, fitMode: FitMode) => {
    // Optimistic update.
    setAdaptations((cur) =>
      cur.map((a) => (a.id === adaptationId ? { ...a, fit_mode: fitMode } : a))
    );
    const res = await fetch(
      `/api/production/templates/${templateId}/adaptations/${adaptationId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fit_mode: fitMode }),
      }
    );
    if (!res.ok) {
      // Rollback on error.
      fetchAdaptations();
    }
  };

  const handleDelete = async (adaptationId: number) => {
    if (!confirm("¿Eliminar esta adaptación?")) return;
    setDeletingId(adaptationId);
    try {
      const res = await fetch(
        `/api/production/templates/${templateId}/adaptations/${adaptationId}`,
        { method: "DELETE" }
      );
      if (res.ok) fetchAdaptations();
    } finally {
      setDeletingId(null);
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
    <div className="flex flex-col min-h-screen bg-background">
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
            <Rocket className="h-4 w-4 shrink-0" />
            <span className="font-medium text-foreground">{template.name}</span>
            <span className="text-muted-foreground/50">·</span>
            <span>
              {template.base_width}×{template.base_height}
            </span>
            <span className="text-muted-foreground/50">·</span>
            <span>Producir</span>
          </div>

          <div className="flex-1" />

          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push(`/produccion/template/${template.id}`)}
            className="gap-1.5"
          >
            Editar master
          </Button>
        </div>
      </header>

      <main className="flex-1 p-6 max-w-7xl mx-auto w-full space-y-6">
        {/* Master preview */}
        <section className="bg-card rounded-xl border border-border/50 p-4 flex gap-4">
          <MasterThumb
            definition={definition}
            brandKit={brandKitContent}
            width={template.base_width}
            height={template.base_height}
          />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Template master
            </p>
            <h2 className="text-lg font-semibold">{template.name}</h2>
            <p className="text-xs text-muted-foreground mt-1">
              {template.base_width} × {template.base_height} px · v{template.version}
            </p>
            <p className="text-xs text-muted-foreground mt-2 max-w-md">
              Las adaptaciones se generan a partir de este master usando los
              constraints de cada capa. Puedes editar el master en cualquier
              momento y todas las adaptaciones se reflowean automáticamente.
            </p>
          </div>
        </section>

        {/* Variantes del design (hermanos) */}
        {siblings.length > 0 && (
          <section className="bg-card rounded-xl border border-border/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h3 className="text-sm font-medium">Variantes del design</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Otros masters del mismo design. Al agregar adaptaciones, los
                  formatos se distribuyen entre la variante más adecuada.
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {siblings.map((s) => (
                <Link
                  key={s.id}
                  href={`/produccion/template/${s.id}/producir`}
                  className="bg-muted/50 rounded-lg p-3 flex items-center gap-3 hover:bg-muted transition-colors"
                >
                  <div
                    className="bg-background rounded border border-border/30 shrink-0 overflow-hidden flex items-center justify-center"
                    style={{
                      width: 60,
                      height: 60 * (s.base_height / s.base_width),
                      maxHeight: 60,
                    }}
                  >
                    {s.thumbnail_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={s.thumbnail_url} alt={s.name} className="max-w-full max-h-full object-contain" />
                    ) : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium truncate">{s.name}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">
                      {s.base_width}×{s.base_height}
                    </p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Adaptations list */}
        <section className="bg-card rounded-xl border border-border/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-medium">Adaptaciones</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Una pieza de salida por formato. Click en + para agregar.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {adaptations.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleDownloadAll}
                  disabled={!!batchProgress || !!singleDownloadingId}
                  className="gap-1"
                  title="Renderiza todas las adaptaciones y descarga un ZIP"
                >
                  {batchProgress ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {batchProgress.current}/{batchProgress.total}
                    </>
                  ) : (
                    <>
                      <Package className="h-4 w-4" />
                      Descargar todas (ZIP)
                    </>
                  )}
                </Button>
              )}
              <Button size="sm" onClick={() => setShowPicker(true)} className="gap-1">
                <Plus className="h-4 w-4" /> Agregar adaptación
              </Button>
            </div>
          </div>

          {adaptations.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">
              Aún no hay adaptaciones. Empezá agregando uno o varios formatos.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {adaptations.map((a) => (
                <AdaptationCard
                  key={a.id}
                  adaptation={a}
                  definition={definition}
                  brandKit={brandKitContent}
                  templateId={templateId}
                  onDelete={() => handleDelete(a.id)}
                  onFitModeChange={(m) => handleFitModeChange(a.id, m)}
                  onDownload={() => handleDownloadSingle(a)}
                  downloading={singleDownloadingId === a.id}
                  batchInProgress={!!batchProgress}
                  deleting={deletingId === a.id}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {showPicker && (
        <PresetPickerModal
          presets={presets}
          existingAdaptations={adaptations}
          siblings={siblings}
          currentTemplate={
            template
              ? {
                  id: template.id,
                  name: template.name,
                  base_width: template.base_width,
                  base_height: template.base_height,
                }
              : null
          }
          onClose={() => setShowPicker(false)}
          onConfirmPresets={handleAddBulk}
          onAddCustom={handleAddCustom}
        />
      )}

      {/* Container oculto para renderizar adaptaciones a tamaño nativo durante
          export. Vive fuera del flujo visual; las dimensiones reales del
          renderer escapan por overflow. */}
      <div
        aria-hidden
        style={{
          position: "fixed",
          left: "-99999px",
          top: 0,
          pointerEvents: "none",
          opacity: 0,
        }}
      >
        {currentlyRendering && (
          <AdaptationRenderer
            ref={renderRef}
            adaptation={currentlyRendering}
            master={definition}
            brandKit={brandKitContent}
          />
        )}
      </div>
    </div>
  );
}

// ----- Master preview thumbnail -----

function MasterThumb({
  definition,
  brandKit,
  width,
  height,
}: {
  definition: TemplateDefinition;
  brandKit: BrandKitContent;
  width: number;
  height: number;
}) {
  const TARGET = 120;
  const scale = Math.min(TARGET / width, TARGET / height);
  const w = width * scale;
  const h = height * scale;
  const resolved = resolveTreeTokens(definition, brandKit);
  const bg =
    resolved.background && resolved.background.type === "color"
      ? resolved.background.value
      : "#ffffff";
  const rootIsStack = resolved.layout.mode === "stack";
  const innerStyle: CSSProperties = {
    width,
    height,
    transform: `scale(${scale})`,
    transformOrigin: "0 0",
    position: "relative",
    ...(rootIsStack ? stackToFlexStyle(resolved.layout as StackLayout) : {}),
  };
  return (
    <div
      className="rounded border border-border/30 overflow-hidden shrink-0"
      style={{ width: w, height: h, background: bg }}
    >
      <div style={innerStyle}>
        {resolved.children.map((child: TemplateLayer) => (
          <TemplateLayerView
            key={child.id}
            layer={child}
            selectedId={null}
            onSelect={noop}
            onLayerPointerDown={noop}
            parentMode={rootIsStack ? "stack" : "free"}
          />
        ))}
      </div>
    </div>
  );
}

// ----- Adaptation card with reflowed mini preview -----

function AdaptationCard({
  adaptation,
  definition,
  brandKit,
  templateId,
  onDelete,
  onFitModeChange,
  onDownload,
  downloading,
  batchInProgress,
  deleting,
}: {
  adaptation: Adaptation;
  definition: TemplateDefinition;
  brandKit: BrandKitContent;
  templateId: string;
  onDelete: () => void;
  onFitModeChange: (m: FitMode) => void;
  onDownload: () => void;
  downloading: boolean;
  batchInProgress: boolean;
  deleting: boolean;
}) {
  const label =
    adaptation.custom_name ||
    adaptation.preset_name ||
    `${adaptation.width}×${adaptation.height}`;
  const channel =
    adaptation.preset_channel ||
    (adaptation.format_preset_id == null ? "custom" : null);

  const TARGET_H = 160;
  // Warning si el aspect ratio del adaptación es muy distinto al del master:
  // en ese caso ningún fit automático va a producir un buen resultado y se
  // recomienda ajuste manual.
  const extremeMismatch = hasExtremeAspectMismatch(
    definition.size.w,
    definition.size.h,
    adaptation.width,
    adaptation.height,
  );
  const hasManualOverride = !!parseOverrides(adaptation.overrides_json).manual_layout;

  return (
    <div className="bg-muted/50 rounded-lg p-3 flex flex-col gap-2 group">
      <div className="flex items-center justify-center bg-background/40 rounded">
        <AdaptationPreview
          adaptation={adaptation}
          definition={definition}
          brandKit={brandKit}
          targetH={TARGET_H}
        />
      </div>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          {channel && (
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {CHANNEL_LABEL[channel] ?? channel}
            </span>
          )}
          <p className="text-sm font-medium truncate">{label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {adaptation.width}×{adaptation.height}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-opacity"
          onClick={onDelete}
          disabled={deleting}
          title="Eliminar adaptación"
        >
          {deleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5 text-red-400" />
          )}
        </Button>
      </div>
      {hasManualOverride && (
        <div className="flex items-start gap-1.5 text-[10px] text-emerald-300 bg-emerald-500/10 border border-emerald-500/30 rounded px-2 py-1">
          <Pencil className="h-3 w-3 shrink-0 mt-0.5" />
          <span>Ajuste manual aplicado</span>
        </div>
      )}
      {extremeMismatch && !hasManualOverride && (
        <div
          className="flex items-start gap-1.5 text-[10px] text-amber-300 bg-amber-500/10 border border-amber-500/30 rounded px-2 py-1"
          title="Este formato tiene un aspect ratio muy distinto al del master."
        >
          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" />
          <span>
            Aspect muy distinto al master. Probablemente necesita ajuste manual.
          </span>
        </div>
      )}
      <div className="flex items-center gap-1">
        <select
          value={adaptation.fit_mode}
          onChange={(e) => onFitModeChange(e.target.value as FitMode)}
          disabled={hasManualOverride}
          className="flex-1 bg-muted border border-border/50 rounded px-2 py-1 text-[11px] disabled:opacity-50"
          title={
            hasManualOverride
              ? "El ajuste manual sobreescribe el fit mode"
              : FIT_MODE_DESCRIPTION[adaptation.fit_mode]
          }
        >
          {(Object.keys(FIT_MODE_LABEL) as FitMode[]).map((mode) => (
            <option key={mode} value={mode}>
              Fit: {FIT_MODE_LABEL[mode]}
            </option>
          ))}
        </select>
        <Link
          href={`/produccion/template/${templateId}/adapt/${adaptation.id}`}
          className="text-[11px] px-2 py-1 rounded border border-border/50 hover:bg-muted hover:border-foreground/30 transition-colors flex items-center gap-1"
          title="Editar manualmente esta pieza"
        >
          <Pencil className="h-3 w-3" />
          Ajustar
        </Link>
        <button
          type="button"
          onClick={onDownload}
          disabled={downloading || batchInProgress}
          className="text-[11px] px-2 py-1 rounded border border-border/50 hover:bg-muted hover:border-foreground/30 transition-colors flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
          title="Descargar como JPG"
        >
          {downloading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Download className="h-3 w-3" />
          )}
          JPG
        </button>
      </div>
    </div>
  );
}

// Renders an adaptation at thumbnail height honoring its fit_mode.
function AdaptationPreview({
  adaptation,
  definition,
  brandKit,
  targetH,
}: {
  adaptation: Adaptation;
  definition: TemplateDefinition;
  brandKit: BrandKitContent;
  targetH: number;
}) {
  const adaptW = adaptation.width;
  const adaptH = adaptation.height;
  const thumbScale = targetH / adaptH;
  const cssW = adaptW * thumbScale;
  const cssH = targetH;

  // Si la adaptación tiene un ajuste manual guardado, se renderiza ese
  // árbol directamente (ignora fit_mode automático).
  const manualLayout = parseOverrides(adaptation.overrides_json).manual_layout;
  if (manualLayout) {
    const resolved = resolveTreeTokens(manualLayout, brandKit);
    const bg =
      resolved.background && resolved.background.type === "color"
        ? resolved.background.value
        : "#ffffff";
    const rootIsStack = resolved.layout.mode === "stack";
    const innerStyle: CSSProperties = {
      width: adaptW,
      height: adaptH,
      transform: `scale(${thumbScale})`,
      transformOrigin: "0 0",
      position: "relative",
      ...(rootIsStack ? stackToFlexStyle(resolved.layout as StackLayout) : {}),
    };
    return (
      <div
        className="overflow-hidden rounded shadow-sm border border-border/30"
        style={{ width: cssW, height: cssH, background: bg }}
      >
        <div style={innerStyle}>
          {resolved.children.map((child: TemplateLayer) => (
            <TemplateLayerView
              key={child.id}
              layer={child}
              selectedId={null}
              onSelect={noop}
              onLayerPointerDown={noop}
              parentMode={rootIsStack ? "stack" : "free"}
            />
          ))}
        </div>
      </div>
    );
  }

  if (adaptation.fit_mode === "responsive") {
    const reflowed = reflowForPreview(definition, { w: adaptW, h: adaptH });
    const resolved = resolveTreeTokens(reflowed, brandKit);
    const bg =
      resolved.background && resolved.background.type === "color"
        ? resolved.background.value
        : "#ffffff";
    const rootIsStack = resolved.layout.mode === "stack";
    const innerStyle: CSSProperties = {
      width: adaptW,
      height: adaptH,
      transform: `scale(${thumbScale})`,
      transformOrigin: "0 0",
      position: "relative",
      ...(rootIsStack ? stackToFlexStyle(resolved.layout as StackLayout) : {}),
    };
    return (
      <div
        className="overflow-hidden rounded shadow-sm border border-border/30"
        style={{ width: cssW, height: cssH, background: bg }}
      >
        <div style={innerStyle}>
          {resolved.children.map((child: TemplateLayer) => (
            <TemplateLayerView
              key={child.id}
              layer={child}
              selectedId={null}
              onSelect={noop}
              onLayerPointerDown={noop}
              parentMode={rootIsStack ? "stack" : "free"}
            />
          ))}
        </div>
      </div>
    );
  }

  // Scale-based fit modes: render the master at its native size with a
  // uniform scale and position it inside the adaptation canvas. The
  // adaptation canvas does the clipping via overflow:hidden.
  const masterW = definition.size.w;
  const masterH = definition.size.h;
  const ratioW = adaptW / masterW;
  const ratioH = adaptH / masterH;
  let fitScale = 1;
  let centerX = false;
  let centerY = false;
  switch (adaptation.fit_mode) {
    case "contain":
      fitScale = Math.min(ratioW, ratioH);
      centerX = true;
      centerY = true;
      break;
    case "cover":
      fitScale = Math.max(ratioW, ratioH);
      centerX = true;
      centerY = true;
      break;
    case "width":
      fitScale = ratioW;
      // height anchored top, may overflow bottom
      break;
    case "height":
      fitScale = ratioH;
      // width anchored left, may overflow right
      break;
  }
  const scaledW = masterW * fitScale;
  const scaledH = masterH * fitScale;
  const offsetX = centerX ? (adaptW - scaledW) / 2 : 0;
  const offsetY = centerY ? (adaptH - scaledH) / 2 : 0;

  const resolved = resolveTreeTokens(definition, brandKit);
  const masterBg =
    resolved.background && resolved.background.type === "color"
      ? resolved.background.value
      : "#ffffff";
  const rootIsStack = resolved.layout.mode === "stack";
  const masterInnerStyle: CSSProperties = {
    width: masterW,
    height: masterH,
    position: "relative",
    background: masterBg,
    ...(rootIsStack ? stackToFlexStyle(resolved.layout as StackLayout) : {}),
  };

  // Outer takes the thumbnail size; transform scales the inner adapt-canvas
  // by thumbScale so the inner pixel math stays in adaptation coordinates.
  return (
    <div
      className="overflow-hidden rounded shadow-sm border border-border/30 relative"
      style={{
        width: cssW,
        height: cssH,
        background: masterBg,
      }}
    >
      <div
        style={{
          width: adaptW,
          height: adaptH,
          transform: `scale(${thumbScale})`,
          transformOrigin: "0 0",
          position: "relative",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            left: offsetX,
            top: offsetY,
            width: masterW,
            height: masterH,
            transform: `scale(${fitScale})`,
            transformOrigin: "0 0",
          }}
        >
          <div style={masterInnerStyle}>
            {resolved.children.map((child: TemplateLayer) => (
              <TemplateLayerView
                key={child.id}
                layer={child}
                selectedId={null}
                onSelect={noop}
                onLayerPointerDown={noop}
                parentMode={rootIsStack ? "stack" : "free"}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ----- Preset picker modal -----

function PresetPickerModal({
  presets,
  existingAdaptations,
  siblings,
  currentTemplate,
  onClose,
  onConfirmPresets,
  onAddCustom,
}: {
  presets: FormatPreset[];
  existingAdaptations: Adaptation[];
  siblings: SiblingTemplate[];
  currentTemplate: { id: number; name: string; base_width: number; base_height: number } | null;
  onClose: () => void;
  onConfirmPresets: (presetIds: number[], autoDistribute: boolean) => void;
  onAddCustom: (name: string, w: number, h: number) => void;
}) {
  const hasDesign = siblings.length > 0 && !!currentTemplate;
  const [autoDistribute, setAutoDistribute] = useState(hasDesign);
  const usedPresetIds = useMemo(
    () =>
      new Set(
        existingAdaptations
          .map((a) => a.format_preset_id)
          .filter((x): x is number => x != null)
      ),
    [existingAdaptations]
  );

  const channelsInOrder = useMemo(() => {
    const present = new Set(presets.map((p) => p.channel));
    const known = CHANNEL_ORDER.filter((c) => present.has(c));
    const extras = Array.from(present).filter((c) => !CHANNEL_ORDER.includes(c));
    return [...known, ...extras];
  }, [presets]);

  const [activeChannel, setActiveChannel] = useState<string>(
    channelsInOrder[0] ?? "custom"
  );
  // Selection persists across channel switches so the user can pick items
  // from several channels before confirming.
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const toggle = (id: number) => {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Group presets in the active channel by group_name.
  const channelPresets = presets.filter((p) => p.channel === activeChannel);
  const groups = useMemo(() => {
    const map = new Map<string, FormatPreset[]>();
    for (const p of channelPresets) {
      const key = p.group_name ?? "";
      const arr = map.get(key) ?? [];
      arr.push(p);
      map.set(key, arr);
    }
    return Array.from(map.entries()).map(([name, items]) => ({ name, items }));
  }, [channelPresets]);

  // Presets in the current channel that are eligible to be selected via
  // "Seleccionar todos" — i.e. not already added and not already selected.
  const selectableInChannel = useMemo(
    () => channelPresets.filter((p) => !usedPresetIds.has(p.id)),
    [channelPresets, usedPresetIds]
  );
  const allChannelSelected =
    selectableInChannel.length > 0 &&
    selectableInChannel.every((p) => selected.has(p.id));

  const handleSelectAllChannel = () => {
    setSelected((cur) => {
      const next = new Set(cur);
      // Toggle: if all are already selected, clear them; otherwise add all.
      if (allChannelSelected) {
        for (const p of selectableInChannel) next.delete(p.id);
      } else {
        for (const p of selectableInChannel) next.add(p.id);
      }
      return next;
    });
  };

  // Custom form state
  const [customName, setCustomName] = useState("");
  const [customW, setCustomW] = useState("1080");
  const [customH, setCustomH] = useState("1080");

  const selectedCount = selected.size;

  return (
    <div
      className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="bg-background border border-border/50 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border/50">
          <div>
            <h2 className="text-sm font-semibold">Agregar adaptaciones</h2>
            <p className="text-xs text-muted-foreground">
              Elegí uno o varios formatos del catálogo (podés seleccionar de
              distintos canales) o creá uno personalizado.
            </p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-1 min-h-0">
          {/* Channel sidebar */}
          <aside className="w-44 shrink-0 border-r border-border/50 p-2 overflow-y-auto">
            {channelsInOrder.map((c) => {
              const countInChannel = presets.filter(
                (p) => p.channel === c && selected.has(p.id)
              ).length;
              return (
                <button
                  key={c}
                  type="button"
                  onClick={() => setActiveChannel(c)}
                  className={cn(
                    "w-full text-left text-xs px-2 py-1.5 rounded-md transition-colors flex items-center justify-between gap-2",
                    activeChannel === c
                      ? "bg-primary/10 text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  )}
                >
                  <span className="truncate">{CHANNEL_LABEL[c] ?? c}</span>
                  {countInChannel > 0 && (
                    <span className="text-[10px] bg-primary/20 text-foreground rounded-full px-1.5 py-0.5 shrink-0">
                      {countInChannel}
                    </span>
                  )}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setActiveChannel("custom")}
              className={cn(
                "w-full text-left text-xs px-2 py-1.5 rounded-md transition-colors mt-1 border-t border-border/30 pt-2",
                activeChannel === "custom"
                  ? "bg-primary/10 text-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              {CHANNEL_LABEL.custom}
            </button>
          </aside>

          {/* Presets grid */}
          <div className="flex-1 overflow-y-auto p-4">
            {activeChannel === "custom" ? (
              <div className="max-w-md space-y-3">
                <p className="text-xs text-muted-foreground">
                  Definí un tamaño que no está en el catálogo. Se agrega al
                  instante (no requiere confirmar selección).
                </p>
                <input
                  type="text"
                  value={customName}
                  onChange={(e) => setCustomName(e.target.value)}
                  placeholder="Nombre (ej: Header sitio cliente)"
                  className="w-full bg-muted border border-border/50 rounded-md px-3 py-2 text-sm"
                />
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground block mb-1">
                      Ancho (px)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      value={customW}
                      onChange={(e) => setCustomW(e.target.value)}
                      className="w-full bg-muted border border-border/50 rounded-md px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="flex-1">
                    <label className="text-xs text-muted-foreground block mb-1">
                      Alto (px)
                    </label>
                    <input
                      type="number"
                      min={1}
                      max={10000}
                      value={customH}
                      onChange={(e) => setCustomH(e.target.value)}
                      className="w-full bg-muted border border-border/50 rounded-md px-3 py-2 text-sm"
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => {
                      const w = Number(customW);
                      const h = Number(customH);
                      if (
                        !customName.trim() ||
                        !Number.isFinite(w) ||
                        !Number.isFinite(h) ||
                        w <= 0 ||
                        h <= 0
                      )
                        return;
                      onAddCustom(customName.trim(), w, h);
                    }}
                    disabled={!customName.trim()}
                    className="gap-1"
                  >
                    <Plus className="h-4 w-4" /> Agregar
                  </Button>
                </div>
              </div>
            ) : groups.length === 0 ? (
              <p className="text-sm text-muted-foreground py-6 text-center">
                Sin formatos para este canal.
              </p>
            ) : (
              <div className="space-y-5">
                <div className="flex items-center justify-between">
                  <p className="text-xs text-muted-foreground">
                    {selectableInChannel.length} formato
                    {selectableInChannel.length === 1 ? "" : "s"} disponible
                    {selectableInChannel.length === 1 ? "" : "s"}
                    {" en "}
                    {CHANNEL_LABEL[activeChannel] ?? activeChannel}
                  </p>
                  {selectableInChannel.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 h-7"
                      onClick={handleSelectAllChannel}
                    >
                      <CheckSquare className="h-3.5 w-3.5" />
                      {allChannelSelected
                        ? "Quitar selección"
                        : "Seleccionar todos"}
                    </Button>
                  )}
                </div>
                {groups.map((g) => (
                  <div key={g.name}>
                    {g.name && (
                      <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
                        {g.name}
                      </h4>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {g.items.map((p) => {
                        const used = usedPresetIds.has(p.id);
                        const isSelected = selected.has(p.id);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => !used && toggle(p.id)}
                            disabled={used}
                            className={cn(
                              "border rounded-md p-2 text-left transition-colors relative",
                              used
                                ? "border-border/30 opacity-50 cursor-not-allowed"
                                : isSelected
                                ? "border-primary bg-primary/10"
                                : "border-border/50 hover:bg-muted hover:border-foreground/30"
                            )}
                            title={used ? "Ya agregado" : `${p.width}×${p.height}`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <PresetShape
                                w={p.width}
                                h={p.height}
                                orientation={p.orientation}
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-xs font-medium truncate">
                                  {p.name}
                                </p>
                                <p className="text-[10px] text-muted-foreground">
                                  {p.width}×{p.height}
                                </p>
                              </div>
                              {used ? (
                                <span className="text-[9px] text-muted-foreground">
                                  Agregado
                                </span>
                              ) : isSelected ? (
                                <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                              ) : null}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Confirm bar */}
        {activeChannel !== "custom" && (
          <div className="flex flex-col gap-2 px-5 py-3 border-t border-border/50 bg-muted/20">
            {hasDesign && (
              <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoDistribute}
                  onChange={(e) => setAutoDistribute(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="text-foreground font-medium">
                    Auto-distribuir entre las variantes del design
                  </span>
                  {" — "}
                  cada formato cae en el master del design cuya orientación
                  sea más parecida (actual + {siblings.length} hermano
                  {siblings.length === 1 ? "" : "s"}).
                </span>
              </label>
            )}
            {hasDesign && autoDistribute && selectedCount > 0 && currentTemplate && (
              <DistributionPreview
                presets={presets}
                selectedIds={Array.from(selected)}
                candidates={[
                  { id: currentTemplate.id, name: currentTemplate.name, base_width: currentTemplate.base_width, base_height: currentTemplate.base_height },
                  ...siblings.map((s) => ({ id: s.id, name: s.name, base_width: s.base_width, base_height: s.base_height })),
                ]}
              />
            )}
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                {selectedCount === 0
                  ? "Ningún formato seleccionado"
                  : `${selectedCount} formato${selectedCount === 1 ? "" : "s"} listo${selectedCount === 1 ? "" : "s"} para agregar`}
              </p>
              <div className="flex items-center gap-2">
                {selectedCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelected(new Set())}
                  >
                    Limpiar
                  </Button>
                )}
                <Button
                  size="sm"
                  disabled={selectedCount === 0}
                  onClick={() => onConfirmPresets(Array.from(selected), autoDistribute)}
                  className="gap-1"
                >
                  <Plus className="h-4 w-4" />
                  Agregar
                  {selectedCount > 0 ? ` (${selectedCount})` : ""}
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Muestra cuántos formatos van a cada master cuando el toggle de
// auto-distribuir está activo. Le da feedback al productor antes de confirmar.
function DistributionPreview({
  presets,
  selectedIds,
  candidates,
}: {
  presets: FormatPreset[];
  selectedIds: number[];
  candidates: { id: number; name: string; base_width: number; base_height: number }[];
}) {
  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const id of selectedIds) {
      const p = presets.find((x) => x.id === id);
      if (!p) continue;
      const best = pickBestTemplate(p.width, p.height, candidates);
      m.set(best, (m.get(best) ?? 0) + 1);
    }
    return m;
  }, [presets, selectedIds, candidates]);

  return (
    <div className="flex flex-wrap gap-2 text-[10px] text-muted-foreground bg-background/40 rounded px-2 py-1.5">
      {candidates.map((c) => {
        const n = counts.get(c.id) ?? 0;
        if (n === 0) return null;
        return (
          <span key={c.id} className="inline-flex items-center gap-1">
            <span className="font-medium text-foreground">{c.name}</span>
            <span className="text-muted-foreground/70">
              ({c.base_width}×{c.base_height})
            </span>
            <span className="bg-primary/20 text-foreground rounded-full px-1.5">
              {n}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function PresetShape({
  w,
  h,
  orientation,
}: {
  w: number;
  h: number;
  orientation: "horizontal" | "vertical" | "square";
}) {
  // Stylized small shape that hints at the aspect ratio.
  const max = 24;
  const ratio = w / h;
  const dispW = ratio >= 1 ? max : max * ratio;
  const dispH = ratio >= 1 ? max / ratio : max;
  return (
    <div
      className={cn(
        "border rounded-sm shrink-0",
        orientation === "square"
          ? "border-blue-400/60"
          : orientation === "horizontal"
          ? "border-emerald-400/60"
          : "border-purple-400/60"
      )}
      style={{ width: Math.max(8, dispW), height: Math.max(8, dispH) }}
    />
  );
}

function noop() {}

// Devuelve el id del template cuyo aspect ratio es más cercano al del preset.
// Usado por la distribución automática dentro de un design: cada formato va
// al master de orientación más parecida.
function pickBestTemplate(
  presetW: number,
  presetH: number,
  candidates: { id: number; base_width: number; base_height: number }[],
): number {
  const presetRatio = presetW / presetH;
  let bestId = candidates[0].id;
  let bestDiff = Infinity;
  for (const c of candidates) {
    const r = c.base_width / c.base_height;
    const diff = Math.abs(presetRatio - r) / Math.min(presetRatio, r);
    if (diff < bestDiff) {
      bestId = c.id;
      bestDiff = diff;
    }
  }
  return bestId;
}
