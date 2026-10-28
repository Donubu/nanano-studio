import { describe, it, expect } from "vitest";
import { skinLayout, defaultSkinGeometry, applySkin } from "../skin";
import { keyOutRgba, pickKeyColor } from "../skin-image";
import { keepLayerAspect } from "../reflow";
import { applyEditOps } from "../edit-ops";
import type { LayerSkin, TextLayer, TemplateDefinition } from "../types";

const buttonSkin = (): LayerSkin => ({
  src: "https://x/skin.png",
  imageW: 600,
  imageH: 200,
  ...defaultSkinGeometry("button", 600, 200),
});

const text = (w: number, h: number): TextLayer => ({
  id: "t",
  type: "text",
  position: { x: 100, y: 100 },
  size: { w, h },
  content: "COMPRAR",
  style: { fontSize: 40, color: "#111111", backgroundColor: "#FFCC00" },
});

describe("skinLayout", () => {
  it("con la proporción de la imagen es la imagen escalada, sin estirar", () => {
    const { cells } = skinLayout(buttonSkin(), { w: 300, h: 100 });
    for (const c of cells) {
      expect(c.bgW).toBeCloseTo(300, 0);
      expect(c.bgH).toBeCloseTo(100, 0);
    }
  });

  it("botón ancho: los extremos conservan su ancho y solo se estira el centro", () => {
    const skin = buttonSkin();
    const { cells, content } = skinLayout(skin, { w: 900, h: 100 });
    const k = 100 / 200;
    const [, R, , L] = skin.slice!;
    const top = cells.filter((c) => c.y === 0);
    expect(top).toHaveLength(3);
    expect(top[0].w).toBe(Math.round(L * k));
    expect(top[2].x + top[2].w).toBe(900);
    expect(top[2].w).toBe(900 - Math.round(900 - R * k) + 1);
    // Las celdas cubren la caja sin huecos (se solapan 1 px).
    expect(top[1].x).toBe(top[0].x + top[0].w - 1);
    expect(top[2].x).toBe(top[1].x + top[1].w - 1);
    // El texto evita los extremos.
    expect(content.x).toBeGreaterThan(0);
    expect(content.x + content.w).toBeLessThan(900);
  });

  it("sello: la imagen entera, centrada y sin deformar en una caja de otra proporción", () => {
    const skin: LayerSkin = { src: "s", imageW: 400, imageH: 400, ...defaultSkinGeometry("badge", 400, 400) };
    const { cells, content } = skinLayout(skin, { w: 300, h: 200 });
    expect(cells).toHaveLength(1);
    expect(cells[0]).toMatchObject({ w: 200, h: 200, x: 50, y: 0 });
    expect(content.w).toBeLessThan(200);
  });
});

describe("applySkin", () => {
  it("un sello toma la proporción de la imagen conservando área y centro", () => {
    const skin: LayerSkin = { src: "s", imageW: 500, imageH: 500, ...defaultSkinGeometry("badge", 500, 500) };
    const next = applySkin(text(400, 100), skin, "#E11D48", { w: 1080, h: 1080 }) as TextLayer;
    expect(next.size.w).toBe(next.size.h);
    expect(next.size.w).toBe(200);
    expect(next.position.x + next.size.w / 2).toBe(300);
    expect(next.style.backgroundColor).toBe("#E11D48");
    expect(next.skin?.mode).toBe("fit");
  });

  it("un sello con piel no se deforma al adaptar", () => {
    const skin: LayerSkin = { src: "s", imageW: 500, imageH: 500, ...defaultSkinGeometry("badge", 500, 500) };
    const orig = applySkin(text(400, 100), skin, "#E11D48") as TextLayer;
    const stretched = { ...orig, size: { w: orig.size.w * 1.3, h: orig.size.h } };
    const fixed = keepLayerAspect(stretched, orig);
    expect(fixed.size.w / fixed.size.h).toBeCloseTo(1, 2);
  });
});

describe("keyOutRgba", () => {
  // Imagen 40×20: fondo magenta "sucio" y un rectángulo amarillo al medio.
  function sample() {
    const w = 40;
    const h = 20;
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const inside = x >= 10 && x < 30 && y >= 5 && y < 15;
        const rgb = inside ? [250, 204, 21] : [245, 10 + (x % 3), 250];
        data.set([...rgb, 255], i);
      }
    }
    return { data, w, h };
  }

  it("quita el fondo, recorta a la forma y da el color del centro", () => {
    const { data, w, h } = sample();
    const out = keyOutRgba(data, w, h);
    expect(out.width).toBe(24); // 20 + 2 px de aire por lado
    expect(out.height).toBe(14);
    expect(out.data[3]).toBe(0); // esquina transparente
    const center = ((7 * out.width) + 12) * 4;
    expect(out.data[center + 3]).toBe(255);
    expect(out.averageColor).toBe("#FACC15");
  });

  it("elige verde como clave si la piel va a ser rosada o morada", () => {
    expect(pickKeyColor(["#FFCC00"]).name).toBe("magenta");
    expect(pickKeyColor(["#E11D99"]).name).toBe("green");
  });
});

describe("set_skin", () => {
  const def: TemplateDefinition = {
    id: "tpl_root",
    type: "frame",
    position: { x: 0, y: 0 },
    size: { w: 1080, h: 1080 },
    layout: { mode: "free" },
    children: [text(400, 100)],
  };

  it("pide la piel con el tipo según la forma de la capa", () => {
    const r = applyEditOps(def, [{ op: "set_skin", id: "t", skin_prompt: "glossy 3D yellow button" }]);
    expect(r.skins).toEqual([{ layer_id: "t", kind: "button", prompt: "glossy 3D yellow button" }]);
  });

  it("aplica el color pedido y quita la piel con none", () => {
    const withSkin: TemplateDefinition = {
      ...def,
      children: [{ ...text(400, 100), skin: buttonSkin() }],
    };
    const r = applyEditOps(withSkin, [
      { op: "set_skin", id: "t", skin_prompt: "red ribbon", skin_kind: "badge", background_color: "#E11D48" },
    ]);
    expect((r.definition.children[0] as TextLayer).style.backgroundColor).toBe("#E11D48");
    expect(r.skins[0].kind).toBe("badge");
    const off = applyEditOps(withSkin, [{ op: "set_skin", id: "t", skin_kind: "none" }]);
    expect((off.definition.children[0] as TextLayer).skin).toBeNull();
    expect(off.skins).toHaveLength(0);
  });
});

describe("keyOutRgba · sombras", () => {
  it("la sombra dibujada sobre el fondo queda negra semitransparente, no morada", () => {
    const w = 40;
    const h = 20;
    const data = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const inside = x >= 10 && x < 30 && y >= 5 && y < 15;
        // Sombra: franja a la derecha/abajo de la forma = magenta al 40%.
        const shadowed = !inside && x >= 12 && x < 33 && y >= 7 && y < 17;
        const rgb = inside ? [250, 204, 21] : shadowed ? [102, 0, 102] : [255, 0, 255];
        data.set([...rgb, 255], (y * w + x) * 4);
      }
    }
    const out = keyOutRgba(data, w, h);
    // Píxel de sombra (x=31, y=12 en la original) dentro del recorte.
    const ox = 31 - 8;
    const oy = 12 - 3;
    const i = (oy * out.width + ox) * 4;
    expect(out.data[i]).toBe(0);
    expect(out.data[i + 2]).toBe(0);
    expect(out.data[i + 3]).toBeGreaterThan(130);
    expect(out.data[i + 3]).toBeLessThan(170);
  });
});
