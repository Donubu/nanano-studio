import { describe, it, expect } from "vitest";
import { parseDataUrl } from "../data-url";

describe("parseDataUrl", () => {
  it("separa el mime y los datos", () => {
    expect(parseDataUrl("data:image/png;base64,AAAA")).toEqual({ mimeType: "image/png", base64: "AAAA" });
  });

  it("rechaza lo que no es un data URL base64", () => {
    expect(parseDataUrl("https://x/a.png")).toBeNull();
    expect(parseDataUrl("data:image/png,AAAA")).toBeNull();
    expect(parseDataUrl("data:;base64,AAAA")).toBeNull();
    expect(parseDataUrl("data:image/png;base64,")).toBeNull();
    expect(parseDataUrl("data:image/png;charset=x;base64,AAAA")).toBeNull();
  });

  it("aguanta imágenes grandes (millones de caracteres)", () => {
    const big = "data:image/jpeg;base64," + "Ab+/".repeat(2_500_000);
    const parts = parseDataUrl(big);
    expect(parts?.mimeType).toBe("image/jpeg");
    expect(parts?.base64.length).toBe(10_000_000);
  });
});
