import { describe, it, expect } from "vitest";
import { listCanvasVideos, videoFileName } from "../canvas-videos";

const lv = (id: string, title: string, idx: number, variant?: string, url: string | null = `https://x/${id}.mp4`) => ({
  id,
  type: "linked",
  position: { x: 0, y: 0 },
  data: { sourceCanvasTitle: title, linkSnapshot: { kind: "video", label: `Escena ${idx}${variant ?? ""}`, videoUrl: url, scene: { sceneIndex: idx, variant } } },
});

describe("listCanvasVideos", () => {
  it("vinculados en orden de montaje y después los propios", () => {
    const nodes = [
      { id: "own2", type: "video", position: { x: 0, y: 500 }, data: { status: "completed", outputUrl: "https://x/o2.mp4", label: "Cierre" } },
      lv("a10-1", "ACTO 10", 1),
      lv("a2-2b", "ACTO 2", 2, "B"),
      lv("a2-2", "ACTO 2", 2, "A"),
      lv("a2-1", "ACTO 2", 1, undefined, null),
      { id: "own1", type: "video", position: { x: 0, y: 100 }, data: { status: "generating" } },
      { id: "img", type: "image", position: { x: 0, y: 0 }, data: {} },
    ];
    const out = listCanvasVideos(nodes);
    expect(out.map((v) => v.nodeId)).toEqual(["a2-1", "a2-2", "a2-2b", "a10-1", "own1", "own2"]);
    expect(out[0]).toMatchObject({ label: "ACTO 2 · Escena 1", url: null });
    expect(out[4].url).toBeNull(); // sin terminar
  });

  it("nombres de archivo que se ordenan en la carpeta", () => {
    expect(videoFileName(2, 50, "ACTO 1 · Escena 3")).toBe("03 - ACTO 1 - Escena 3.mp4");
    expect(videoFileName(0, 5, 'a/b:c')).toBe("1 - abc.mp4");
  });

  it("los videos de las escenas de este canvas, con su escena y en orden", () => {
    const sc = (i: number) => ({ id: `s${i}`, type: "scene", position: { x: 0, y: 0 }, data: { scriptNodeId: "g", sceneIndex: i } });
    const vid = (id: string, y: number, label = "Video") => ({ id, type: "video", position: { x: 0, y }, data: { status: "completed", outputUrl: `https://x/${id}.mp4`, label } });
    const nodes = [vid("v2", 0), vid("suelto", 50, "Prueba"), vid("v1", 900), sc(1), sc(2)];
    const out = listCanvasVideos(nodes, [{ source: "s1", target: "v1" }, { source: "s2", target: "v2" }]);
    expect(out.map((v) => v.label)).toEqual(["Escena 1", "Escena 2", "Prueba"]);
  });
});

