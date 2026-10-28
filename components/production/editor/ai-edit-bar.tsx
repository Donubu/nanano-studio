"use client";

// Barra "Pídele a la IA" del editor. El productor escribe un cambio en
// lenguaje natural ("agrega un badge 2x1 arriba a la derecha", "pon de fondo
// una foto de playa") y /api/production/ai/edit lo traduce a operaciones.
// El resultado se aplica como UN cambio del editor (Deshacer lo revierte) y
// las imágenes pedidas se generan después con /api/production/ai/generate-images
// y se ponen en su capa cuando llegan.

import { useState } from "react";
import { Loader2, Sparkles, Undo2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TemplateDefinition, TemplateLayer } from "@/lib/production/types";
import { nearestImageRatio } from "@/lib/production/layout-plan";
import { requestSkin, type GeneratedSkin } from "@/lib/production/skin-client";
import type { SkinKind } from "@/lib/production/skin";

interface Props {
  definition: TemplateDefinition;
  selectedIds: string[];
  projectId: number;
  templateId?: number;
  disabled?: boolean;
  // Aplica la pieza editada como un cambio deshacible.
  onApply: (next: TemplateDefinition) => void;
  // Pone la URL generada en cada capa de imagen (por id).
  onImages: (srcById: Record<string, string>) => void;
  // Pone la piel gráfica generada en cada texto (por id).
  onSkins: (skinById: Record<string, GeneratedSkin>) => void;
  onUndo: () => void;
}

function findLayer(nodes: TemplateLayer[], id: string): TemplateLayer | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.type === "frame") {
      const f = findLayer(n.children, id);
      if (f) return f;
    }
  }
  return null;
}

export function AiEditBar({
  definition,
  selectedIds,
  projectId,
  templateId,
  disabled,
  onApply,
  onImages,
  onSkins,
  onUndo,
}: Props) {
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState<"edit" | "images" | "skins" | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: "ok" | "error"; undo?: boolean } | null>(null);

  const selection = selectedIds.filter((id) => id !== "tpl_root");
  const selectedImage =
    selection.length === 1 && findLayer(definition.children, selection[0])?.type === "image";

  const submit = async () => {
    const text = instruction.trim();
    if (text.length < 2 || busy) return;
    setBusy("edit");
    setMessage(null);
    try {
      const res = await fetch("/api/production/ai/edit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          production_project_id: projectId,
          template_id: templateId,
          definition,
          instruction: text,
          selected_ids: selection,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage({ text: body?.error || `Error ${res.status}`, tone: "error" });
        return;
      }
      const images = (body.images ?? []) as { layer_id: string; prompt: string }[];
      const skins = (body.skins ?? []) as { layer_id: string; kind: SkinKind; prompt: string; colors: string[] }[];
      if ((body.applied ?? 0) === 0) {
        setMessage({ text: body.rationale || "La IA no propuso cambios.", tone: "error" });
        return;
      }
      const next = body.definition as TemplateDefinition;
      onApply(next);
      setInstruction("");
      setMessage({ text: body.rationale || "Listo.", tone: "ok", undo: true });

      if (images.length > 0) {
        setBusy("images");
        const jobs = images
          .map((img) => {
            const layer = findLayer(next.children, img.layer_id);
            return layer
              ? { slot_id: img.layer_id, ratio: nearestImageRatio(layer.size.w, layer.size.h), prompt: img.prompt }
              : null;
          })
          .filter((j): j is NonNullable<typeof j> => j !== null)
          .slice(0, 6);
        const imgRes = await fetch("/api/production/ai/generate-images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ production_project_id: projectId, jobs }),
        });
        const imgBody = await imgRes.json().catch(() => ({}));
        const list = (imgBody.images ?? []) as { slot_id: string; url?: string; error?: string }[];
        const srcById: Record<string, string> = {};
        for (const i of list) if (i.url) srcById[i.slot_id] = i.url;
        if (Object.keys(srcById).length > 0) onImages(srcById);
        const failed = list.filter((i) => i.error);
        if (!imgRes.ok || failed.length > 0) {
          setMessage({
            text: `${body.rationale || "Listo."} · ${imgBody.error || failed[0]?.error || "No se pudo generar la imagen"}`,
            tone: "error",
            undo: true,
          });
        }
      }

      if (skins.length > 0) {
        setBusy("skins");
        const results = await Promise.allSettled(
          skins.slice(0, 3).map(async (sk) => {
            const layer = findLayer(next.children, sk.layer_id);
            if (!layer) throw new Error("La capa ya no existe");
            const generated = await requestSkin({
              projectId,
              kind: sk.kind,
              description: sk.prompt,
              colors: sk.colors,
              box: layer.size,
            });
            return [sk.layer_id, generated] as const;
          }),
        );
        const skinById: Record<string, GeneratedSkin> = {};
        for (const r of results) if (r.status === "fulfilled") skinById[r.value[0]] = r.value[1];
        if (Object.keys(skinById).length > 0) onSkins(skinById);
        const failed = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
        if (failed) {
          setMessage({
            text: `${body.rationale || "Listo."} · No se pudo generar la piel: ${(failed.reason as Error).message}`,
            tone: "error",
            undo: true,
          });
        }
      }
    } catch (e) {
      setMessage({ text: `Error de red: ${(e as Error).message}`, tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const placeholder = selectedImage
    ? "Ej: genera una foto de un cucurucho con frutillas, luz de verano"
    : selection.length > 0
      ? "Ej: hazlo más grande y ponlo arriba a la derecha"
      : "Ej: agrega un badge 2x1 arriba a la derecha · pon de fondo una foto de playa";

  return (
    <div className="border-b border-border/50 bg-violet-500/5 px-3 py-1.5 space-y-1">
      <div className={cn("flex items-center gap-2", disabled && "opacity-50 pointer-events-none")}>
        <Sparkles className="h-4 w-4 text-violet-400 shrink-0" />
        <input
          type="text"
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            // Que el editor no tome los atajos de teclado mientras se escribe.
            e.stopPropagation();
            if (e.key === "Enter") submit();
          }}
          placeholder={placeholder}
          disabled={!!busy}
          className="flex-1 min-w-0 bg-transparent text-sm py-1 focus:outline-none placeholder:text-muted-foreground/60 disabled:opacity-60"
        />
        {selection.length > 0 && (
          <span className="text-[10px] text-violet-300 shrink-0">
            {selection.length === 1 ? "sobre la capa seleccionada" : `sobre ${selection.length} capas`}
          </span>
        )}
        <button
          type="button"
          onClick={submit}
          disabled={!!busy || instruction.trim().length < 2}
          className="text-xs px-2.5 py-1 rounded bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-40 flex items-center gap-1 shrink-0"
        >
          {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
          {busy === "images"
            ? "Generando imagen…"
            : busy === "skins"
              ? "Generando piel…"
              : busy === "edit"
                ? "Pensando…"
                : "Pedir"}
        </button>
      </div>
      {message && (
        <div
          className={cn(
            "flex items-center gap-2 text-[11px] pl-6",
            message.tone === "ok" ? "text-muted-foreground" : "text-amber-300",
          )}
        >
          <span className="flex-1 min-w-0 truncate" title={message.text}>
            {message.text}
          </span>
          {message.undo && (
            <button
              type="button"
              onClick={() => {
                onUndo();
                setMessage(null);
              }}
              className="flex items-center gap-1 hover:text-foreground shrink-0"
            >
              <Undo2 className="h-3 w-3" /> Deshacer
            </button>
          )}
          <button type="button" onClick={() => setMessage(null)} className="hover:text-foreground shrink-0">
            <X className="h-3 w-3" />
          </button>
        </div>
      )}
    </div>
  );
}
