import { describe, it, expect } from "vitest";
import { applyEditOps } from "../edit-ops";
import type { TemplateDefinition, TextLayer } from "../types";

const def: TemplateDefinition = {
  id: "tpl_root",
  type: "frame",
  position: { x: 0, y: 0 },
  size: { w: 1920, h: 1080 },
  background: { type: "color", value: "#000000" },
  layout: { mode: "free" },
  children: [
    { id: "title", type: "text", content: "Hola", position: { x: 80, y: 80 }, size: { w: 800, h: 200 }, style: { fontSize: 120, color: "#fff" } },
    { id: "photo", type: "image", src: null, position: { x: 1000, y: 100 }, size: { w: 800, h: 800 } },
  ],
};
let n = 0;
const ids = () => `new${++n}`;

describe("applyEditOps", () => {
  it("cambia texto, estilo y fondo", () => {
    const r = applyEditOps(def, [
      { op: "set_text", id: "title", content: "2x1 en pizzas" },
      { op: "update", id: "title", font_size: 96, color: "{color.primary}" },
      { op: "set_background", color: "#FFF7ED" },
    ], ids);
    const t = r.definition.children[0] as TextLayer;
    expect(t.content).toBe("2x1 en pizzas");
    expect(t.style.fontSize).toBe(96);
    expect(t.style.color).toBe("{color.primary}");
    expect(r.definition.background).toEqual({ type: "color", value: "#FFF7ED" });
    expect(r.applied).toBe(3);
  });

  it("agrega capas y pide imágenes; un fondo full-bleed va atrás", () => {
    const r = applyEditOps(def, [
      { op: "add", kind: "badge", x: 1600, y: 60, w: 260, h: 260, content: "2x1" },
      { op: "add", kind: "image", x: 0, y: 0, w: 1920, h: 1080, image_prompt: "beach at sunset" },
      { op: "generate_image", id: "photo", image_prompt: "pizza close-up" },
    ], ids);
    expect(r.definition.children[0].type).toBe("image");
    expect(r.definition.children.at(-1)!.type).toBe("text");
    expect((r.definition.children.at(-1) as TextLayer).content).toBe("2x1");
    expect(r.images.map((i) => i.prompt).sort()).toEqual(["beach at sunset", "pizza close-up"]);
  });

  it("ignora ids inexistentes, colores inválidos y tipos desconocidos", () => {
    const r = applyEditOps(def, [
      { op: "remove", id: "ghost" },
      { op: "set_background", color: "red;x" },
      { op: "add", kind: "video" as never },
      { op: "remove", id: "photo" },
    ], ids);
    expect(r.applied).toBe(1);
    expect(r.skipped).toHaveLength(3);
    expect(r.definition.children.map((c) => c.id)).toEqual(["title"]);
  });
});

describe("capas nuevas sin color", () => {
  it("heredan el color del texto más cercano", () => {
    const r = applyEditOps(def, [{ op: "add", kind: "icon", icon_name: "Truck", x: 100, y: 300, w: 48, h: 48 }], () => "ic");
    const icon = r.definition.children.find((c) => c.id === "ic");
    expect(icon && icon.type === "icon" && icon.color).toBe("#fff");
  });
});

import { frameSubject } from "../edit-ops";
import { imageSize } from "../image-size";
import type { ImageLayer } from "../types";

// Dónde cae en la pieza el punto (sx%, sy%) de la foto, con la misma
// fórmula de object-fit: cover + object-position.
function subjectOnFrame(l: ImageLayer, photo: { w: number; h: number }, sx: number, sy: number) {
  const s = Math.max(l.size.w / photo.w, l.size.h / photo.h);
  const rw = photo.w * s;
  const rh = photo.h * s;
  return {
    x: l.position.x + ((l.size.w - rw) * (l.focalX ?? 50)) / 100 + (sx / 100) * rw,
    y: l.position.y + ((l.size.h - rh) * (l.focalY ?? 50)) / 100 + (sy / 100) * rh,
  };
}

describe("frameSubject", () => {
  const frame = { w: 1920, h: 1080 };
  const bg: ImageLayer = { id: "bg", type: "image", src: "x", position: { x: 0, y: 0 }, size: { w: 1920, h: 1080 } };

  it("centra al sujeto de un fondo 16:9 agrandando y moviendo la caja, sin destapar bordes", () => {
    const photo = { w: 1408, h: 768 };
    // Sujeto al 65%: llevarlo al centro necesita ~1.4× (dentro del tope 1.6×).
    const out = frameSubject(bg, frame, photo, { x: 65, y: 55 }, { x: 50, y: 50 }) as ImageLayer;
    const p = subjectOnFrame(out, photo, 65, 55);
    expect(Math.abs(p.x - 960)).toBeLessThan(20);
    expect(out.size.w).toBeLessThanOrEqual(1920 * 1.6);
    expect(out.position.x).toBeLessThanOrEqual(0);
    expect(out.position.x + out.size.w).toBeGreaterThanOrEqual(1920);
    expect(out.position.y + out.size.h).toBeGreaterThanOrEqual(1080);
  });

  it("con el sujeto muy al borde se queda en el tope de zoom y lo acerca", () => {
    const photo = { w: 1408, h: 768 };
    const out = frameSubject(bg, frame, photo, { x: 90, y: 50 }, { x: 50, y: 50 }) as ImageLayer;
    expect(out.size.w).toBeLessThanOrEqual(Math.round(1920 * 1.6));
    expect(subjectOnFrame(out, photo, 90, 50).x).toBeLessThan(0.9 * 1920);
  });

  it("en un vertical con foto horizontal alcanza con el punto focal", () => {
    const v = { w: 1080, h: 1920 };
    const photo = { w: 1408, h: 768 };
    const layer: ImageLayer = { ...bg, size: { w: 1080, h: 1920 } };
    const out = frameSubject(layer, v, photo, { x: 75, y: 50 }, { x: 50, y: 50 }) as ImageLayer;
    expect(out.size).toEqual({ w: 1080, h: 1920 });
    expect(Math.abs(subjectOnFrame(out, photo, 75, 50).x - 540)).toBeLessThan(20);
  });

  it("lee el tamaño de un PNG desde la cabecera", () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    png.set([0, 0, 5, 128], 16); // 1408
    png.set([0, 0, 3, 0], 20); // 768
    expect(imageSize(png)).toEqual({ w: 1408, h: 768 });
  });
});
