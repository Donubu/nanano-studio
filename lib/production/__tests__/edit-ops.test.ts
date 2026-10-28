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
