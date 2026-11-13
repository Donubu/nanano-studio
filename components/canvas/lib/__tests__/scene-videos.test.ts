import { describe, it, expect } from "vitest";
import { sceneFinalVideos, sceneOfVideo } from "../scene-videos";

const n = (id: string, type: string, data: Record<string, unknown> = {}) => ({ id, type, data });
const e = (source: string, target: string) => ({ source, target });

describe("sceneFinalVideos", () => {
  const scene = (i: number, variant?: string) => n(`s${i}${variant === "B" ? "b" : ""}`, "scene", { scriptNodeId: "sc", sceneIndex: i, totalScenes: 3, variant });

  it("el video al final de cada escena, sin mezclar escenas", () => {
    const nodes = [
      n("sc", "script"), scene(1), scene(2), scene(3),
      n("i1", "image"), n("v1", "video"),
      n("i2", "image"), n("i2b", "image"), n("v2", "video"),
      n("v3", "video"), // destino directo
    ];
    const edges = [
      e("sc", "s1"), e("s1", "s2"), e("s2", "s3"),
      e("s1", "i1"), e("i1", "v1"),
      e("s2", "i2"), e("i2", "i2b"), e("i2b", "v2"),
      e("s3", "v3"),
      e("i1", "i2"), // continuidad entre destinos
      e("i2", "v1"), // último fotograma del video 1 = imagen de la escena 2
    ];
    const out = sceneFinalVideos(nodes, edges);
    expect(out.map((s) => [s.sceneIndex, s.videoIds])).toEqual([[1, ["v1"]], [2, ["v2"]], [3, ["v3"]]]);
    expect(sceneOfVideo("v2", out)?.sceneIndex).toBe(2);
  });

  it("si un video sale de otro, el final es el último", () => {
    const nodes = [scene(1), n("i1", "image"), n("v1", "video"), n("v1x", "video")];
    const out = sceneFinalVideos(nodes, [e("s1", "i1"), e("i1", "v1"), e("v1", "v1x")]);
    expect(out[0].videoIds).toEqual(["v1x"]);
  });

  it("la versión B tiene su propio video, después de la A", () => {
    const nodes = [scene(2, "B"), scene(2, "A"), n("v2", "video"), n("v2b", "video")];
    const out = sceneFinalVideos(nodes, [e("s2", "v2"), e("s2b", "v2b")]);
    expect(out.map((s) => [s.variant, s.videoIds])).toEqual([["A", ["v2"]], ["B", ["v2b"]]]);
  });
});
