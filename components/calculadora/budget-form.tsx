"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Plus, Trash2, Loader2, Calculator,
  Video, ImageIcon, UserPlus, ChevronDown, ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// --- Format number with thousand separators ---
function fmtNum(n: number): string {
  return n.toLocaleString("es-CL");
}

// --- Number input helper: allows clearing and typing freely ---
function NumInput({
  value, onChange, min, step, className, placeholder, isCurrency,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  step?: number;
  className?: string;
  placeholder?: string;
  isCurrency?: boolean;
}) {
  const fmtValue = (v: number) => v === 0 ? "" : (isCurrency ? fmtNum(v) : String(v));
  const [raw, setRaw] = useState(fmtValue(value));
  const [focused, setFocused] = useState(false);

  // Sync from parent when value changes externally and not focused
  useEffect(() => {
    if (!focused) {
      setRaw(fmtValue(value));
    }
  }, [value, focused, isCurrency]);

  const parseRaw = (v: string): number => {
    // Remove thousand separators (dots in es-CL) before parsing
    const cleaned = v.replace(/\./g, "").replace(/,/g, ".");
    return Number(cleaned);
  };

  return (
    <Input
      type="text"
      inputMode="decimal"
      className={className}
      placeholder={placeholder}
      value={raw}
      onFocus={() => {
        setFocused(true);
        // On focus, show raw number without formatting
        setRaw(value === 0 && !min ? "" : String(value));
      }}
      onChange={e => {
        const v = e.target.value;
        // Allow digits, dots, commas, minus
        setRaw(v);
        const num = parseRaw(v);
        if (v !== "" && !isNaN(num)) {
          onChange(min !== undefined ? Math.max(min, num) : num);
        }
      }}
      onBlur={() => {
        setFocused(false);
        const num = parseRaw(raw);
        if (raw === "" || isNaN(num)) {
          const fallback = min ?? 0;
          onChange(fallback);
          setRaw(fmtValue(fallback));
        } else {
          const final = min !== undefined ? Math.max(min, num) : num;
          onChange(final);
          setRaw(fmtValue(final));
        }
      }}
    />
  );
}

// Types
interface Client { id: number; name: string; }
interface UserOption { id: number; name: string | null; email: string; cargo: string; }

interface CalcConfig {
  tech_fee: number;
  video: { basePlano: number; lipSync: number; training: number; complejo: number; adaptacion: number; reduccion: number; };
  foto: { baseImagen: number; training: number; capas: number; upscale: number; retouch: { b: number; m: number; c: number }; };
}

interface HourEntry { user_id: number; hours: number; }
interface ExternalCost { name: string; amount: number; }

interface ReductionEntry {
  durRed: number; red169: number; red916: number; red11: number; red45: number;
  redOtroLabel: string; redOtro: number;
}

interface VideoData {
  planos: number; complejos: number; lipSync: boolean; training: boolean;
  durMaster: number; ratio: string; ratioCustom: string;
  ad169: number; ad916: number; ad11: number; ad45: number;
  reductions: ReductionEntry[];
}

interface PhotoData {
  imagenes: number; training: boolean; upscale: boolean; capas: boolean;
  retQty: number; retLevel: string; retLevelValue: number;
}

interface BudgetItem {
  id: string; type: "video" | "photo";
  diasHabiles: number; hours: HourEntry[];
  videoData: VideoData; photoData: PhotoData;
  externals: ExternalCost[]; expanded: boolean; subtotal: number;
}

function generateId() { return Math.random().toString(36).slice(2, 9); }
function formatCurrency(n: number): string { return "$" + Math.round(n).toLocaleString("es-CL"); }

const DEFAULT_VIDEO_DATA: VideoData = {
  planos: 0, complejos: 0, lipSync: false, training: false,
  durMaster: 0, ratio: "16:9 (Horizontal)", ratioCustom: "",
  ad169: 0, ad916: 0, ad11: 0, ad45: 0,
  reductions: [],
};

const DEFAULT_PHOTO_DATA: PhotoData = {
  imagenes: 0, training: false, upscale: false, capas: false,
  retQty: 0, retLevel: "b", retLevelValue: 0,
};

function createItem(type: "video" | "photo"): BudgetItem {
  return {
    id: generateId(), type, diasHabiles: 0,
    hours: [], videoData: { ...DEFAULT_VIDEO_DATA }, photoData: { ...DEFAULT_PHOTO_DATA },
    externals: [], expanded: true, subtotal: 0,
  };
}

// --- Aspect ratio helpers ---
function getRatioKey(ratio: string): string | null {
  if (ratio.startsWith("16:9")) return "169";
  if (ratio.startsWith("9:16")) return "916";
  if (ratio.startsWith("1:1")) return "11";
  if (ratio.startsWith("4:5")) return "45";
  return null;
}

// Calculation engine
function calcVideoSubtotal(data: VideoData, config: CalcConfig["video"]): number {
  const base = data.planos * config.basePlano;
  const cLip = data.lipSync ? base * config.lipSync : 0;
  const cTr = data.training ? base * config.training : 0;
  const cComp = (base * config.complejo) * data.complejos;
  const subM = base + cLip + cTr + cComp;
  const adT = data.ad169 + data.ad916 + data.ad11 + (data.ad45 || 0);
  const reT = (data.reductions || []).reduce((sum, r) => sum + r.red169 + r.red916 + r.red11 + (r.red45 || 0) + (r.redOtro || 0), 0);
  const cAd = (base * config.adaptacion) * adT;
  const cRe = (base * config.reduccion) * reT;
  return subM + cAd + cRe;
}

function calcPhotoSubtotal(data: PhotoData, config: CalcConfig["foto"]): number {
  const base = data.imagenes * config.baseImagen;
  const cTr = data.training ? base * config.training : 0;
  const retLevelVal = data.retLevel === "b" ? config.retouch.b : data.retLevel === "m" ? config.retouch.m : config.retouch.c;
  const cRet = data.retQty * retLevelVal;
  const cUp = data.upscale ? data.imagenes * config.upscale : 0;
  const subPre = base + cTr + cRet + cUp;
  const cCap = data.capas ? subPre * config.capas : 0;
  return subPre + cCap;
}

function calcItemSubtotal(item: BudgetItem, config: CalcConfig): number {
  const typeSubtotal = item.type === "video"
    ? calcVideoSubtotal(item.videoData, config.video)
    : calcPhotoSubtotal(item.photoData, config.foto);
  const extTotal = item.externals.reduce((sum, e) => sum + (e.amount || 0), 0);
  return typeSubtotal + extTotal;
}

export function BudgetForm({ budgetId }: { budgetId?: string }) {
  const router = useRouter();
  const isEdit = !!budgetId;
  const [clients, setClients] = useState<Client[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [config, setConfig] = useState<CalcConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  // Form state
  const [clientId, setClientId] = useState<number | null>(null);
  const [projectName, setProjectName] = useState("");
  const [detail, setDetail] = useState("");
  const [items, setItems] = useState<BudgetItem[]>([]);
  const [globalExternals, setGlobalExternals] = useState<ExternalCost[]>([]);
  const [discountAmount, setDiscountAmount] = useState(0);
  const [discountType, setDiscountType] = useState<"amount" | "percent">("amount");
  const [discountReason, setDiscountReason] = useState("");
  const [techFeeEnabled, setTechFeeEnabled] = useState(true);

  useEffect(() => {
    const fetches: Promise<unknown>[] = [
      fetch("/api/calculadora/clients").then(r => r.json()),
      fetch("/api/calculadora/users").then(r => r.json()),
      fetch("/api/calculadora/config").then(r => r.json()),
    ];
    if (isEdit) {
      fetches.push(fetch(`/api/calculadora/${budgetId}`).then(r => r.json()));
    }

    Promise.all(fetches).then(([c, u, cfg, budgetData]) => {
      setClients(c as Client[]);
      setUsers(u as UserOption[]);
      setConfig(cfg as CalcConfig);

      if (isEdit && budgetData) {
        const b = budgetData as Record<string, unknown>;
        setClientId(b.client_id as number | null);
        setProjectName((b.project_name as string) || "");
        setDetail((b.detail as string) || "");
        setDiscountAmount((b.discount_amount as number) || 0);
        setDiscountType((b.discount_type as "amount" | "percent") || "amount");
        setDiscountReason((b.discount_reason as string) || "");
        setTechFeeEnabled((b.tech_fee_percent as number) > 0);

        // Map items
        const apiItems = (b.items as Record<string, unknown>[]) || [];
        const mappedItems: BudgetItem[] = apiItems.map((apiItem) => {
          const itemData = apiItem.item_data as Record<string, unknown> || {};
          const type = apiItem.type as "video" | "photo";

          let videoData: VideoData = { ...DEFAULT_VIDEO_DATA };
          let photoData: PhotoData = { ...DEFAULT_PHOTO_DATA };

          if (type === "video") {
            videoData = {
              planos: (itemData.planos as number) || 0,
              complejos: (itemData.complejos as number) || 0,
              lipSync: !!itemData.lipSync,
              training: !!itemData.training,
              durMaster: (itemData.durMaster as number) || 0,
              ratio: (itemData.ratio as string) || "16:9 (Horizontal)",
              ratioCustom: (itemData.ratioCustom as string) || "",
              ad169: (itemData.ad169 as number) || 0,
              ad916: (itemData.ad916 as number) || 0,
              ad11: (itemData.ad11 as number) || 0,
              ad45: (itemData.ad45 as number) || 0,
              reductions: ((itemData.reductions as ReductionEntry[]) || []).map(r => ({
                durRed: r.durRed || 0,
                red169: r.red169 || 0,
                red916: r.red916 || 0,
                red11: r.red11 || 0,
                red45: r.red45 || 0,
                redOtroLabel: r.redOtroLabel || "",
                redOtro: r.redOtro || 0,
              })),
            };
          } else {
            photoData = {
              imagenes: (itemData.imagenes as number) || 0,
              training: !!itemData.training,
              upscale: !!itemData.upscale,
              capas: !!itemData.capas,
              retQty: (itemData.retQty as number) || 0,
              retLevel: (itemData.retLevel as string) || "b",
              retLevelValue: (itemData.retLevelValue as number) || 0,
            };
          }

          // Map hours
          const apiHours = (apiItem.hours as Record<string, unknown>[]) || [];
          const hours: HourEntry[] = apiHours.map(h => ({
            user_id: (h.user_id as number) || 0,
            hours: (h.hours as number) || 0,
          }));

          // Map item externals
          const apiExternals = (apiItem.externals as Record<string, unknown>[]) || [];
          const externals: ExternalCost[] = apiExternals.map(e => ({
            name: (e.name as string) || "",
            amount: (e.amount as number) || 0,
          }));

          return {
            id: generateId(),
            type,
            diasHabiles: (apiItem.dias_habiles as number) || 0,
            hours,
            videoData,
            photoData,
            externals,
            expanded: true,
            subtotal: (apiItem.subtotal as number) || 0,
          };
        });

        setItems(mappedItems);

        // Map global externals
        const apiGlobalExts = (b.externals as Record<string, unknown>[]) || [];
        setGlobalExternals(apiGlobalExts.map(e => ({
          name: (e.name as string) || "",
          amount: (e.amount as number) || 0,
        })));
      }

      setLoading(false);
    });
  }, []);

  const recalcItems = useCallback(() => {
    if (!config) return;
    setItems(prev => prev.map(item => ({ ...item, subtotal: calcItemSubtotal(item, config) })));
  }, [config]);

  useEffect(() => { recalcItems(); }, [config]);

  // Calculations
  const itemsSubtotal = items.reduce((sum, item) => sum + item.subtotal, 0);
  const globalExtTotal = globalExternals.reduce((sum, e) => sum + (e.amount || 0), 0);
  const accum = itemsSubtotal + globalExtTotal;
  const techFeePercent = config?.tech_fee ?? 0.05;
  const techFee = techFeeEnabled ? accum * techFeePercent : 0;
  const preDiscount = accum + techFee;
  const discountValue = discountType === "percent"
    ? preDiscount * ((discountAmount || 0) / 100)
    : (discountAmount || 0);
  const total = preDiscount - discountValue;

  const updateItem = (id: string, updates: Partial<BudgetItem>) => {
    setItems(prev => prev.map(item => {
      if (item.id !== id) return item;
      const updated = { ...item, ...updates };
      if (config) updated.subtotal = calcItemSubtotal(updated, config);
      return updated;
    }));
  };

  const removeItem = (id: string) => setItems(prev => prev.filter(item => item.id !== id));

  const addItem = (type: "video" | "photo") => {
    const item = createItem(type);
    if (config) item.subtotal = calcItemSubtotal(item, config);
    setItems(prev => [...prev, item]);
  };

  const handleSave = async () => {
    if (!projectName.trim()) { alert("El nombre del proyecto es requerido"); return; }
    if (items.length === 0) { alert("Debe agregar al menos un ítem"); return; }

    setSaving(true);
    try {
      const payload = {
        client_id: clientId,
        project_name: projectName,
        detail: detail || null,
        tech_fee_percent: techFeeEnabled ? techFeePercent : 0,
        discount_amount: discountAmount,
        discount_type: discountType,
        discount_reason: discountReason || null,
        subtotal: accum,
        total,
        items: items.map((item, i) => ({
          type: item.type,
          sort_order: i,
          mode: "dias_habiles",
          dias_habiles: item.diasHabiles,
          item_data: item.type === "video" ? item.videoData : item.photoData,
          subtotal: item.subtotal,
          hours: item.hours.filter(h => h.user_id && h.hours > 0),
          externals: item.externals.filter(e => e.name && e.amount > 0),
        })),
        externals: globalExternals.filter(e => e.name && e.amount > 0),
      };

      const url = isEdit ? `/api/calculadora/${budgetId}` : "/api/calculadora";
      const method = isEdit ? "PUT" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (res.ok) {
        const data = await res.json();
        router.push(`/calculadora/${data.id}`);
      } else {
        const err = await res.json();
        alert(err.error || "Error al guardar");
      }
    } catch { alert("Error de conexión"); }
    finally { setSaving(false); }
  };

  if (!config || loading) {
    return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center gap-4 mb-8">
          <Link href={isEdit ? `/calculadora/${budgetId}` : "/calculadora"}><Button variant="ghost" size="icon"><ArrowLeft className="h-5 w-5" /></Button></Link>
          <div className="flex items-center gap-3">
            <Calculator className="h-7 w-7 text-primary" />
            <h1 className="text-2xl font-bold">{isEdit ? `Editar Presupuesto #${budgetId}` : "Nuevo Presupuesto"}</h1>
          </div>
        </div>

        {/* General Data */}
        <Card className="mb-6">
          <CardHeader><CardTitle className="text-base">Datos Generales</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Cliente</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={clientId ?? ""}
                  onChange={e => setClientId(e.target.value ? Number(e.target.value) : null)}
                >
                  <option value="">Sin cliente</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <Label>Nombre del Proyecto</Label>
                <Input value={projectName} onChange={e => setProjectName(e.target.value)} placeholder="Ej: Campaña Verano 2026" />
              </div>
            </div>
            <div>
              <Label>Detalle</Label>
              <Textarea
                value={detail}
                onChange={e => setDetail(e.target.value)}
                placeholder="Descripción general del proyecto, alcance, observaciones..."
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        {/* Items */}
        <div className="space-y-4 mb-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Ítems de Cotización</h2>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => addItem("video")}>
                <Video className="h-4 w-4 mr-1" /> + Video
              </Button>
              <Button variant="outline" size="sm" onClick={() => addItem("photo")}>
                <ImageIcon className="h-4 w-4 mr-1" /> + Foto
              </Button>
            </div>
          </div>

          {items.length === 0 && (
            <div className="text-center py-8 text-muted-foreground border border-dashed rounded-lg">
              Agrega un ítem de Video o Foto para comenzar
            </div>
          )}

          {items.map((item, idx) => (
            <BudgetItemCard
              key={item.id} item={item} index={idx} config={config} users={users}
              onUpdate={(updates) => updateItem(item.id, updates)}
              onRemove={() => removeItem(item.id)}
            />
          ))}
        </div>

        {/* Global Externals */}
        <Card className="mb-6">
          <CardHeader><CardTitle className="text-base">Costos Externos Globales</CardTitle></CardHeader>
          <CardContent>
            <ExternalCostList externals={globalExternals} onChange={setGlobalExternals} />
          </CardContent>
        </Card>

        {/* Discount */}
        <Card className="mb-6">
          <CardHeader><CardTitle className="text-base">Descuento</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <Label>Tipo</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  value={discountType}
                  onChange={e => setDiscountType(e.target.value as "amount" | "percent")}
                >
                  <option value="amount">Monto ($)</option>
                  <option value="percent">Porcentaje (%)</option>
                </select>
              </div>
              <div>
                <Label>{discountType === "amount" ? "Monto ($)" : "Porcentaje (%)"}</Label>
                <NumInput value={discountAmount} onChange={setDiscountAmount} min={0} placeholder="0" isCurrency={discountType === "amount"} />
                {discountType === "percent" && discountAmount > 0 && (
                  <p className="text-xs text-muted-foreground mt-1">= {formatCurrency(discountValue)}</p>
                )}
              </div>
              <div>
                <Label>Razón</Label>
                <Input value={discountReason} onChange={e => setDiscountReason(e.target.value)} placeholder="Motivo del descuento" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Summary */}
        <Card className="mb-6 border-primary/50">
          <CardContent className="pt-6">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal ítems</span>
                <span className="font-mono">{formatCurrency(itemsSubtotal)}</span>
              </div>
              {globalExtTotal > 0 && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Costos externos globales</span>
                  <span className="font-mono">{formatCurrency(globalExtTotal)}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-muted-foreground">Acumulado</span>
                <span className="font-mono">{formatCurrency(accum)}</span>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex items-center gap-2">
                  <Switch checked={techFeeEnabled} onCheckedChange={setTechFeeEnabled} />
                  <span className="text-muted-foreground">Tech Fee ({(techFeePercent * 100).toFixed(0)}%)</span>
                </div>
                <span className="font-mono">{formatCurrency(techFee)}</span>
              </div>
              {discountValue > 0 && (
                <div className="flex justify-between text-red-500">
                  <span>Descuento {discountType === "percent" ? `(${discountAmount}%)` : ""}</span>
                  <span className="font-mono">-{formatCurrency(discountValue)}</span>
                </div>
              )}
              <div className="flex justify-between pt-3 border-t text-lg font-bold">
                <span>Total Final</span>
                <span className="font-mono text-primary">{formatCurrency(total)}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex gap-3 justify-end">
          <Link href={isEdit ? `/calculadora/${budgetId}` : "/calculadora"}><Button variant="outline">Cancelar</Button></Link>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isEdit ? "Actualizar Presupuesto" : "Guardar Presupuesto"}
          </Button>
        </div>
      </div>
    </div>
  );
}

// ---- Sub-components ----

function BudgetItemCard({
  item, index, config, users, onUpdate, onRemove,
}: {
  item: BudgetItem; index: number; config: CalcConfig; users: UserOption[];
  onUpdate: (updates: Partial<BudgetItem>) => void; onRemove: () => void;
}) {
  const isVideo = item.type === "video";
  const TypeIcon = isVideo ? Video : ImageIcon;

  const updateVideoData = (updates: Partial<VideoData>) => {
    onUpdate({ videoData: { ...item.videoData, ...updates } });
  };
  const updatePhotoData = (updates: Partial<PhotoData>) => {
    onUpdate({ photoData: { ...item.photoData, ...updates } });
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-md ${isVideo ? "bg-blue-500/10" : "bg-purple-500/10"}`}>
              <TypeIcon className={`h-4 w-4 ${isVideo ? "text-blue-500" : "text-purple-500"}`} />
            </div>
            <CardTitle className="text-base">Ítem {index + 1} — {isVideo ? "Video" : "Foto"}</CardTitle>
            <span className="text-sm font-mono text-muted-foreground">{formatCurrency(item.subtotal)}</span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={() => onUpdate({ expanded: !item.expanded })}>
              {item.expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
            <Button variant="ghost" size="icon" onClick={onRemove}>
              <Trash2 className="h-4 w-4 text-destructive" />
            </Button>
          </div>
        </div>
      </CardHeader>

      {item.expanded && (
        <CardContent className="space-y-6">
          {/* Delivery time + optional hours */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Plazo de entrega (días hábiles)</Label>
              <NumInput value={item.diasHabiles} onChange={v => onUpdate({ diasHabiles: v })} min={0} placeholder="0" />
            </div>
          </div>

          {/* Hours section (optional) */}
          <HoursSection hours={item.hours} users={users} diasHabiles={item.diasHabiles} onChange={hours => onUpdate({ hours })} />

          {/* Type-specific fields */}
          {isVideo ? (
            <VideoFields data={item.videoData} config={config} onChange={updateVideoData} />
          ) : (
            <PhotoFields data={item.photoData} config={config} onChange={updatePhotoData} />
          )}

          {/* Item externals */}
          <div>
            <Label className="mb-2 block text-muted-foreground">Costos externos del ítem</Label>
            <ExternalCostList externals={item.externals} onChange={externals => onUpdate({ externals })} />
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function VideoFields({
  data, config, onChange,
}: { data: VideoData; config: CalcConfig; onChange: (updates: Partial<VideoData>) => void; }) {
  const masterKey = getRatioKey(data.ratio);

  return (
    <div className="space-y-4">
      <Label className="text-primary font-semibold">Producción Audiovisual</Label>

      <div className="grid grid-cols-2 gap-4">
        <div><Label>Planos Totales</Label><NumInput value={data.planos} onChange={v => onChange({ planos: v })} min={0} placeholder="0" /></div>
        <div><Label>Planos Complejos</Label><NumInput value={data.complejos} onChange={v => onChange({ complejos: v })} min={0} placeholder="0" /></div>
      </div>

      <div className="flex gap-6">
        <div className="flex items-center gap-2">
          <Switch checked={data.lipSync} onCheckedChange={v => onChange({ lipSync: v })} />
          <Label>Lip-sync</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={data.training} onCheckedChange={v => onChange({ training: v })} />
          <Label>Entrenamiento IA</Label>
        </div>
      </div>

      <div className="border-t pt-4">
        <Label className="text-primary text-sm">Máster</Label>
        <div className="grid grid-cols-2 gap-4 mt-2">
          <div><Label>Duración (seg)</Label><NumInput value={data.durMaster} onChange={v => onChange({ durMaster: v })} min={0} placeholder="0" /></div>
          <div>
            <Label>Relación de Aspecto</Label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={data.ratio}
              onChange={e => onChange({ ratio: e.target.value })}
            >
              <option value="16:9 (Horizontal)">16:9 (Horizontal)</option>
              <option value="9:16 (Vertical)">9:16 (Vertical)</option>
              <option value="1:1 (Cuadrado)">1:1 (Cuadrado)</option>
              <option value="4:5 (Vertical)">4:5 (Vertical)</option>
              <option value="Otro">Otro...</option>
            </select>
            {data.ratio === "Otro" && (
              <Input className="mt-2" placeholder="Ej: 4:5" value={data.ratioCustom} onChange={e => onChange({ ratioCustom: e.target.value })} />
            )}
          </div>
        </div>
      </div>

      {/* Adaptations — hide the ratio that matches master */}
      <div>
        <Label className="text-sm">Adaptaciones Máster</Label>
        <div className="grid grid-cols-4 gap-3 mt-2">
          {masterKey !== "169" && (
            <div><Label>16:9</Label><NumInput value={data.ad169} onChange={v => onChange({ ad169: v })} min={0} placeholder="0" /></div>
          )}
          {masterKey !== "916" && (
            <div><Label>9:16</Label><NumInput value={data.ad916} onChange={v => onChange({ ad916: v })} min={0} placeholder="0" /></div>
          )}
          {masterKey !== "11" && (
            <div><Label>1:1</Label><NumInput value={data.ad11} onChange={v => onChange({ ad11: v })} min={0} placeholder="0" /></div>
          )}
          {masterKey !== "45" && (
            <div><Label>4:5</Label><NumInput value={data.ad45} onChange={v => onChange({ ad45: v })} min={0} placeholder="0" /></div>
          )}
        </div>
      </div>

      {/* Reductions — multiple entries */}
      <div>
        <Label className="text-primary text-sm">Reducciones</Label>
        <div className="space-y-3 mt-2">
          {(data.reductions || []).map((red, idx) => (
            <div key={idx} className="border rounded-md p-3 space-y-2 bg-muted/30">
              <div className="flex items-center justify-between">
                <Label className="text-xs text-muted-foreground">Reducción {idx + 1}</Label>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => {
                  const next = [...data.reductions];
                  next.splice(idx, 1);
                  onChange({ reductions: next });
                }}>
                  <Trash2 className="h-3.5 w-3.5 text-destructive" />
                </Button>
              </div>
              <div className="grid grid-cols-5 gap-3">
                <div><Label>Duración (seg)</Label><NumInput value={red.durRed} onChange={v => {
                  const next = [...data.reductions];
                  next[idx] = { ...next[idx], durRed: v };
                  onChange({ reductions: next });
                }} min={0} placeholder="0" /></div>
                <div><Label>16:9</Label><NumInput value={red.red169} onChange={v => {
                  const next = [...data.reductions];
                  next[idx] = { ...next[idx], red169: v };
                  onChange({ reductions: next });
                }} min={0} placeholder="0" /></div>
                <div><Label>9:16</Label><NumInput value={red.red916} onChange={v => {
                  const next = [...data.reductions];
                  next[idx] = { ...next[idx], red916: v };
                  onChange({ reductions: next });
                }} min={0} placeholder="0" /></div>
                <div><Label>1:1</Label><NumInput value={red.red11} onChange={v => {
                  const next = [...data.reductions];
                  next[idx] = { ...next[idx], red11: v };
                  onChange({ reductions: next });
                }} min={0} placeholder="0" /></div>
                <div><Label>4:5</Label><NumInput value={red.red45} onChange={v => {
                  const next = [...data.reductions];
                  next[idx] = { ...next[idx], red45: v };
                  onChange({ reductions: next });
                }} min={0} placeholder="0" /></div>
              </div>
              <div className="grid grid-cols-5 gap-3">
                <div className="col-span-2 flex gap-2 items-end rounded-md bg-muted/50 p-2">
                  <div className="flex-1"><Label>Otro aspecto</Label><Input placeholder="21:9" value={red.redOtroLabel || ""} onChange={e => {
                    const next = [...data.reductions];
                    next[idx] = { ...next[idx], redOtroLabel: e.target.value };
                    onChange({ reductions: next });
                  }} /></div>
                  <div className="w-16"><Label>Cant.</Label><NumInput value={red.redOtro || 0} onChange={v => {
                    const next = [...data.reductions];
                    next[idx] = { ...next[idx], redOtro: v };
                    onChange({ reductions: next });
                  }} min={0} placeholder="0" /></div>
                </div>
              </div>
            </div>
          ))}
          <Button variant="outline" size="sm" onClick={() => {
            onChange({ reductions: [...(data.reductions || []), { durRed: 0, red169: 0, red916: 0, red11: 0, red45: 0, redOtroLabel: "", redOtro: 0 }] });
          }}>
            <Plus className="h-4 w-4 mr-1" /> Agregar Reducción
          </Button>
        </div>
      </div>
    </div>
  );
}

function PhotoFields({
  data, config, onChange,
}: { data: PhotoData; config: CalcConfig; onChange: (updates: Partial<PhotoData>) => void; }) {
  return (
    <div className="space-y-4">
      <Label className="text-primary font-semibold">Producción Fotográfica</Label>

      <div className="max-w-[200px]">
        <Label>N° Imágenes Finales</Label>
        <NumInput value={data.imagenes} onChange={v => {
          const updates: Partial<PhotoData> = { imagenes: v };
          if (data.retQty > v) updates.retQty = v;
          onChange(updates);
        }} min={0} placeholder="0" />
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Switch checked={data.training} onCheckedChange={v => onChange({ training: v })} />
          <Label>Entrenamiento IA (+100%)</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={data.upscale} onCheckedChange={v => onChange({ upscale: v })} />
          <Label>Escalado (Alta Res)</Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={data.capas} onCheckedChange={v => onChange({ capas: v })} />
          <Label>Entrega en Capas (+50%)</Label>
        </div>
      </div>

      <div className="border-t pt-4">
        <Label className="text-primary text-sm">Retoque Manual</Label>
        <div className="grid grid-cols-2 gap-4 mt-2">
          <div><Label>Cantidad de Fotos</Label><NumInput value={data.retQty} onChange={v => onChange({ retQty: Math.min(v, data.imagenes) })} min={0} placeholder="0" /></div>
          <div>
            <Label>Nivel de Retoque</Label>
            <select
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              value={data.retLevel}
              onChange={e => onChange({ retLevel: e.target.value })}
            >
              <option value="b">Básico ({formatCurrency(config.foto.retouch.b)})</option>
              <option value="m">Medio ({formatCurrency(config.foto.retouch.m)})</option>
              <option value="c">Complejo ({formatCurrency(config.foto.retouch.c)})</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}

function HoursSection({
  hours, users, diasHabiles, onChange,
}: { hours: HourEntry[]; users: UserOption[]; diasHabiles: number; onChange: (hours: HourEntry[]) => void; }) {
  const addPerson = () => onChange([...hours, { user_id: 0, hours: 0 }]);
  const maxHoursPerPerson = diasHabiles > 0 ? diasHabiles * 24 : undefined;
  const updateEntry = (idx: number, updates: Partial<HourEntry>) => {
    if (updates.hours !== undefined && maxHoursPerPerson !== undefined && updates.hours > maxHoursPerPerson) {
      updates.hours = maxHoursPerPerson;
    }
    onChange(hours.map((h, i) => i === idx ? { ...h, ...updates } : h));
  };
  const removeEntry = (idx: number) => onChange(hours.filter((_, i) => i !== idx));
  const selectedUserIds = new Set(hours.map(h => h.user_id));

  return (
    <div className="space-y-2">
      <Label className="text-muted-foreground">Horas Hombre (opcional)</Label>
      {hours.map((entry, idx) => (
        <div key={idx} className="flex gap-2 items-center">
          <select
            className="flex h-9 flex-1 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            value={entry.user_id || ""}
            onChange={e => updateEntry(idx, { user_id: Number(e.target.value) })}
          >
            <option value="">Seleccionar persona</option>
            {users.map(u => (
              <option key={u.id} value={u.id} disabled={selectedUserIds.has(u.id) && entry.user_id !== u.id}>
                {u.name || u.email} {u.cargo !== "Sin definir" ? `(${u.cargo})` : ""}
              </option>
            ))}
          </select>
          <div className="w-24">
            <NumInput value={entry.hours} onChange={v => updateEntry(idx, { hours: v })} min={0} placeholder="0" />
          </div>
          <Button variant="ghost" size="icon" onClick={() => removeEntry(idx)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addPerson}>
        <UserPlus className="h-4 w-4 mr-1" /> Agregar Persona
      </Button>
      {hours.length > 0 && (
        <div className="text-xs text-muted-foreground">
          Total: {hours.reduce((sum, h) => sum + h.hours, 0)} horas
          {maxHoursPerPerson !== undefined && <span className="ml-2">(máx {maxHoursPerPerson}h por persona)</span>}
        </div>
      )}
    </div>
  );
}

function ExternalCostList({
  externals, onChange,
}: { externals: ExternalCost[]; onChange: (externals: ExternalCost[]) => void; }) {
  const addRow = () => onChange([...externals, { name: "", amount: 0 }]);
  const updateRow = (idx: number, updates: Partial<ExternalCost>) => onChange(externals.map((e, i) => i === idx ? { ...e, ...updates } : e));
  const removeRow = (idx: number) => onChange(externals.filter((_, i) => i !== idx));

  return (
    <div className="space-y-2">
      {externals.map((ext, idx) => (
        <div key={idx} className="flex gap-2 items-center">
          <Input className="flex-1" placeholder="Ítem (ej: Locución)" value={ext.name} onChange={e => updateRow(idx, { name: e.target.value })} />
          <div className="w-32">
            <NumInput value={ext.amount} onChange={v => updateRow(idx, { amount: v })} min={0} placeholder="$" isCurrency />
          </div>
          <Button variant="ghost" size="icon" onClick={() => removeRow(idx)}>
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={addRow}>
        <Plus className="h-4 w-4 mr-1" /> Agregar Costo
      </Button>
    </div>
  );
}
