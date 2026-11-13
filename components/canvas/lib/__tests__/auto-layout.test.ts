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

describe("autoLayoutPositions con Guión y Personajes", () => {
  const withData = (n: Node, data: Record<string, unknown>): Node => ({ ...n, data });

  it("una fila por escena (Escena → Imagen → Video) y el reparto arriba", () => {
    const nodes: Node[] = [
      node("lk", "linked", 900),
      node("sc", "script", 0, 400, 600),
      node("ps", "params-scene"),
    ];
    const edges: Edge[] = [];
    for (let i = 1; i <= 3; i++) {
      nodes.push(withData(node(`s${i}`, "scene", i * 50), { scriptNodeId: "sc", sceneIndex: i }), node(`d${i}`, "image", 2000 - i * 300), node(`v${i}`, "video", i * 700));
      edges.push(edge(i === 1 ? "sc" : `s${i - 1}`, `s${i}`), edge(`s${i}`, `d${i}`), edge(`d${i}`, `v${i}`), edge("ps", `s${i}`), edge("lk", `d${i}`));
      if (i > 1) edges.push(edge(`d${i - 1}`, `d${i}`)); // continuidad entre destinos
    }
    // Versión B de la escena 2, en su fila debajo de la 2.
    nodes.push(withData(node("s2b", "scene"), { scriptNodeId: "sc", sceneIndex: 2, variant: "B" }), node("d2b", "image"));
    edges.push(edge("s1", "s2b"), edge("s2b", "d2b"));

    const pos = autoLayoutPositions(nodes, edges);
    const y = (id: string) => pos.get(id)!.y;
    const x = (id: string) => pos.get(id)!.x;
    for (const i of [1, 2, 3]) {
      expect(y(`d${i}`)).toBe(y(`s${i}`));
      expect(y(`v${i}`)).toBe(y(`s${i}`));
      expect(x(`d${i}`)).toBeGreaterThan(x(`s${i}`));
      expect(x(`v${i}`)).toBeGreaterThan(x(`d${i}`));
      expect(x(`d${i}`)).toBe(x("d1"));
    }
    expect(y("s2")).toBeLessThan(y("s2b"));
    expect(y("s2b")).toBeLessThan(y("s3"));
    expect(y("d2b")).toBe(y("s2b"));
    expect(y("lk")).toBeLessThan(y("sc"));
    expect(y("sc")).toBeLessThan(y("s1"));
    expect(overlaps(nodes, pos)).toBe(0);
  });

  it("una columna por Personaje con sus etapas; el estilo común arriba", () => {
    const nodes: Node[] = [node("style", "static-text")];
    const edges: Edge[] = [];
    for (const c of ["a", "b"]) {
      const stages = [1, 2, 3].map((i) => ({ id: `${c}st${i}`, name: "", text: "", imageNodeId: `${c}${i}` }));
      nodes.push(withData(node(c, "character", c === "a" ? 0 : 500, 400, 500), { stages }), node(`${c}g`, "static-image-group"));
      edges.push(edge("style", c), edge(`${c}g`, c));
      for (const i of [1, 2, 3]) {
        // Las etapas quedaron desordenadas e intercaladas con el otro Personaje.
        nodes.push(node(`${c}${i}`, "image", (4 - i) * 700 + (c === "a" ? 300 : 0)));
        edges.push(edge(c, `${c}${i}`));
        if (i > 1) edges.push(edge(`${c}${i - 1}`, `${c}${i}`));
      }
    }
    const pos = autoLayoutPositions(nodes, edges);
    for (const c of ["a", "b"]) {
      const xs = new Set([1, 2, 3].map((i) => pos.get(`${c}${i}`)!.x));
      expect(xs.size).toBe(1);
      expect(pos.get(`${c}1`)!.y).toBeGreaterThan(pos.get(c)!.y);
      expect(pos.get(`${c}2`)!.y).toBeGreaterThan(pos.get(`${c}1`)!.y);
      expect(pos.get(`${c}g`)!.y).toBeLessThan(pos.get(c)!.y);
      expect(pos.get("style")!.y).toBeLessThan(pos.get(`${c}g`)!.y);
    }
    // Columnas separadas: todo lo de "a" a la izquierda de lo de "b".
    const right = (c: string) => Math.max(...["", "1", "2", "3", "g"].map((s) => pos.get(`${c}${s}`)!.x + 400));
    const left = (c: string) => Math.min(...["", "1", "2", "3", "g"].map((s) => pos.get(`${c}${s}`)!.x));
    expect(right("a")).toBeLessThanOrEqual(left("b"));
    expect(overlaps(nodes, pos)).toBe(0);
  });
});

