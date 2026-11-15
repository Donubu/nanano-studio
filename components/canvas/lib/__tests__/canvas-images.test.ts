import { describe, it, expect } from "vitest";
import { countCanvasImages, imageExtension, imageFileName, listCanvasImages } from "../canvas-images";

const at = (x: number, y: number) => ({ x, y });

describe("listCanvasImages", () => {
  const nodes = [
    { id: "free", type: "image", position: at(0, 900), data: { status: "completed", outputUrl: "https://x/free.png", label: "Póster" } },
    { id: "pend", type: "image", position: at(0, 0), data: { status: "generating" } },
    { id: "sc", type: "script", position: at(0, 0), data: {} },
    { id: "s2", type: "scene", position: at(0, 0), data: { scriptNodeId: "sc", sceneIndex: 2, totalScenes: 2 } },
    { id: "s1", type: "scene", position: at(0, 0), data: { scriptNodeId: "sc", sceneIndex: 1, totalScenes: 2 } },
    { id: "i2", type: "image", position: at(0, 0), data: { status: "completed", outputUrl: "https://x/i2.jpg", label: "Imagen" } },
    { id: "i1", type: "image", position: at(0, 0), data: { status: "completed", outputUrl: "https://x/i1.png", label: "Imagen" } },
    { id: "gal", type: "static-image-group", position: at(0, 500), data: { label: "Refs", images: [{ url: "https://x/g1.webp" }, { url: "https://x/g2.png" }] } },
    { id: "dup", type: "static-image", position: at(0, 600), data: { imageUrl: "https://x/g1.webp" } },
    {
      id: "l10", type: "linked", position: at(0, 0),
      data: { sourceCanvasTitle: "ACTO 10", linkSnapshot: { kind: "image", label: "Cierre", imageUrl: "https://x/a10.png" } },
    },
    {
      id: "lp", type: "linked", position: at(0, 0),
      data: {
        sourceCanvasTitle: "ACTO 2",
        linkSnapshot: { kind: "character", label: "Ana", stages: [{ name: "Niña", imageUrl: "https://x/ana1.png" }, { name: "Adulta", imageUrl: null }] },
      },
    },
    { id: "lv", type: "linked", position: at(0, 0), data: { sourceCanvasTitle: "ACTO 2", linkSnapshot: { kind: "video", videoUrl: "https://x/v.mp4" } } },
  ];
  const edges = [
    { source: "sc", target: "s1" }, { source: "s1", target: "s2" },
    { source: "s1", target: "i1" }, { source: "s2", target: "i2" },
  ];

  it("vinculadas por canvas, luego las escenas en orden y al final las demás", () => {
    const out = listCanvasImages(nodes, edges);
    expect(out.map((i) => [i.key, i.label])).toEqual([
      ["lp#0", "ACTO 2 · Ana · Niña"],
      ["l10", "ACTO 10 · Cierre"],
      ["i1", "Escena 1"],
      ["i2", "Escena 2"],
      ["gal#0", "Refs · 1"],
      ["gal#1", "Refs · 2"],
      ["free", "Póster"],
    ]);
    expect(countCanvasImages(nodes)).toBe(7);
  });

  it("nombres de archivo numerados con la extensión de la URL", () => {
    expect(imageFileName(2, 12, { label: "ACTO 1 · Escena 3", url: "https://x/a.jpeg?x=1" })).toBe("03 - ACTO 1 - Escena 3.jpg");
    expect(imageExtension("https://x/sin-extension")).toBe("png");
  });
});
