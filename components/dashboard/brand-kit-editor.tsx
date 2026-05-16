"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Loader2, Plus, Trash2, ChevronDown, ChevronRight, Save } from "lucide-react";
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
            onChange={(e) => update(idx, { label: e.target.value })}
            className="flex-1 bg-muted border border-border/50 rounded px-2 py-1.5 text-xs"
            placeholder="Etiqueta"
          />
          <input
            type="text"
            value={it.name}
            onChange={(e) => update(idx, { name: slugify(e.target.value) })}
            className="w-32 bg-muted border border-border/50 rounded px-2 py-1.5 text-xs font-mono text-muted-foreground"
            placeholder="primary"
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
            onChange={(e) => update(idx, { label: e.target.value })}
            className="col-span-2 bg-muted border border-border/50 rounded px-2 py-1.5 text-xs"
            placeholder="Etiqueta"
          />
          <input
            type="text"
            value={it.fontFamily}
            onChange={(e) => update(idx, { fontFamily: e.target.value })}
            className="col-span-5 bg-muted border border-border/50 rounded px-2 py-1.5 text-xs font-mono"
            placeholder="Inter, system-ui, sans-serif"
          />
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
          <input
            type="text"
            value={it.name}
            onChange={(e) => update(idx, { name: slugify(e.target.value) })}
            className="col-span-2 bg-muted border border-border/50 rounded px-2 py-1.5 text-xs font-mono text-muted-foreground"
            placeholder="display"
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
            onChange={(e) => update(idx, { label: e.target.value })}
            className="flex-1 bg-muted border border-border/50 rounded px-2 py-1.5 text-xs"
            placeholder="Etiqueta"
          />
          <input
            type="number"
            value={it.fontSize}
            min={1}
            onChange={(e) => update(idx, { fontSize: Math.max(1, Number(e.target.value)) })}
            className="w-20 bg-muted border border-border/50 rounded px-2 py-1.5 text-xs"
            placeholder="px"
          />
          <input
            type="text"
            value={it.name}
            onChange={(e) => update(idx, { name: slugify(e.target.value) })}
            className="w-32 bg-muted border border-border/50 rounded px-2 py-1.5 text-xs font-mono text-muted-foreground"
            placeholder="lg"
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
            onChange={(e) => update(idx, { label: e.target.value })}
            className="flex-1 bg-muted border border-border/50 rounded px-2 py-1.5 text-xs"
            placeholder="Etiqueta"
          />
          <input
            type="number"
            value={it.value}
            min={0}
            onChange={(e) => update(idx, { value: Math.max(0, Number(e.target.value)) })}
            className="w-20 bg-muted border border-border/50 rounded px-2 py-1.5 text-xs"
            placeholder="px"
          />
          <input
            type="text"
            value={it.name}
            onChange={(e) => update(idx, { name: slugify(e.target.value) })}
            className="w-32 bg-muted border border-border/50 rounded px-2 py-1.5 text-xs font-mono text-muted-foreground"
            placeholder="md"
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
}: {
  items: LogoToken[];
  onChange: (next: LogoToken[]) => void;
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
        <div key={idx} className="flex items-center gap-2">
          <div className="w-10 h-10 rounded border border-border/50 bg-background flex items-center justify-center overflow-hidden shrink-0">
            {it.src ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={it.src} alt="" className="max-w-full max-h-full object-contain" />
            ) : (
              <span className="text-[10px] text-muted-foreground">sin</span>
            )}
          </div>
          <input
            type="text"
            value={it.label}
            onChange={(e) => update(idx, { label: e.target.value })}
            className={cn("bg-muted border border-border/50 rounded px-2 py-1.5 text-xs", "w-32")}
            placeholder="Etiqueta"
          />
          <input
            type="text"
            value={it.src}
            onChange={(e) => update(idx, { src: e.target.value })}
            className="flex-1 bg-muted border border-border/50 rounded px-2 py-1.5 text-xs"
            placeholder="https://…"
          />
          <input
            type="text"
            value={it.name}
            onChange={(e) => update(idx, { name: slugify(e.target.value) })}
            className="w-32 bg-muted border border-border/50 rounded px-2 py-1.5 text-xs font-mono text-muted-foreground"
            placeholder="primary"
          />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => remove(idx)}>
            <Trash2 className="h-3.5 w-3.5 text-red-400" />
          </Button>
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={add} className="gap-1">
        <Plus className="h-3.5 w-3.5" /> Agregar logo
      </Button>
    </Section>
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
