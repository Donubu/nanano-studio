import { describe, it, expect } from "vitest";
import { textEffectLayers, hasTextEffects } from "../text-effects";
import { applyTextPreset, mixColor } from "../text-presets";
import { applyEditOps } from "../edit-ops";
import { scaleLayerStyle } from "../scale";
import type { TextLayer, TemplateDefinition } from "../types";

const title = (style: Partial<TextLayer["style"]> = {}): TextLayer => ({
  id: "t",
  type: "text",
  content: "VUELA SIN LÍMITES",
  position: { x: 80, y: 80 },
  size: { w: 900, h: 140 },
  style: { fontSize: 100, color: "#FFCC00", ...style },
});

describe("textEffectLayers", () => {
  it("sin efectos nuevos no cambia el render (contorno simple sigue igual)", () => {
    expect(textEffectLayers(title({ outline: { color: "#000", width: 2 } }).style)).toBeNull();
  });

  it("degradado: la letra de adelante lleva el relleno recortado al texto", () => {
    const fx = textEffectLayers(title({ fill: { type: "gradient", value: "linear-gradient(180deg, #fff, #fc0)" } }).style)!;
    expect(fx.main.backgroundImage).toContain("linear-gradient");
    expect(fx.main.WebkitBackgroundClip).toBe("text");
    expect(fx.main.color).toBe("transparent");
    expect(fx.behind).toHaveLength(0);
  });

  it("contornos y volumen van detrás, del más externo al más interno", () => {
    const fx = textEffectLayers(
      title({
        outline: { color: "#FFFFFF", width: 4 },
        outline2: { color: "#111111", width: 3 },
        extrude: { color: "#553300", depth: 6, angle: 90 },
      }).style,
    )!;
    expect(fx.behind).toHaveLength(3);
    const [back, out2, out1] = fx.behind;
    expect(out1.WebkitTextStroke).toBe("8px #FFFFFF");
    expect(out2.WebkitTextStroke).toBe("14px #111111");
    // El volumen incluye el grosor de los contornos y baja 6 px a 90°.
    expect(back.WebkitTextStroke).toBe("14px #553300");
    expect(String(back.textShadow).split(", ")).toHaveLength(6);
    expect(String(back.textShadow)).toContain("0px 6px 0 #553300");
  });

  it("la sombra de la capa va en la copia de atrás, no sobre un degradado", () => {
    const fx = textEffectLayers(
      title({ fill: { type: "gradient", value: "linear-gradient(#fff,#000)" } }).style,
      { x: 0, y: 4, blur: 8, color: "rgba(0,0,0,0.4)" },
    )!;
    expect(fx.main.textShadow).toBeUndefined();
    expect(fx.behind[0].textShadow).toBe("0px 4px 8px rgba(0,0,0,0.4)");
  });
});

describe("estilos rápidos", () => {
  it("volumen: profundidad proporcional a la letra y color más oscuro", () => {
    const l = applyTextPreset(title(), "volume", "#FFCC00");
    expect(l.style.extrude?.depth).toBe(7);
    expect(l.style.extrude?.color).toBe(mixColor("#FFCC00", "#000000", 0.55));
    expect(hasTextEffects(l.style)).toBe(true);
  });

  it("plano limpia efectos y sombra", () => {
    const l = applyTextPreset(applyTextPreset(title(), "sticker", "#FFCC00"), "none", "#FFCC00");
    expect(hasTextEffects(l.style)).toBe(false);
    expect(l.style.outline).toBeNull();
    expect(l.shadow).toBeUndefined();
  });

  it("los efectos escalan con la pieza", () => {
    const l = applyTextPreset(title(), "sticker", "#FFCC00");
    const half = scaleLayerStyle(l, 0.5) as TextLayer;
    expect(half.style.outline2!.width).toBeCloseTo(l.style.outline2!.width / 2);
  });
});

describe("Pídele a la IA · texto gráfico", () => {
  const def: TemplateDefinition = {
    id: "tpl_root",
    type: "frame",
    position: { x: 0, y: 0 },
    size: { w: 1920, h: 1080 },
    layout: { mode: "free" },
    children: [title({ color: "{color.primary}" })],
  };

  it("estilo rápido con color de marca resuelto y contorno encima", () => {
    const r = applyEditOps(
      def,
      [{ op: "update", id: "t", text_style: "volume", outline_color: "#FFFFFF", outline_width: 3 }],
      undefined,
      {},
      { resolveColor: (c) => (c === "{color.primary}" ? "#E11D48" : c) },
    );
    const t = r.definition.children[0] as TextLayer;
    expect(t.style.extrude?.color).toBe(mixColor("#E11D48", "#000000", 0.55));
    expect(t.style.outline).toEqual({ color: "#FFFFFF", width: 3 });
    expect(t.style.color).toBe("{color.primary}");
  });

  it("degradado y textura pedidos", () => {
    const r = applyEditOps(def, [
      { op: "update", id: "t", gradient_colors: ["#FFFFFF", "#FFCC00"], texture_prompt: "gold foil" },
    ]);
    const t = r.definition.children[0] as TextLayer;
    expect(t.style.fill).toEqual({ type: "gradient", value: "linear-gradient(180deg, #FFFFFF, #FFCC00)" });
    expect(t.style.color).toBe("#FFFFFF");
    expect(r.textures).toEqual([{ layer_id: "t", prompt: "gold foil" }]);
  });
});

describe("estilos actuales", () => {
  it("degradado sutil: dos tonos cercanos del mismo color", () => {
    const l = applyTextPreset(title(), "subtle_gradient", "#FFCC00");
    expect(l.style.fill).toEqual({
      type: "gradient",
      value: `linear-gradient(180deg, ${mixColor("#FFCC00", "#FFFFFF", 0.2)}, ${mixColor("#FFCC00", "#000000", 0.12)})`,
    });
  });

  it("duotono usa el color de marca como segundo tono", () => {
    const l = applyTextPreset(title(), "duotone", "#FFCC00", "#E11D48");
    expect(l.style.fill).toEqual({ type: "gradient", value: "linear-gradient(90deg, #FFCC00, #E11D48)" });
  });

  it("sombra suave no agrega efectos de copias", () => {
    const l = applyTextPreset(title(), "soft", "#FFCC00");
    expect(hasTextEffects(l.style)).toBe(false);
    expect(l.shadow?.blur).toBe(30);
  });
});
