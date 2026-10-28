"use client";

// Textura dentro de las letras (TextLayer.style.fill tipo "texture"): se
// genera con IA (/api/production/ai/generate-images, una imagen 1:1) y se
// recorta a la forma del texto. Ver lib/production/text-effects.ts.

import { useState } from "react";
import { Loader2, Sparkles, Trash2 } from "lucide-react";
import type { TemplateLayer, TextLayer } from "@/lib/production/types";
import { texturePrompt } from "@/lib/production/text-effects";


export function TextureFillControl({
  layer,
  projectId,
  onUpdate,
}: {
  layer: TextLayer;
  projectId?: number;
  onUpdate: (id: string, m: (l: TemplateLayer) => TemplateLayer) => void;
}) {
  const fill = layer.style.fill?.type === "texture" ? layer.style.fill : null;
  const [description, setDescription] = useState(fill?.prompt ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    if (!projectId || description.trim().length < 3 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/production/ai/generate-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          production_project_id: projectId,
          jobs: [{ slot_id: layer.id, ratio: "1:1", prompt: texturePrompt(description.trim()), purpose: "texture" }],
        }),
      });
      const body = await res.json().catch(() => ({}));
      const url = (body.images ?? []).find((i: { url?: string }) => i.url)?.url as string | undefined;
      if (!url) throw new Error(body?.error || body?.images?.[0]?.error || `Error ${res.status}`);
      const prompt = description.trim();
      onUpdate(layer.id, (l) =>
        l.type === "text" ? { ...l, style: { ...l.style, fill: { type: "texture", src: url, prompt } } } : l,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5 pt-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">Textura en las letras</span>
        {fill && (
          <button
            type="button"
            onClick={() =>
              onUpdate(layer.id, (l) => (l.type === "text" ? { ...l, style: { ...l.style, fill: null } } : l))
            }
            title="Quitar textura"
            className="text-muted-foreground hover:text-foreground"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
      {fill && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={fill.src} alt="" className="h-10 w-full object-cover rounded border border-border/50" />
      )}
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => e.stopPropagation()}
        rows={2}
        placeholder="Ej: lámina dorada brillante · agua turquesa · madera"
        className="w-full bg-muted border border-border/50 rounded px-2 py-1 text-xs"
      />
      <button
        type="button"
        onClick={generate}
        disabled={!projectId || busy || description.trim().length < 3}
        className="w-full text-xs px-2.5 py-1 rounded bg-violet-600 text-white hover:bg-violet-500 disabled:opacity-40 flex items-center justify-center gap-1.5"
      >
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        {busy ? "Generando textura…" : fill ? "Generar otra textura" : "Generar textura con IA"}
      </button>
      {error && <p className="text-[11px] text-amber-300">{error}</p>}
    </div>
  );
}
