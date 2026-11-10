import { describe, it, expect } from "vitest";
import { buildAssistPlan, dropInventedStageText, pickResultImages, planIsEmpty, type AssistModels } from "../assist-plan";
import { placeNewNodes } from "@/components/canvas/lib/ai-assist-apply";
import { HANDLE_IDS } from "@/components/canvas/lib/canvas-types";

const models: AssistModels = {
  text: [{ id: 244, model_id: "gemini-3.8-flash", display_name: "Gemini 3.8 Flash", api_backend: "gemini", is_default: true }],
  image: [{ id: 1, model_id: "gemini-3-pro-image-preview", display_name: "Nano Banana Pro", api_backend: null, is_default: true }],
  video: [
    { id: 245, model_id: "gemini-omni-1.2-flash", display_name: "Gemini Omni 1.2 Flash", api_backend: "omni", is_default: true },
    { id: 13, model_id: "veo-3.1-generate-001", display_name: "VEO 3.1 HQ", api_backend: "gemini", is_default: false },
  ],
};

const empty = { nodes: [], edges: [] };

describe("buildAssistPlan", () => {
  it("crea nodos con defaults y los conecta con los handles correctos", () => {
    const plan = buildAssistPlan(
      {
        reply: "Listo",
        relayout: "none",
        ops: [
          { op: "add_node", ref: "t", node_type: "text", label: "Idea", prompt: "Escribe un prompt", output_as_prompt: true },
          { op: "add_node", ref: "i", node_type: "image", prompt: "Un café", aspect_ratio: "9:16" },
          { op: "add_node", ref: "v", node_type: "video", prompt: "Cámara lenta" },
          { op: "connect", from: "t", to: "i" },
          { op: "connect", from: "i", to: "v", input: "first_frame" },
        ],
      },
      empty,
      models,
      { idPrefix: "x" },
    );
    expect(plan.addNodes.map((n) => n.id)).toEqual(["node-x-1", "node-x-2", "node-x-3"]);
    expect(plan.addNodes[0].data).toMatchObject({ type: "text", label: "Idea", prompt: "Escribe un prompt", outputAsPrompt: true, status: "idle" });
    expect(plan.addNodes[1].data).toMatchObject({ aspectRatio: "9:16", resolution: "1K" });
    expect(plan.addEdges).toEqual([
      { id: "e-x-1", source: "node-x-1", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, target: "node-x-2", targetHandle: HANDLE_IDS.INPUT_PROMPT },
      { id: "e-x-2", source: "node-x-2", sourceHandle: HANDLE_IDS.OUTPUT_IMAGE, target: "node-x-3", targetHandle: HANDLE_IDS.INPUT_FIRST_FRAME },
    ]);
    expect(plan.warnings).toEqual([]);
  });

  it("ajusta el video a las capacidades del modelo predeterminado (Omni: 16:9/9:16)", () => {
    const plan = buildAssistPlan(
      { ops: [{ op: "add_node", ref: "v", node_type: "video", prompt: "x", aspect_ratio: "1:1" }] },
      empty,
      models,
    );
    expect(plan.addNodes[0].data.aspectRatio).not.toBe("1:1");
    expect(plan.warnings.join(" ")).toMatch(/no admite 1:1/);
  });

  it("rechaza conexiones inválidas, ciclos y entradas ocupadas", () => {
    const plan = buildAssistPlan(
      {
        ops: [
          { op: "add_node", ref: "v", node_type: "video" },
          { op: "add_node", ref: "i", node_type: "image" },
          { op: "add_node", ref: "p1", node_type: "params-image" },
          { op: "add_node", ref: "p2", node_type: "params-image" },
          { op: "connect", from: "v", to: "i" }, // video → image no existe
          { op: "connect", from: "p1", to: "i" },
          { op: "connect", from: "p2", to: "i" }, // un params por nodo
        ],
      },
      empty,
      models,
    );
    expect(plan.addEdges).toHaveLength(1);
    expect(plan.warnings).toHaveLength(2);
  });

  it("detecta ciclos entre nodos de texto", () => {
    const plan = buildAssistPlan(
      {
        ops: [
          { op: "add_node", ref: "a", node_type: "text" },
          { op: "add_node", ref: "b", node_type: "text" },
          { op: "connect", from: "a", to: "b" },
          { op: "connect", from: "b", to: "a" },
        ],
      },
      empty,
      models,
    );
    expect(plan.addEdges).toHaveLength(1);
    expect(plan.warnings[0]).toMatch(/ciclo/);
  });

  it("edita nodos existentes sin tocar los bloqueados ni las escenas", () => {
    const snapshot = {
      nodes: [
        { id: "node-1", type: "image", label: "Foto" },
        { id: "node-2", type: "image", label: "Fija", locked: true },
        { id: "node-3", type: "scene", label: "Escena 1" },
      ],
      edges: [],
    };
    const plan = buildAssistPlan(
      {
        ops: [
          { op: "update_node", node: "node-1", prompt: "nuevo", aspect_ratio: "1:1" },
          { op: "update_node", node: "node-2", prompt: "x" },
          { op: "update_node", node: "node-3", prompt: "x" },
          { op: "remove_node", node: "node-2" },
        ],
      },
      snapshot,
      models,
    );
    expect(plan.updates).toEqual([{ id: "node-1", patch: { prompt: "nuevo", aspectRatio: "1:1" } }]);
    expect(plan.removeNodeIds).toEqual([]);
    expect(plan.warnings).toHaveLength(3);
  });

  it("no crea escenas y respeta modelos del proyecto", () => {
    const plan = buildAssistPlan(
      {
        ops: [
          { op: "add_node", ref: "s", node_type: "scene" },
          { op: "add_node", ref: "v", node_type: "video", model_id: 13, duration: 8 },
          { op: "add_node", ref: "t", node_type: "text", model_id: 999 },
        ],
      },
      empty,
      models,
    );
    expect(plan.addNodes.map((n) => n.type)).toEqual(["video", "text"]);
    expect(plan.addNodes[0].data).toMatchObject({ modelId: 13, modelName: "VEO 3.1 HQ", duration: 8 });
    expect(plan.addNodes[1].data.modelId).toBe(244);
  });

  it("desconecta usando el id base del handle (gemelo superior incluido)", () => {
    const snapshot = {
      nodes: [
        { id: "a", type: "text" },
        { id: "b", type: "image" },
      ],
      edges: [{ id: "e1", source: "a", target: "b", sourceHandle: HANDLE_IDS.OUTPUT_TEXT, targetHandle: `${HANDLE_IDS.INPUT_PROMPT}__top` }],
    };
    const plan = buildAssistPlan({ ops: [{ op: "disconnect", from: "a", to: "b", input: "prompt" }] }, snapshot, models);
    expect(plan.removeEdgeIds).toEqual(["e1"]);
    const again = buildAssistPlan({ ops: [{ op: "connect", from: "a", to: "b" }] }, snapshot, models);
    expect(planIsEmpty(again)).toBe(true);
  });

  it("crear y borrar en el mismo pedido se cancela", () => {
    const plan = buildAssistPlan(
      {
        ops: [
          { op: "add_node", ref: "a", node_type: "note" },
          { op: "remove_node", node: "a" },
        ],
      },
      empty,
      models,
    );
    expect(planIsEmpty(plan)).toBe(true);
  });
});

describe("buildAssistPlan · Personaje", () => {
  const galSnap = { id: "gal", type: "static-image-group", label: "Fotos", images: ["https://x/1.png", "https://x/2.png"] };

  it("crea un Personaje con ADN en el nodo, estilo conectado y fotos elegidas por número", () => {
    const plan = buildAssistPlan(
      {
        ops: [
          { op: "add_node", ref: "sty", node_type: "static-text", label: "Estilo", prompt: "acuarela" },
          {
            op: "add_node", ref: "c", node_type: "character", label: "Ana", dna: "ojos verdes", generate_stages: true,
            stages: [
              { name: "5 años", text: "niña" },
              { name: "35 años", text: "adulta", photos: [{ gallery: "gal", number: 2 }, { gallery: "gal", number: 9 }] },
              { name: "", text: "" },
            ],
          },
          { op: "connect", from: "sty", to: "c", input: "character_style" },
          { op: "connect", from: "sty", to: "c", input: "character_style" },
        ],
      },
      { nodes: [galSnap], edges: [] },
      models,
      { idPrefix: "x" },
    );
    const c = plan.addNodes.find((n) => n.type === "character")!;
    expect(c.data.dna).toBe("ojos verdes");
    expect(c.data.stages).toEqual([
      { id: "st-x-1", name: "5 años", text: "niña" },
      { id: "st-x-2", name: "35 años", text: "adulta", referenceImages: [{ nodeId: "gal", url: "https://x/2.png" }] },
    ]);
    // La galería se conecta sola al Personaje; el estilo, una sola vez.
    expect(plan.addEdges.map((e) => [e.source, e.targetHandle])).toEqual([
      ["gal", HANDLE_IDS.INPUT_CHARACTER_GALLERY],
      [plan.addNodes[0].id, HANDLE_IDS.INPUT_CHARACTER_STYLE],
    ]);
    expect(plan.warnings.join(" ")).toMatch(/foto número 9/);
    expect(plan.materializeCharacterIds).toEqual([c.id]);
  });

  it("al editar etapas conserva imagen y fotos de las que siguen", () => {
    const snapshot = {
      nodes: [{
        id: "char", type: "character",
        stages: [
          { id: "a", name: "5 años", text: "niña", imageNodeId: "img-a", referenceImages: [{ nodeId: "gal", url: "https://x/1.png" }] },
          { id: "b", name: "35 años", text: "adulta", imageNodeId: "img-b" },
        ],
      }, galSnap],
      edges: [],
    };
    const plan = buildAssistPlan(
      { ops: [{ op: "update_node", node: "char", stages: [
        { name: "5 años", text: "niña con lentes" },
        { name: "20 años", text: "joven" },
        { name: "35 años", text: "adulta" },
      ] }] },
      snapshot,
      models,
      { idPrefix: "y" },
    );
    const st = plan.updates[0].patch.stages as { id: string; imageNodeId?: string; referenceImages?: unknown[]; text: string }[];
    expect(st[0]).toMatchObject({ id: "a", imageNodeId: "img-a", referenceImages: [{ nodeId: "gal", url: "https://x/1.png" }], text: "niña con lentes" });
    expect(st[1].imageNodeId).toBeUndefined();
    expect(st[2]).toMatchObject({ id: "b", imageNodeId: "img-b" });
    expect(plan.materializeCharacterIds).toEqual([]);
  });

  it("rechaza fotos de algo que no es galería ni imagen", () => {
    const plan = buildAssistPlan(
      { ops: [
        { op: "add_node", ref: "t", node_type: "static-text" },
        { op: "add_node", ref: "c", node_type: "character", stages: [{ name: "x", text: "y", photos: [{ gallery: "t", number: 1 }] }] },
      ] },
      empty,
      models,
    );
    expect(plan.addNodes[1].data.stages).toEqual([{ id: expect.any(String), name: "x", text: "y", referenceImages: [] }]);
    expect(plan.warnings[0]).toMatch(/no es una galería/);
  });
});

describe("placeNewNodes", () => {
  it("pone el bloque nuevo a la derecha de lo existente, alineado con su nodo conectado", () => {
    const existing = [
      { id: "a", type: "text", position: { x: 0, y: 0 }, data: {}, width: 300, height: 200 },
      { id: "b", type: "text", position: { x: 0, y: 500 }, data: {}, width: 300, height: 200 },
    ];
    const pos = placeNewNodes(
      existing,
      [
        { id: "n1", type: "image", data: {} },
        { id: "n2", type: "video", data: {} },
      ],
      [
        { source: "b", target: "n1" },
        { source: "n1", target: "n2" },
      ],
      { x: 0, y: 0 },
    );
    expect(pos.get("n1")).toEqual({ x: 460, y: 500 });
    expect(pos.get("n2")!.x).toBe(460);
    expect(pos.get("n2")!.y).toBeGreaterThan(500);
  });

  it("con el canvas vacío parte en el punto de respaldo", () => {
    const pos = placeNewNodes([], [{ id: "n1", type: "note", data: {} }], [], { x: 50, y: 70 });
    expect(pos.get("n1")).toEqual({ x: 50, y: 70 });
  });
});


describe("Personaje · edición, textos inventados y resultados", () => {
  const charSnap = {
    id: "char", type: "character", label: "Ana",
    stages: [
      { id: "st-1", name: "Niña", text: "con mochila roja", imageNodeId: "img-1" },
      { id: "st-2", name: "Adulta", text: "con lentes", imageNodeId: "img-2" },
    ],
  };
  const snapshot = {
    nodes: [
      charSnap,
      { id: "img-1", type: "image", outputUrl: "https://storage.googleapis.com/b/1.png" },
      { id: "img-2", type: "image", outputUrl: "https://storage.googleapis.com/b/2.png" },
      { id: "img-x", type: "image", label: "Otra", outputUrl: "https://storage.googleapis.com/b/x.png" },
    ],
    edges: [],
  };

  it("renombrar una etapa por id conserva su imagen", () => {
    const plan = buildAssistPlan(
      { ops: [{ op: "update_node", node: "char", stages: [
        { id: "st-1", name: "Infancia", text: "con mochila roja" },
        { id: "st-2", name: "Adulta", text: "con lentes" },
      ] }] },
      snapshot,
      models,
    );
    const st = plan.updates[0].patch.stages as { id: string; name: string; imageNodeId?: string }[];
    expect(st[0]).toMatchObject({ id: "st-1", name: "Infancia", imageNodeId: "img-1" });
    expect(plan.updates[0].patch.chainStale).toBeUndefined();
  });

  it("vacía textos de etapa inventados si el pedido solo las nombra", () => {
    const plan = buildAssistPlan(
      { ops: [{ op: "add_node", ref: "c", node_type: "character", stages: [
        { name: "Ninfa", text: "pequeña, sin alas desarrolladas, cuerpo estilizado y traslúcido" },
        { name: "Adulta", text: "adulta" },
      ] }] },
      { nodes: [], edges: [] },
      models,
    );
    const instruction = "Crea un personaje mantis con 2 etapas: ninfa y adulta";
    expect(dropInventedStageText(plan, instruction, { nodes: [] })).toBe(1);
    expect((plan.addNodes[0].data.stages as { text: string }[]).map((s) => s.text)).toEqual(["", "adulta"]);
  });

  it("respeta los textos pegados o pedidos explícitamente", () => {
    const pasted = buildAssistPlan(
      { ops: [{ op: "add_node", ref: "c", node_type: "character", stages: [{ name: "16", text: "Adolescente con pelo largo hasta los hombros y frenillos" }] }] },
      { nodes: [], edges: [] },
      models,
    );
    expect(dropInventedStageText(pasted, "A los 16: pelo largo hasta los hombros, polerón de banda, frenillos", { nodes: [] })).toBe(0);
    const asked = buildAssistPlan(
      { ops: [{ op: "add_node", ref: "c", node_type: "character", stages: [{ name: "Ninfa", text: "pequeña y traslúcida" }] }] },
      { nodes: [], edges: [] },
      models,
    );
    expect(dropInventedStageText(asked, "crea un personaje y describe cada etapa", { nodes: [] })).toBe(0);
  });

  it("elige qué resultados mostrarle al modelo", () => {
    // Personaje seleccionado: sus imágenes de etapa, con etapa en la leyenda.
    const sel = pickResultImages(snapshot, ["char"], "mejora el resultado");
    expect(sel.map((p) => p.nodeId)).toEqual(["img-1", "img-2"]);
    expect(sel[1].caption).toContain('etapa 2 "Adulta" (id=st-2)');
    // Imagen suelta seleccionada.
    expect(pickResultImages(snapshot, ["img-x"], "x").map((p) => p.nodeId)).toEqual(["img-x"]);
    // Sin selección: por nombre del Personaje solo si habla de resultados.
    expect(pickResultImages(snapshot, [], "cómo quedó Ana en la etapa adulta").map((p) => p.nodeId)).toEqual(["img-1", "img-2"]);
    expect(pickResultImages(snapshot, [], "agrega una etapa a Ana")).toEqual([]);
  });
});


describe("Personaje sin etapas", () => {
  it("avisa y no pide generar si el modelo no mandó etapas", () => {
    const plan = buildAssistPlan(
      { ops: [{ op: "add_node", ref: "c", node_type: "character", label: "Robot", dna: "robot amarillo", generate_stages: true }] },
      { nodes: [], edges: [] },
      models,
    );
    expect(plan.materializeCharacterIds).toEqual([]);
    expect(plan.warnings.join(" ")).toMatch(/quedó sin etapas/);
  });
});
