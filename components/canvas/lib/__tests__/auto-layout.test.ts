import { describe, it, expect } from "vitest";
import type { Node, Edge } from "@xyflow/react";
import { autoLayoutPositions } from "../auto-layout";

const node = (id: string, type = "image", x = 0, w = 300, h = 220): Node => ({ id, type, position: { x, y: 0 }, data: {}, width: w, height: h });
const edge = (source: string, target: string): Edge => ({ id: `${source}-${target}`, source, target });

function boxes(nodes: Node[], pos: Map<string, { x: number; y: number }>) {
  return nodes.map((n) => ({ id: n.id, x: pos.get(n.id)!.x, y: pos.get(n.id)!.y, w: n.width!, h: n.height! }));
}
function overlaps(nodes: Node[], pos: Map<string, { x: number; y: number }>) {
  const b = boxes(nodes, pos);
  let count = 0;
  for (let i = 0; i < b.length; i++)
    for (let j = i + 1; j < b.length; j++)
      if (b[i].x < b[j].x + b[j].w && b[j].x < b[i].x + b[i].w && b[i].y < b[j].y + b[j].h && b[j].y < b[i].y + b[i].h) count++;
  return count;
}

describe("autoLayoutPositions", () => {
  it("una cadena queda en una sola columna, de arriba hacia abajo", () => {
    const nodes = [node("a", "text"), node("b"), node("c", "video")];
    const pos = autoLayoutPositions(nodes, [edge("a", "b"), edge("b", "c")]);
    expect(pos.get("a")!.x).toBe(pos.get("b")!.x);
    expect(pos.get("b")!.x).toBe(pos.get("c")!.x);
    expect(pos.get("b")!.y).toBeGreaterThan(pos.get("a")!.y);
    expect(pos.get("c")!.y).toBeGreaterThan(pos.get("b")!.y);
  });

  it("una referencia baja hasta justo encima del nodo que la usa", () => {
    const nodes = [node("t", "text"), node("i1"), node("i2"), node("v", "video"), node("ref", "static-image")];
    const pos = autoLayoutPositions(nodes, [edge("t", "i1"), edge("i1", "i2"), edge("i2", "v"), edge("ref", "v")]);
    // ref alimenta a v (capa 3): queda en la capa 2, no arriba de todo.
    expect(pos.get("ref")!.y).toBe(pos.get("i2")!.y);
    expect(pos.get("v")!.y).toBeGreaterThan(pos.get("ref")!.y);
  });

  it("muchas variaciones de una imagen se parten en varias líneas", () => {
    const nodes = [node("root"), ...Array.from({ length: 16 }, (_, i) => node(`v${i}`))];
    const edges = Array.from({ length: 16 }, (_, i) => edge("root", `v${i}`));
    const pos = autoLayoutPositions(nodes, edges);
    const ys = new Set(Array.from({ length: 16 }, (_, i) => pos.get(`v${i}`)!.y));
    expect(ys.size).toBeGreaterThan(1);
    const b = boxes(nodes, pos);
    const width = Math.max(...b.map((x) => x.x + x.w)) - Math.min(...b.map((x) => x.x));
    const height = Math.max(...b.map((x) => x.y + x.h)) - Math.min(...b.map((x) => x.y));
    expect(width / height).toBeLessThan(4);
    expect(overlaps(nodes, pos)).toBe(0);
  });

  it("los flujos sueltos se acomodan en filas, no en una tira", () => {
    const nodes: Node[] = [];
    const edges: Edge[] = [];
    for (let f = 0; f < 12; f++) {
      nodes.push(node(`t${f}`, "text", f * 400), node(`i${f}`, "image", f * 400));
      edges.push(edge(`t${f}`, `i${f}`));
    }
    const pos = autoLayoutPositions(nodes, edges);
    const b = boxes(nodes, pos);
    const width = Math.max(...b.map((x) => x.x + x.w)) - Math.min(...b.map((x) => x.x));
    const height = Math.max(...b.map((x) => x.y + x.h)) - Math.min(...b.map((x) => x.y));
    expect(width / height).toBeLessThan(4);
    expect(overlaps(nodes, pos)).toBe(0);
    for (let f = 0; f < 12; f++) expect(pos.get(`i${f}`)!.y).toBeGreaterThan(pos.get(`t${f}`)!.y);
  });

  it("sin solapes con tamaños mixtos y conexiones cruzadas", () => {
    const nodes = [
      node("g", "static-image-group", 0, 700, 500), node("p", "params-image", 0, 260, 300),
      node("a", "image", 0, 990, 735), node("b", "image", 0, 400, 300), node("c", "image", 0, 990, 735),
      node("v1", "video", 0, 760, 840), node("v2", "video", 0, 300, 220),
    ];
    const edges = [edge("g", "a"), edge("g", "b"), edge("g", "c"), edge("p", "a"), edge("p", "c"), edge("a", "v1"), edge("b", "v1"), edge("c", "v2")];
    const pos = autoLayoutPositions(nodes, edges);
    expect(overlaps(nodes, pos)).toBe(0);
    for (const e of edges) expect(pos.get(e.target)!.y).toBeGreaterThan(pos.get(e.source)!.y);
  });

  it("una cadena de escenas con su imagen cada una no se tuerce en escalera", () => {
    const nodes: Node[] = [node("script", "script")];
    const edges: Edge[] = [];
    for (let i = 1; i <= 6; i++) {
      nodes.push(node(`s${i}`, "scene", 0, 400, 200), node(`img${i}`, "image", 0, 500, 400));
      edges.push(edge(i === 1 ? "script" : `s${i - 1}`, `s${i}`), edge(`s${i}`, `img${i}`));
    }
    const pos = autoLayoutPositions(nodes, edges);
    const xs = new Set(Array.from({ length: 6 }, (_, i) => pos.get(`s${i + 1}`)!.x));
    expect(xs.size).toBe(1);
    expect(overlaps(nodes, pos)).toBe(0);
  });

  it("tolera ciclos sin colgarse", () => {
    const nodes = [node("a", "text"), node("b", "text")];
    const pos = autoLayoutPositions(nodes, [edge("a", "b"), edge("b", "a")]);
    expect(pos.size).toBe(2);
    expect(overlaps(nodes, pos)).toBe(0);
  });
});
