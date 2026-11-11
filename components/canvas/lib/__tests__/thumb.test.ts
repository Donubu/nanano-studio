import { describe, expect, it } from "vitest";
import { needsOriginal, thumbUrl } from "../thumb";

describe("thumbUrl", () => {
  it("pasa las imágenes del bucket por el optimizador de Next con el ancho pedido", () => {
    const url = "https://storage.googleapis.com/puerto/generated/1_2_abc.jpeg";
    expect(thumbUrl(url, 384)).toBe(`/_next/image?url=${encodeURIComponent(url)}&w=384&q=75`);
  });

  it("deja igual lo que el optimizador no acepta", () => {
    expect(thumbUrl("blob:https://puerto.studio/123", 384)).toBe("blob:https://puerto.studio/123");
    expect(thumbUrl("data:image/png;base64,AAAA", 384)).toBe("data:image/png;base64,AAAA");
    expect(thumbUrl("https://otro.com/a.png", 384)).toBe("https://otro.com/a.png");
    expect(thumbUrl("http://storage.googleapis.com/a.png", 384)).toBe("http://storage.googleapis.com/a.png");
    expect(thumbUrl("no es url", 384)).toBe("no es url");
    expect(thumbUrl(null, 384)).toBe("");
  });
});

describe("needsOriginal", () => {
  it("pide el original solo si la miniatura se vería estirada", () => {
    // Nodo de 280 px a zoom 1 en retina: 560 px reales, la de 640 alcanza.
    expect(needsOriginal(280, 1, 2, 640)).toBe(false);
    // A zoom 2: 1120 px reales.
    expect(needsOriginal(280, 2, 2, 640)).toBe(true);
    // Nodo agrandado a 500 px, zoom 1, retina.
    expect(needsOriginal(500, 1, 2, 640)).toBe(true);
    // Sin medir todavía.
    expect(needsOriginal(0, 2, 2, 640)).toBe(false);
  });
});
