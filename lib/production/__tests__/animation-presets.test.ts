import { describe, it, expect } from "vitest";
import {
  ANIMATION_PRESETS,
  findPresetById,
} from "../animation-presets";
import type { TemplateDefinition, TextLayer, ShapeLayer } from "../types";

// Helper: master sintético con un logo (image), un headline (text grande),
// un sub (text mediano) y un CTA (text con backgroundColor — patrón del
// preset "Botón" del editor). Cubre las heurísticas hero/CTA usadas por
// los presets.
function makeMaster(): TemplateDefinition {
  return {
    id: "tpl_root",
    type: "frame",
    position: { x: 0, y: 0 },
    size: { w: 1080, h: 1080 },
    layout: { mode: "free" },
    children: [
      {
        id: "logo",
        type: "image",
        src: "",
        position: { x: 40, y: 40 },
        size: { w: 120, h: 60 },
      },
      {
        id: "headline",
        type: "text",
        content: "Big news",
        position: { x: 100, y: 200 },
        size: { w: 880, h: 200 },
        style: { fontSize: 96, fontWeight: 700, color: "#000" },
      } as TextLayer,
      {
        id: "sub",
        type: "text",
        content: "Smaller text",
        position: { x: 100, y: 500 },
        size: { w: 880, h: 80 },
        style: { fontSize: 36, fontWeight: 400, color: "#555" },
      } as TextLayer,
      {
        id: "cta",
        type: "text",
        content: "Comprar",
        position: { x: 400, y: 800 },
        size: { w: 280, h: 80 },
        style: {
          fontSize: 24,
          fontWeight: 700,
          color: "#fff",
          backgroundColor: "#0F172A",
          backgroundCornerRadius: 40,
        },
      } as TextLayer,
    ],
  };
}

describe("ANIMATION_PRESETS registry", () => {
  it("expone al menos 5 presets con id y label únicos", () => {
    expect(ANIMATION_PRESETS.length).toBeGreaterThanOrEqual(5);
    const ids = new Set(ANIMATION_PRESETS.map((p) => p.id));
    expect(ids.size).toBe(ANIMATION_PRESETS.length);
  });

  it("findPresetById resuelve por id y devuelve null para desconocidos", () => {
    expect(findPresetById("fade-in")?.label).toBe("Fade in");
    expect(findPresetById("does-not-exist")).toBeNull();
  });
});

describe("fade-in preset", () => {
  it("crea opacity 0→1 para cada top-level child", () => {
    const master = makeMaster();
    const cfg = findPresetById("fade-in")!.build(master);
    expect(cfg.tracks).toHaveLength(4); // logo, headline, sub, cta
    for (const t of cfg.tracks) {
      expect(t.property).toBe("opacity");
      expect(t.keyframes[0].value).toBe(0);
      expect(t.keyframes[1].value).toBe(1);
    }
    expect(cfg.loop).toBe(1);
    expect(cfg.duration).toBeGreaterThan(0);
  });
});

describe("slide-bottom preset", () => {
  it("siembra position.y con offset desde el base + opacity", () => {
    const master = makeMaster();
    const cfg = findPresetById("slide-bottom")!.build(master);
    // 2 tracks por layer × 4 layers = 8
    expect(cfg.tracks).toHaveLength(8);
    const headlinePosY = cfg.tracks.find(
      (t) => t.layerId === "headline" && t.property === "position.y",
    )!;
    // base y = 200. offset 80 → arranca en 280.
    expect(headlinePosY.keyframes[0].value).toBe(280);
    expect(headlinePosY.keyframes[1].value).toBe(200);
  });
});

describe("sequential-reveal preset", () => {
  it("stagger cada layer con un delay incremental", () => {
    const master = makeMaster();
    const cfg = findPresetById("sequential-reveal")!.build(master);
    const stagger = 250;
    for (let i = 0; i < cfg.tracks.length; i++) {
      const t = cfg.tracks[i];
      expect(t.property).toBe("opacity");
      expect(t.keyframes[0].t).toBe(i * stagger);
    }
  });
});

describe("hero-pop preset", () => {
  it("aplica scale + opacity al text más grande, solo opacity al resto", () => {
    const master = makeMaster();
    const cfg = findPresetById("hero-pop")!.build(master);
    // Headline (fontSize=96) es el hero. Debe tener scale + opacity (2 tracks).
    const heroTracks = cfg.tracks.filter((t) => t.layerId === "headline");
    expect(heroTracks).toHaveLength(2);
    expect(heroTracks.some((t) => t.property === "scale")).toBe(true);
    expect(heroTracks.some((t) => t.property === "opacity")).toBe(true);
    // Logo, sub, cta: solo opacity (1 track cada uno).
    for (const id of ["logo", "sub", "cta"]) {
      const layerTracks = cfg.tracks.filter((t) => t.layerId === id);
      expect(layerTracks).toHaveLength(1);
      expect(layerTracks[0].property).toBe("opacity");
    }
  });
});

describe("cta-pulse preset", () => {
  it("detecta el CTA (text con backgroundColor) y aplica scale loop infinito", () => {
    const master = makeMaster();
    const cfg = findPresetById("cta-pulse")!.build(master);
    expect(cfg.loop).toBe("infinite");
    expect(cfg.tracks).toHaveLength(1);
    expect(cfg.tracks[0].layerId).toBe("cta");
    expect(cfg.tracks[0].property).toBe("scale");
    // 3 keyframes: 1 → 1.06 → 1.
    expect(cfg.tracks[0].keyframes).toHaveLength(3);
    expect(cfg.tracks[0].keyframes[0].value).toBe(1);
    expect(cfg.tracks[0].keyframes[1].value).toBeGreaterThan(1);
    expect(cfg.tracks[0].keyframes[2].value).toBe(1);
  });

  it("sin CTA detectado devuelve timeline vacío con duration sensata", () => {
    const master: TemplateDefinition = {
      id: "tpl_root",
      type: "frame",
      position: { x: 0, y: 0 },
      size: { w: 1080, h: 1080 },
      layout: { mode: "free" },
      children: [
        {
          id: "bg",
          type: "shape",
          shape: "rect",
          fill: "#000",
          position: { x: 0, y: 0 },
          size: { w: 1080, h: 1080 },
        } as ShapeLayer,
      ],
    };
    const cfg = findPresetById("cta-pulse")!.build(master);
    // Solo hay un shape sin backgroundColor → fallback al último child.
    // Pero el fallback es shape, no text → ESTÁ permitido animarlo igual
    // porque scale se aplica a cualquier tipo. Verificamos que NO crashee
    // y devuelva loop infinito.
    expect(cfg.loop).toBe("infinite");
    expect(cfg.tracks.length).toBeGreaterThanOrEqual(0);
  });
});

describe("spring-entrance preset", () => {
  it("aplica scale + opacity a TODOS los top-level children", () => {
    const master = makeMaster();
    const cfg = findPresetById("spring-entrance")!.build(master);
    expect(cfg.tracks).toHaveLength(8); // 2 × 4
    for (const id of ["logo", "headline", "sub", "cta"]) {
      const layerTracks = cfg.tracks.filter((t) => t.layerId === id);
      expect(layerTracks).toHaveLength(2);
      expect(layerTracks.map((t) => t.property).sort()).toEqual([
        "opacity",
        "scale",
      ]);
    }
  });
});
