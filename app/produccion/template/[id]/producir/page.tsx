"use client";

import { useCallback, useEffect, useMemo, useState, CSSProperties } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Check,
  CheckSquare,
  Loader2,
  Plus,
  Rocket,
  Trash2,
  X,
} from "lucide-react";
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
  name: string;
  base_width: number;
  base_height: number;
  thumbnail_url: string | null;
  status: "draft" | "published" | "archived";
  version: number;
  definition: TemplateDefinition | null;
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

interface Adaptation {
  id: number;
  template_id: number;
  format_preset_id: number | null;
  custom_name: string | null;
  width: number;
  height: number;
  is_active: number;
  thumbnail_url: string | null;
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

      const [projRes, presetsBaseRes] = await Promise.all([
        fetch(`/api/production/projects/${tpl.production_project_id}`),
        fetch(`/api/production/format-presets`),
      ]);
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

  const handleAddBulk = async (presetIds: number[]) => {
    if (presetIds.length === 0) return;
    const res = await fetch(`/api/production/templates/${templateId}/adaptations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ format_preset_ids: presetIds }),
    });
    if (res.ok) {
      setShowPicker(false);
      fetchAdaptations();
    }
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
              constraints de cada capa. Podés editar el master en cualquier
              momento y todas las adaptaciones se reflowean automáticamente.
            </p>
          </div>
        </section>

        {/* Adaptations list */}
        <section className="bg-card rounded-xl border border-border/50 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-medium">Adaptaciones</h3>
              <p className="text-xs text-muted-foreground mt-0.5">
                Una pieza de salida por formato. Click en + para agregar.
              </p>
            </div>
            <Button size="sm" onClick={() => setShowPicker(true)} className="gap-1">
              <Plus className="h-4 w-4" /> Agregar adaptación
            </Button>
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
                  onDelete={() => handleDelete(a.id)}
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
          onClose={() => setShowPicker(false)}
          onConfirmPresets={handleAddBulk}
          onAddCustom={handleAddCustom}
        />
      )}
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
  onDelete,
  deleting,
}: {
  adaptation: Adaptation;
  definition: TemplateDefinition;
  brandKit: BrandKitContent;
  onDelete: () => void;
  deleting: boolean;
}) {
  const label =
    adaptation.custom_name ||
    adaptation.preset_name ||
    `${adaptation.width}×${adaptation.height}`;
  const channel =
    adaptation.preset_channel ||
    (adaptation.format_preset_id == null ? "custom" : null);

  const reflowed = reflowForPreview(definition, {
    w: adaptation.width,
    h: adaptation.height,
  });
  const resolved = resolveTreeTokens(reflowed, brandKit);
  const TARGET_H = 160;
  const scale = TARGET_H / adaptation.height;
  const cssW = adaptation.width * scale;
  const bg =
    resolved.background && resolved.background.type === "color"
      ? resolved.background.value
      : "#ffffff";
  const rootIsStack = resolved.layout.mode === "stack";
  const innerStyle: CSSProperties = {
    width: adaptation.width,
    height: adaptation.height,
    transform: `scale(${scale})`,
    transformOrigin: "0 0",
    position: "relative",
    ...(rootIsStack ? stackToFlexStyle(resolved.layout as StackLayout) : {}),
  };

  return (
    <div className="bg-muted/50 rounded-lg p-3 flex flex-col gap-2 group">
      <div className="flex items-center justify-center bg-background/40 rounded">
        <div
          className="overflow-hidden rounded shadow-sm border border-border/30"
          style={{ width: cssW, height: TARGET_H, background: bg }}
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
    </div>
  );
}

// ----- Preset picker modal -----

function PresetPickerModal({
  presets,
  existingAdaptations,
  onClose,
  onConfirmPresets,
  onAddCustom,
}: {
  presets: FormatPreset[];
  existingAdaptations: Adaptation[];
  onClose: () => void;
  onConfirmPresets: (presetIds: number[]) => void;
  onAddCustom: (name: string, w: number, h: number) => void;
}) {
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
          <div className="flex items-center justify-between px-5 py-3 border-t border-border/50 bg-muted/20">
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
                onClick={() => onConfirmPresets(Array.from(selected))}
                className="gap-1"
              >
                <Plus className="h-4 w-4" />
                Agregar
                {selectedCount > 0 ? ` (${selectedCount})` : ""}
              </Button>
            </div>
          </div>
        )}
      </div>
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
