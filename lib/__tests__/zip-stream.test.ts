import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { zipStream } from "../zip-stream";

async function* chunks(...parts: string[]) {
  for (const p of parts) yield new TextEncoder().encode(p);
}

describe("zipStream", () => {
  it("arma un ZIP válido con los archivos en orden", async () => {
    const out: Uint8Array[] = [];
    for await (const c of zipStream([
      { name: "01 - ACTO 1 - Escena 1.mp4", data: chunks("hola ", "mundo") },
      { name: "02 - ACTO 1 - Escena 2 (ñ).mp4", data: chunks("x".repeat(70000)) },
    ])) out.push(c);
    const buf = Buffer.concat(out);
    const zip = await JSZip.loadAsync(buf, { checkCRC32: true });
    expect(Object.keys(zip.files)).toEqual(["01 - ACTO 1 - Escena 1.mp4", "02 - ACTO 1 - Escena 2 (ñ).mp4"]);
    expect(await zip.file("01 - ACTO 1 - Escena 1.mp4")!.async("string")).toBe("hola mundo");
    expect((await zip.file("02 - ACTO 1 - Escena 2 (ñ).mp4")!.async("string")).length).toBe(70000);
  });
});
