import { describe, it, expect } from "vitest";
import { parseSafeZone, platformSafeZone, adaptationSafeZone, hasSafeZone } from "../safe-zone";
import { lintLayout, safeInsets } from "../layout-lint";
import { adaptTree } from "../adapt";
import type { TemplateDefinition } from "../types";

describe("safe-zone", () => {
  it("parsea el JSON del preset y cae a la plataforma si no hay", () => {
    expect(parseSafeZone('{"top":250,"bottom":340}')).toEqual({ top: 250, right: 0, bottom: 340, left: 0 });
    expect(parseSafeZone(null)).toBeNull();
    expect(platformSafeZone("instagram", 1080, 1920)).toEqual({ top: 250, right: 0, bottom: 346, left: 0 });
    expect(platformSafeZone("tiktok", 1080, 1920)?.right).toBe(140);
    expect(platformSafeZone("instagram", 1080, 1080)).toBeNull();
    expect(platformSafeZone("gdn", 300, 250)).toBeNull();
    expect(adaptationSafeZone({ width: 1080, height: 1920, preset_channel: "instagram", preset_safe_zone: '{"bottom":400}' })).toEqual({ top: 0, right: 0, bottom: 400, left: 0 });
    expect(hasSafeZone(platformSafeZone("youtube", 1280, 720))).toBe(true);
  });

  it("los márgenes por lado nunca bajan del 3%", () => {
    expect(safeInsets({ w: 1080, h: 1920 }, { top: 250, right: 0, bottom: 346, left: 0 })).toEqual({ top: 250, right: 32, bottom: 346, left: 32 });
  });
});

const story: TemplateDefinition = {
  id: "tpl_root",
  type: "frame",
  position: { x: 0, y: 0 },
  size: { w: 1080, h: 1920 },
  layout: { mode: "free" },
  children: [
    { id: "bg", type: "image", src: "x", position: { x: 0, y: 0 }, size: { w: 1080, h: 1920 } },
    { id: "title", type: "text", content: "VUELA SIN LÍMITES", position: { x: 80, y: 700 }, size: { w: 920, h: 160 }, style: { fontSize: 90, color: "#fff" } },
    { id: "cta", type: "text", name: "CTA", content: "COMPRAR", position: { x: 300, y: 1700 }, size: { w: 480, h: 120 }, style: { fontSize: 44, color: "#111", backgroundColor: "#FACC15" } },
  ],
};

describe("zona segura en lint y adaptación", () => {
  const zone = platformSafeZone("instagram", 1080, 1920)!;

  it("un CTA en la franja de abajo de una story se marca", () => {
    expect(lintLayout(story).some((i) => i.kind === "outside_safe_area")).toBe(false);
    const issues = lintLayout(story, { safe: zone });
    const cta = issues.find((i) => i.kind === "outside_safe_area" && i.layerIds.includes("cta"));
    expect(cta?.detail).toContain("tapa la plataforma");
  });

  it("al adaptar un 1080×1920 a story el CTA sube fuera de la franja y el fondo sigue a sangre", () => {
    const out = adaptTree(story, { w: 1080, h: 1920 }, { safe: zone });
    const cta = out.children.find((c) => c.id === "cta")!;
    expect(cta.position.y + cta.size.h).toBeLessThanOrEqual(1920 - zone.bottom + 1);
    const bg = out.children.find((c) => c.id === "bg")!;
    expect(bg.size.h).toBeGreaterThanOrEqual(1920);
    expect(lintLayout(out, { safe: zone }).filter((i) => i.kind === "outside_safe_area")).toEqual([]);
  });

  it("una tira (728×90) se arma dentro de la zona que tapa la plataforma", () => {
    const wide = { ...story, size: { w: 1920, h: 1080 } };
    const out = adaptTree(wide, { w: 1500, h: 500 }, { safe: platformSafeZone("x", 1500, 500) });
    for (const c of out.children) {
      if (c.type === "image") continue;
      expect(c.position.x).toBeGreaterThanOrEqual(255 - 1); // avatar a la izquierda
      expect(c.position.y + c.size.h).toBeLessThanOrEqual(400 + 1);
    }
  });
});
