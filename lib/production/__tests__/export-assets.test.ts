import { describe, it, expect } from "vitest";
import { assetBoxes, collectFontUsage, googleFontsCssUrl } from "../export-assets";
import type { TemplateDefinition } from "../types";

const tree: TemplateDefinition = {
  id: "tpl_root",
  type: "frame",
  position: { x: 0, y: 0 },
  size: { w: 1920, h: 1080 },
  layout: { mode: "free" },
  children: [
    { id: "bg", type: "image", src: "https://b/photo.jpg", position: { x: 0, y: 0 }, size: { w: 1920, h: 1080 } },
    { id: "logo", type: "image", src: "https://b/logo.png", position: { x: 40, y: 40 }, size: { w: 200, h: 80 } },
    { id: "cta", type: "text", content: "COMPRAR", position: { x: 100, y: 900 }, size: { w: 400, h: 100 }, style: { fontSize: 40, color: "#fff", fontFamily: "Montserrat, sans-serif", fontWeight: 800 }, skin: { src: "https://b/skin.png", imageW: 900, imageH: 300, mode: "slice", slice: [80, 140, 80, 140], inset: [0.1, 0.1, 0.1, 0.1] } },
    { id: "t", type: "text", content: "Hola mundo", position: { x: 100, y: 100 }, size: { w: 800, h: 200 }, style: { fontSize: 90, color: "#fff", fontFamily: "Inter, system-ui", fontWeight: "bold", textTransform: "uppercase", fill: { type: "texture", src: "https://b/tex.jpg" } } },
    { id: "hidden", type: "image", src: "https://b/hidden.jpg", visible: false, position: { x: 0, y: 0 }, size: { w: 500, h: 500 } },
  ],
};

describe("assetBoxes", () => {
  it("mide cada URL por su caja dibujada, escalada por el wrapper, y omite ocultas", () => {
    const b = assetBoxes(tree, 300 / 1920);
    expect(b.get("https://b/photo.jpg")).toEqual({ w: 300, h: 169 });
    expect(b.get("https://b/logo.png")).toEqual({ w: 32, h: 13 });
    expect(b.get("https://b/skin.png")).toEqual({ w: 63, h: 16 });
    expect(b.get("https://b/tex.jpg")).toEqual({ w: 125, h: 32 });
    expect(b.has("https://b/hidden.jpg")).toBe(false);
  });
});

describe("collectFontUsage / googleFontsCssUrl", () => {
  it("junta familias de Google con el peso disponible más cercano y los glifos en ambas cajas", () => {
    const u = collectFontUsage(tree);
    expect([...u.families.get("Montserrat")!]).toEqual([800]);
    expect([...u.families.get("Inter")!]).toEqual([700]);
    expect(u.text).toContain("H");
    expect(u.text).toContain("h");
    expect(u.text).toContain("$");
    const url = googleFontsCssUrl(u)!;
    expect(url).toContain("family=Montserrat:wght@800");
    expect(url).toContain("family=Inter:wght@700");
    expect(url).toContain("&text=");
  });

  it("sin fuentes de Google no hay URL", () => {
    const u = collectFontUsage({ ...tree, children: [] });
    expect(googleFontsCssUrl(u)).toBeNull();
  });
});

describe("fotos que sangran", () => {
  it("detecta la caja fuera del formato y calcula el recorte visible con fit cover", async () => {
    const { bleedingImages, cropRectFor, rewriteBleedingImage } = await import("../export-assets");
    const t: TemplateDefinition = {
      ...tree,
      size: { w: 728, h: 90 },
      children: [{ id: "bg", type: "image", src: "https://b/p.jpg", position: { x: -364, y: -300 }, size: { w: 1456, h: 690 }, focalX: 50, focalY: 40 }],
    };
    const [c] = bleedingImages(t);
    expect(c.visible).toEqual({ x: 0, y: 0, w: 728, h: 90 });
    // Foto 1024×485: cover de 1456×690 → s = 1.4219; recorte de 512 px de ancho.
    const r = cropRectFor(c, 1024, 485);
    expect(Math.round(r.w)).toBe(512);
    expect(Math.round(r.h)).toBe(63);
    expect(Math.round(r.x)).toBe(256);
    const html = `<div style="position:absolute;left:-364px;top:-300px;width:1456px;height:690px;opacity:1" data-layer-id="bg"><img src="https://b/p.jpg" style="width:100%;height:100%;object-fit:cover;object-position:50% 40%"></div>`;
    const out = rewriteBleedingImage(html, c, "data:image/jpeg;base64,AAA");
    expect(out).toContain("left:0px;top:0px;width:728px;height:90px");
    expect(out).toContain("object-position:50% 50%");
    expect(out).toContain('src="data:image/jpeg;base64,AAA"');
  });
});
