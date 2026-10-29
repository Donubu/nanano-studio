import { describe, it, expect } from "vitest";
import { exportBundleName, exportFileName, slugToken } from "../export-naming";

describe("export naming", () => {
  it("arma cliente_proyecto_pieza_canal_WxH_vN.ext sin acentos", () => {
    expect(
      exportFileName({ client: "Enaco", project: "Prueba IA · Reserva San Francisco", template: "Santuario de la Laguna", channel: "gdn", width: 300, height: 250, version: 4, ext: "jpg" }),
    ).toBe("enaco_prueba-ia-reserva-san-francisco_santuario-de-la-laguna_gdn_300x250_v4.jpg");
  });
  it("omite lo que no hay y agrega la fila del dataset", () => {
    expect(exportFileName({ template: "Promo", width: 1080, height: 1080, ext: ".png", row: "Fila 3" })).toBe("promo_1080x1080_fila-3.png");
  });
  it("acorta tokens largos", () => {
    expect(slugToken("a".repeat(60)).length).toBe(40);
  });
  it("nombre del paquete", () => {
    expect(exportBundleName({ client: "Enaco", project: "Invierno", template: "Promo", version: 2, suffix: "html5" })).toBe("enaco_invierno_promo_v2_html5.zip");
  });
});
