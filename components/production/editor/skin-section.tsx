"use client";

// Sección "Piel gráfica" del panel de propiedades de un texto: genera con IA
// la forma del botón o sello (sin texto) y la pone detrás del texto vivo.
// Ver lib/production/skin.ts.

import { useState } from "react";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import type { TemplateLayer, TextLayer } from "@/lib/production/types";
import { BrandKitContent, resolveColor } from "@/lib/production/brand-kit";
import { applySkin, removeSkin, type SkinKind } from "@/lib/production/skin";
import { requestSkin } from "@/lib/production/skin-client";

const KIND_OPTIONS: { value: SkinKind; label: string; hint: string }[] = [
  { value: "button", label: "Botón", hint: "Se estira a lo ancho sin deformar los extremos" },
  { value: "badge", label: "Sello o sticker", hint: "Mantiene su forma y proporción" },
];

export function SkinSection({
  layer,
  onUpdate,
  brandKit,
  projectId,
  frame,
}: {
  layer: TextLayer;
  onUpdate: (id: string, m: (l: TemplateLayer) => TemplateLayer) => void;
  brandKit: BrandKitContent;
  projectId?: number;
  frame: { w: number; h: number };
}) {
  const skin = layer.skin ?? null;
  const [kind, setKind] = useState<SkinKind>(
    skin ? (skin.mode === "fit" ? "badge" : "button") : layer.size.w / Math.max(1, layer.size.h) < 1.6 ? "badge" : "button",
  );
  const [description, setDescription] = useState(skin?.prompt ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (!projectId || description.trim().length < 3 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const bg = layer.style.backgroundColor ? resolveColor(layer.style.backgroundColor, brandKit, "") : "";
      const { skin: next, averageColor } = await requestSkin({
        projectId,
        kind,
        description: description.trim(),
        colors: bg ? [bg] : [],
        box: layer.size,
      });
      onUpdate(layer.id, (l) => applySkin(l, next, averageColor, frame));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-2">
      {skin && (
        <div className="flex items-center gap-2">
          <div
            className="h-12 w-20 rounded border border-border/50 bg-[length:10px_10px] bg-[linear-gradient(45deg,#8883_25%,transparent_25%,transparent_75%,#8883_75%),linear-gradient(45deg,#8883_25%,transparent_25%,transparent_75%,#8883_75%)] bg-[position:0_0,5px_5px] flex items-center justify-center overflow-hidden"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={skin.src} alt="" className="max-h-full max-w-full object-contain" />
          </div>
          <div className="flex-1 min-w-0 text-[10px] text-muted-foreground leading-tight">
            {skin.mode === "fit" ? "Sello: mantiene su proporción" : "Botón: se estira sin deformarse"}
          </div>
          <button
            type="button"
            onClick={() => onUpdate(layer.id, removeSkin)}
            title="Quitar piel (vuelve al fondo plano)"
            className="h-7 w-7 flex items-center justify-center rounded border border-border/50 text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <div className="flex gap-1">
        {KIND_OPTIONS.map((o) => (
          <button
            key={o.value}
            type="button"
            title={o.hint}
            onClick={() => setKind(o.value)}
            className={
              kind === o.value
                ? "flex-1 text-[11px] px-2 py-1 rounded border border-primary bg-primary/10 text-foreground"
                : "flex-1 text-[11px] px-2 py-1 rounded border border-border/50 text-muted-foreground hover:text-foreground"
            }
          >
            {o.label}
          </button>
        ))}
      </div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        rows={2}
        placeholder={
          kind === "badge"
            ? "Ej: estrella de oferta roja con borde blanco y brillo"
            : "Ej: botón 3D amarillo con brillo y borde oscuro"
        }
        className="w-full bg-muted border border-border/50 rounded px-2 py-1 text-xs"
      />
      <button
        type="button"
        onClick={generate}
        disabled={!projectId || busy || description.trim().length < 3}
        className="w-full text-xs px-2.5 py-1.5 rounded bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-40 flex items-center justify-center gap-1.5"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {busy ? "Generando piel…" : skin ? "Generar otra piel" : "Generar piel con IA"}
      </button>
      {error && <p className="text-[11px] text-amber-300">{error}</p>}
      <p className="text-[10px] text-muted-foreground leading-snug">
        El texto sigue editable encima; la piel reemplaza el fondo plano.
      </p>
    </div>
  );
}
