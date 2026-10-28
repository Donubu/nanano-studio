import { describe, it, expect } from "vitest";
import { MODERN_TEMPLATES } from "../layout-templates-modern";
import { LAYOUT_TEMPLATES } from "../layout-templates";
import { lintLayout, safeMargin } from "../layout-lint";
import { describeTemplate } from "../layout-plan";
import type { TemplateLayer } from "../types";

const ASPECTS = ["horizontal", "square", "vertical"] as const;

describe("plantillas contemporáneas", () => {
  it("van primero en el catálogo y con ids únicos", () => {
    expect(LAYOUT_TEMPLATES.slice(0, MODERN_TEMPLATES.length).map((t) => t.id)).toEqual(MODERN_TEMPLATES.map((t) => t.id));
    const ids = LAYOUT_TEMPLATES.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const tpl of MODERN_TEMPLATES) {
    for (const a of ASPECTS) {
      it(`${tpl.id} · ${a}: sin errores de lint y todo dentro del margen`, () => {
        const def = tpl.aspects[a];
        const errors = lintLayout(def).filter((i) => i.severity === "error");
        expect(errors.map((e) => e.detail)).toEqual([]);
        const m = safeMargin(def.size);
        for (const l of def.children as TemplateLayer[]) {
          if (l.type !== "text") continue;
          expect(l.position.x, `${l.id} x`).toBeGreaterThanOrEqual(m);
          expect(l.position.y, `${l.id} y`).toBeGreaterThanOrEqual(m);
          expect(l.position.x + l.size.w, `${l.id} derecha`).toBeLessThanOrEqual(def.size.w - m);
          expect(l.position.y + l.size.h, `${l.id} abajo`).toBeLessThanOrEqual(def.size.h - m);
        }
      });
    }

    it(`${tpl.id}: mismos slots en las tres orientaciones, con legal y CTA`, () => {
      const ids = ASPECTS.map((a) =>
        tpl.aspects[a].children
          .filter((l) => l.type === "text" || l.type === "image")
          .map((l) => l.id)
          .sort()
          .join(","),
      );
      expect(new Set(ids).size).toBe(1);
      const slots = describeTemplate(tpl).texts.map((s) => s.id);
      expect(slots).toContain("legal");
      expect(slots).toContain("cta");
    });
  }
});

describe("foto enmarcada al adaptar", () => {
  it("conserva el marco simétrico en otros formatos en vez de llevar la foto a sangre", async () => {
    const { adaptTree } = await import("../adapt");
    const framed = MODERN_TEMPLATES.find((t) => t.id === "framed-photo")!.aspects.horizontal;
    for (const size of [{ w: 300, h: 250 }, { w: 728, h: 90 }, { w: 1080, h: 1080 }]) {
      const out = adaptTree(framed, size);
      const hero = out.children.find((c) => c.id === "hero")!;
      const m = hero.position.x;
      expect(m, `${size.w}x${size.h}`).toBeGreaterThan(0);
      expect(hero.position.y).toBe(m);
      expect(Math.round(hero.position.x + hero.size.w)).toBe(size.w - m);
      expect(Math.round(hero.position.y + hero.size.h)).toBe(size.h - m);
      expect(lintLayout(out).some((i) => i.kind === "background_gap")).toBe(false);
    }
  });
});
