"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Trash2, ChevronDown, ChevronRight, Save, Upload } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  BrandKit,
  BrandKitContent,
  ColorToken,
  FontToken,
  ScaleToken,
  SpacingToken,
  LogoToken,
  brandKitToApi,
} from "@/lib/production/brand-kit";
import { FontPicker } from "@/components/dashboard/font-picker";

interface Props {
  kit: BrandKit;
  onSaved: (updatedContent: BrandKitContent, updatedName: string, isDefault: boolean) => void;
  onCancel: () => void;
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function uniqueName(base: string, taken: string[]): string {
  const slug = slugify(base) || "token";
  if (!taken.includes(slug)) return slug;
  let i = 2;
  while (taken.includes(`${slug}-${i}`)) i++;
  return `${slug}-${i}`;
}

// Build a slug from a label, ensuring uniqueness against the names of every
// item except the one at `currentIdx` (so renaming an item to its own current
// slug doesn't trip the dedupe). Used when typing the label updates the slug
// transparently — the slug is the identifier used in token refs like
// "{logo.primary}" but the user shouldn't have to think about it.
function deriveSlug<T extends { name: string }>(
  label: string,
  items: T[],
  currentIdx: number,
): string {
  const others = items.map((it, i) => (i === currentIdx ? "" : it.name)).filter(Boolean);
  return uniqueName(label, others);
}

export function BrandKitEditor({ kit, onSaved, onCancel }: Props) {
  const [name, setName] = useState(kit.name);
  const [isDefault, setIsDefault] = useState(kit.is_default);
  const [content, setContent] = useState<BrandKitContent>(kit.content);
  const [saving, setSaving] = useState(false);

  const patch = (p: Partial<BrandKitContent>) => setContent((c) => ({ ...c, ...p }));

  const handleSave = async () => {
    setSaving(true);
    try {
      const apiPayload = brandKitToApi(content);
      const res = await fetch(`/api/production/brand-kits/${kit.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim() || "Sin nombre",
          is_default: isDefault,
          ...apiPayload,
        }),
      });
      if (res.ok) {
        onSaved(content, name.trim() || "Sin nombre", isDefault);
      }
    } catch (err) {
      console.error("Error guardando brand kit:", err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-card border border-border/50 rounded-xl p-4 space-y-3">
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre del brand kit"
          className="flex-1 bg-muted border border-border/50 rounded-md px-3 py-2 text-sm font-medium"
        />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
          />
          Default
        </label>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button size="sm" onClick={handleSave} disabled={saving} className="gap-1">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Guardar
        </Button>
      </div>

      <ColorsSection
        items={content.colors}
        onChange={(colors) => patch({ colors })}
      />
      <FontsSection
        items={content.fonts}
        onChange={(fonts) => patch({ fonts })}
      />
      <ScalesSection
        items={content.scales}
        onChange={(scales) => patch({ scales })}
      />
      <SpacingSection
        items={content.spacing}
        onChange={(spacing) => patch({ spacing })}
      />
      <LogosSection
        items={content.logos}
        onChange={(logos) => patch({ logos })}
        clientId={kit.client_id}
      />
      <RulesSection
        value={content.rulesText ?? ""}
        onChange={(rulesText) => patch({ rulesText })}
      />
    </div>
  );
}

// ----- Section shell -----

function Section({
  title,
  count,
  children,
  defaultOpen = false,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="border border-border/30 rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-muted/40 hover:bg-muted text-left"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span className="text-sm font-medium">{title}</span>
        <span className="text-xs text-muted-foreground">{count}</span>
      </button>
      {open && <div className="p-3 space-y-2">{children}</div>}
    </div>
  );
}

// ----- Colors -----

function ColorsSection({
  items,
  onChange,
}: {
  items: ColorToken[];
  onChange: (next: ColorToken[]) => void;
}) {
  const add = () => {
    const name = uniqueName("color", items.map((i) => i.name));
    onChange([...items, { name, label: "Nuevo color", value: "#888888" }]);
  };
  const update = (idx: number, patch: Partial<ColorToken>) => {
    onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };
  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx));

  return (
    <Section title="Colores" count={items.length} defaultOpen>
      {items.map((it, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <input
            type="color"
            value={it.value}
            onChange={(e) => update(idx, { value: e.target.value })}
            className="w-9 h-9 rounded border border-border/50 bg-muted cursor-pointer"
          />
          <input
            type="text"
            value={it.value}
            onChange={(e) => update(idx, { value: e.target.value })}
            className="w-24 bg-muted border border-border/50 rounded px-2 py-1.5 text-xs font-mono"
            placeholder="#ff0000"
          />
          <input
            type="text"
            value={it.label}
            onChange={(e) => {
              const label = e.target.value;
              update(idx, { label, name: deriveSlug(label, items, idx) });
            }}
            className="flex-1 bg-muted border border-border/50 rounded px-2 py-1.5 text-xs"
            placeholder="Nombre del color"
          />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(idx)}>
            <Trash2 className="h-3.5 w-3.5 text-red-400" />
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={add} className="gap-1">
        <Plus className="h-3.5 w-3.5" /> Agregar color
      </Button>
    </Section>
  );
}

// ----- Fonts -----

function FontsSection({
  items,
  onChange,
}: {
  items: FontToken[];
  onChange: (next: FontToken[]) => void;
}) {
  const add = () => {
    const name = uniqueName("font", items.map((i) => i.name));
    onChange([
      ...items,
      { name, label: "Nueva tipografía", fontFamily: "Inter, system-ui, sans-serif", fontWeight: 400 },
    ]);
  };
  const update = (idx: number, patch: Partial<FontToken>) => {
    onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };
  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx));

  return (
    <Section title="Tipografías" count={items.length}>
      {items.map((it, idx) => (
        <div key={idx} className="grid grid-cols-12 gap-2 items-center">
          <input
            type="text"
            value={it.label}
            onChange={(e) => {
              const label = e.target.value;
              update(idx, { label, name: deriveSlug(label, items, idx) });
            }}
            className="col-span-3 bg-muted border border-border/50 rounded px-2 py-1.5 text-xs"
            placeholder="Nombre de la tipografía"
          />
          <div className="col-span-6">
            <FontPicker
              value={it.fontFamily}
              onChange={(v) => update(idx, { fontFamily: v })}
            />
          </div>
          <input
            type="number"
            value={it.fontWeight ?? 400}
            min={100}
            max={900}
            step={100}
            onChange={(e) => update(idx, { fontWeight: Number(e.target.value) })}
            className="col-span-2 bg-muted border border-border/50 rounded px-2 py-1.5 text-xs"
            placeholder="Peso"
          />
          <Button variant="ghost" size="icon" className="h-7 w-7 col-span-1" onClick={() => remove(idx)}>
            <Trash2 className="h-3.5 w-3.5 text-red-400" />
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={add} className="gap-1">
        <Plus className="h-3.5 w-3.5" /> Agregar tipografía
      </Button>
    </Section>
  );
}

// ----- Scales -----

function ScalesSection({
  items,
  onChange,
}: {
  items: ScaleToken[];
  onChange: (next: ScaleToken[]) => void;
}) {
  const add = () => {
    const name = uniqueName("scale", items.map((i) => i.name));
    onChange([...items, { name, label: "Nueva escala", fontSize: 24 }]);
  };
  const update = (idx: number, patch: Partial<ScaleToken>) => {
    onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };
  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx));

  return (
    <Section title="Escalas tipográficas" count={items.length}>
      {items.map((it, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <input
            type="text"
            value={it.label}
            onChange={(e) => {
              const label = e.target.value;
              update(idx, { label, name: deriveSlug(label, items, idx) });
            }}
            className="flex-1 bg-muted border border-border/50 rounded px-2 py-1.5 text-xs"
            placeholder="Nombre de la escala"
          />
          <input
            type="number"
            value={it.fontSize}
            min={1}
            onChange={(e) => update(idx, { fontSize: Math.max(1, Number(e.target.value)) })}
            className="w-20 bg-muted border border-border/50 rounded px-2 py-1.5 text-xs"
            placeholder="px"
          />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(idx)}>
            <Trash2 className="h-3.5 w-3.5 text-red-400" />
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={add} className="gap-1">
        <Plus className="h-3.5 w-3.5" /> Agregar escala
      </Button>
    </Section>
  );
}

// ----- Spacing -----

function SpacingSection({
  items,
  onChange,
}: {
  items: SpacingToken[];
  onChange: (next: SpacingToken[]) => void;
}) {
  const add = () => {
    const name = uniqueName("spacing", items.map((i) => i.name));
    onChange([...items, { name, label: "Nueva", value: 16 }]);
  };
  const update = (idx: number, patch: Partial<SpacingToken>) => {
    onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };
  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx));

  return (
    <Section title="Spacing" count={items.length}>
      {items.map((it, idx) => (
        <div key={idx} className="flex items-center gap-2">
          <input
            type="text"
            value={it.label}
            onChange={(e) => {
              const label = e.target.value;
              update(idx, { label, name: deriveSlug(label, items, idx) });
            }}
            className="flex-1 bg-muted border border-border/50 rounded px-2 py-1.5 text-xs"
            placeholder="Nombre del spacing"
          />
          <input
            type="number"
            value={it.value}
            min={0}
            onChange={(e) => update(idx, { value: Math.max(0, Number(e.target.value)) })}
            className="w-20 bg-muted border border-border/50 rounded px-2 py-1.5 text-xs"
            placeholder="px"
          />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(idx)}>
            <Trash2 className="h-3.5 w-3.5 text-red-400" />
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={add} className="gap-1">
        <Plus className="h-3.5 w-3.5" /> Agregar spacing
      </Button>
    </Section>
  );
}

// ----- Logos -----

function LogosSection({
  items,
  onChange,
  clientId,
}: {
  items: LogoToken[];
  onChange: (next: LogoToken[]) => void;
  clientId: number;
}) {
  const add = () => {
    const name = uniqueName("logo", items.map((i) => i.name));
    onChange([...items, { name, label: "Nuevo logo", src: "" }]);
  };
  const update = (idx: number, patch: Partial<LogoToken>) => {
    onChange(items.map((it, i) => (i === idx ? { ...it, ...patch } : it)));
  };
  const remove = (idx: number) => onChange(items.filter((_, i) => i !== idx));

  return (
    <Section title="Logos" count={items.length}>
      {items.map((it, idx) => (
        <LogoRow
          key={idx}
          item={it}
          items={items}
          idx={idx}
          clientId={clientId}
          onUpdate={(patch) => update(idx, patch)}
          onRemove={() => remove(idx)}
        />
      ))}
      <Button variant="ghost" size="sm" onClick={add} className="gap-1">
        <Plus className="h-3.5 w-3.5" /> Agregar logo
      </Button>
    </Section>
  );
}

function LogoRow({
  item,
  items,
  idx,
  clientId,
  onUpdate,
  onRemove,
}: {
  item: LogoToken;
  items: LogoToken[];
  idx: number;
  clientId: number;
  onUpdate: (patch: Partial<LogoToken>) => void;
  onRemove: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const dragCounterRef = useRef(0);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setUploadError("El archivo debe ser una imagen");
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(new Error("No se pudo leer el archivo"));
        reader.readAsDataURL(file);
      });
      const res = await fetch("/api/production/brand-kits/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageData: dataUrl, clientId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setUploadError(body?.error || "Error al subir");
        return;
      }
      const { url } = (await res.json()) as { url: string };
      onUpdate({ src: url });
    } catch (err) {
      console.error("Error subiendo logo:", err);
      setUploadError("Error inesperado");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Use a counter to handle nested drag events from child elements so the
  // highlight only clears when the pointer actually leaves the row.
  const onDragEnter = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragCounterRef.current += 1;
    if (dragCounterRef.current === 1) setDragOver(true);
  };
  const onDragLeave = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current <= 0) {
      dragCounterRef.current = 0;
      setDragOver(false);
    }
  };
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes("Files")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounterRef.current = 0;
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  return (
    <div
      className={cn(
        "space-y-1 rounded p-1 -m-1 border border-transparent transition-colors",
        dragOver && "border-primary/60 bg-primary/5"
      )}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <div className="flex items-center gap-2">
        <div className="w-10 h-10 rounded border border-border/50 bg-background flex items-center justify-center overflow-hidden shrink-0">
          {item.src ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.src} alt="" className="max-w-full max-h-full object-contain" />
          ) : (
            <span className="text-[10px] text-muted-foreground">sin</span>
          )}
        </div>
        <input
          type="text"
          value={item.label}
          onChange={(e) => {
            const label = e.target.value;
            onUpdate({ label, name: deriveSlug(label, items, idx) });
          }}
          className={cn("bg-muted border border-border/50 rounded px-2 py-1.5 text-xs", "w-40")}
          placeholder="Nombre del logo"
        />
        <input
          type="text"
          value={item.src}
          onChange={(e) => onUpdate({ src: e.target.value })}
          className="flex-1 bg-muted border border-border/50 rounded px-2 py-1.5 text-xs"
          placeholder="Subir o arrastrar"
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
        <Button
          variant="ghost"
          size="sm"
          className="gap-1 h-8 px-2"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          title="Subir desde tu equipo (se guarda en GCS)"
        >
          {uploading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="h-3.5 w-3.5" />
          )}
          <span className="text-[11px]">Subir</span>
        </Button>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRemove}>
          <Trash2 className="h-3.5 w-3.5 text-red-400" />
        </Button>
      </div>
      {uploadError && (
        <p className="text-[10px] text-red-400 pl-12">{uploadError}</p>
      )}
    </div>
  );
}

// ----- Rules -----

function RulesSection({
  value,
  onChange,
}: {
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <Section title="Reglas de marca" count={value ? 1 : 0}>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={4}
        placeholder="Notas y reglas para los productores (ej: el logo siempre con padding mínimo de 16px sobre fondo claro)…"
        className="w-full bg-muted border border-border/50 rounded px-2 py-1.5 text-xs"
      />
    </Section>
  );
}
