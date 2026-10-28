// Cliente de /api/production/ai/generate-skin (panel de propiedades y
// "Pídele a la IA").

import type { LayerSkin } from "./types";
import type { SkinKind } from "./skin";

export interface GeneratedSkin {
  skin: LayerSkin;
  averageColor: string | null;
}

export async function requestSkin(args: {
  projectId: number;
  kind: SkinKind;
  description: string;
  colors: string[];
  box: { w: number; h: number };
}): Promise<GeneratedSkin> {
  const res = await fetch("/api/production/ai/generate-skin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      production_project_id: args.projectId,
      kind: args.kind,
      description: args.description,
      colors: args.colors.filter((c) => /^#[0-9a-f]{3,8}$/i.test(c)).slice(0, 4),
      box: { w: Math.max(1, Math.round(args.box.w)), h: Math.max(1, Math.round(args.box.h)) },
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.skin) throw new Error(body?.error || `Error ${res.status}`);
  return { skin: body.skin as LayerSkin, averageColor: (body.average_color as string | null) ?? null };
}
