import { describe, it, expect } from "vitest";
import { lowResAssets, upscaleFactor, isUpscalableSrc } from "../image-resolution";
import type { TemplateDefinition, TemplateLayer } from "../types";

const image = (id: string, src: string, w: number, h: number): TemplateLayer =>
  ({ id, type: "image", src, position: { x: 0, y: 0 }, size: { w, h } }) as unknown as TemplateLayer;
const def = (w: number, h: number, children: TemplateLayer[]): TemplateDefinition =>
  ({ size: { w, h }, children, background: "#fff" }) as unknown as TemplateDefinition;

describe("upscaleFactor", () => {
  it("tolera hasta 25% de estiramiento y luego sube por enteros", () => {
    expect(upscaleFactor({ w: 1024, h: 1024 }, { w: 1200, h: 1200 })).toBe(1);
    expect(upscaleFactor({ w: 1024, h: 1024 }, { w: 1920, h: 1080 })).toBe(2);
    expect(upscaleFactor({ w: 1024, h: 1024 }, { w: 2160, h: 2160 })).toBe(3);
    expect(upscaleFactor({ w: 1024, h: 1024 }, { w: 9000, h: 9000 })).toBe(4);
  });
});

describe("lowResAssets", () => {
  it("junta la caja más exigente por imagen y dónde se nota", () => {
    const photo = "https://storage.googleapis.com/b/p.png";
    const pieces = [
      { label: "300×250", tree: def(300, 250, [image("a", photo, 300, 250)]), pixelRatio: 1 },
      { label: "Feed", tree: def(1080, 1080, [image("a", photo, 1080, 700)]), pixelRatio: 2 },
      { label: "Story", tree: def(1080, 1920, [image("a", photo, 1080, 1100)]), pixelRatio: 2 },
    ];
    const out = lowResAssets(pieces, new Map([[photo, { w: 1024, h: 1024 }]]));
    expect(out).toHaveLength(1);
    expect(out[0].need).toEqual({ w: 2160, h: 2200 });
    expect(out[0].factor).toBe(3);
    expect(out[0].where).toEqual(["Feed", "Story"]);
  });
  it("ignora imágenes sin tamaño conocido", () => {
    const pieces = [{ label: "x", tree: def(1080, 1080, [image("a", "https://x/y.png", 1080, 1080)]), pixelRatio: 2 }];
    expect(lowResAssets(pieces, new Map())).toEqual([]);
  });
});

describe("isUpscalableSrc", () => {
  it("solo rasters https", () => {
    expect(isUpscalableSrc("https://x/y.png")).toBe(true);
    expect(isUpscalableSrc("https://x/icon.svg")).toBe(false);
    expect(isUpscalableSrc("data:image/png;base64,AAA")).toBe(false);
  });
});
