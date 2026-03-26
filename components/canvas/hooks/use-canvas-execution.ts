"use client";

import { useCallback, useRef, useState } from "react";
import type { Node } from "@xyflow/react";
import type { CanvasNodeData, CanvasNodeStatus, ExecutionProgress, ImageNodeData, TextNodeData, VideoNodeData, StaticTextNodeData, StaticImageNodeData, StaticImageGroupNodeData } from "../lib/canvas-types";
import { HANDLE_IDS } from "../lib/canvas-types";
import { topologicalSort, getDirectInputs } from "../lib/topological-sort";
import type { CanvasEdge } from "../lib/canvas-types";
import type { CanvasGenerationConfig } from "../canvas-workspace";

type SetNodesFn = (updater: (nds: Node[]) => Node[]) => void;

/**
 * Convert a CDN/GCS URL to a base64 data URL for passing to Gemini API.
 */
async function urlToDataUrl(url: string): Promise<string> {
  const res = await fetch(url);
  const blob = await res.blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

interface UseCanvasExecutionOptions {
  conversationId: number;
  nodes: Node[];
  edges: CanvasEdge[];
  setNodes: SetNodesFn;
  generationConfig: CanvasGenerationConfig[];
}

/**
 * Check if an image model is "nano banana" (Gemini native image generation)
 * which uses the stream/ endpoint instead of imagen/
 */
function isNanoBananaModel(modelId: number | undefined, generationConfig: CanvasGenerationConfig[]): boolean {
  if (!modelId) {
    // Check default image model
    const imgConfig = generationConfig.find((c) => c.generation_type === "image");
    const defaultModel = imgConfig?.models?.find((m) => m.is_default) || imgConfig?.models?.[0];
    return defaultModel?.model_id?.includes("image-preview") || defaultModel?.model_id?.includes("flash-image") || false;
  }
  for (const config of generationConfig) {
    const model = config.models?.find((m) => m.id === modelId);
    if (model) {
      return model.model_id?.includes("image-preview") || model.model_id?.includes("flash-image") || false;
    }
  }
  return false;
}

function updateNodeStatus(
  setNodes: SetNodesFn,
  nodeId: string,
  updates: Partial<CanvasNodeData>
) {
  setNodes((nds) =>
    nds.map((n) =>
      n.id === nodeId ? { ...n, data: { ...n.data, ...updates } } : n
    )
  );
}

interface ResolvedInputs {
  promptContext: string;
  referenceImageUrl: string | null;
  firstFrameUrl: string | null;
  lastFrameUrl: string | null;
  referenceImageUrls: string[];
  mediaUrls: { url: string; type: "image" | "video" }[];
  paramsOverride: Record<string, unknown> | null;
}

/**
 * Resolve inputs from connected upstream nodes.
 */
function resolveNodeInputs(
  nodeId: string,
  nodes: Node[],
  edges: CanvasEdge[]
): ResolvedInputs {
  const inputs = getDirectInputs(nodeId, edges);
  let promptContext = "";
  let referenceImageUrl: string | null = null;
  let firstFrameUrl: string | null = null;
  let lastFrameUrl: string | null = null;
  const referenceImageUrls: string[] = [];
  const mediaUrls: { url: string; type: "image" | "video" }[] = [];
  let paramsOverride: Record<string, unknown> | null = null;

  for (const input of inputs) {
    const sourceNode = nodes.find((n) => n.id === input.sourceNodeId);
    if (!sourceNode) continue;
    const sourceData = sourceNode.data as CanvasNodeData;
    if (sourceData.status !== "completed") continue;

    // Helper: get text content from any text-producing node
    const getTextOutput = (): string | null => {
      if (sourceNode.type === "static-text") return (sourceData as StaticTextNodeData).content || null;
      if (sourceNode.type === "text") return (sourceData as TextNodeData).outputText || null;
      return null;
    };

    // Helper: get image URL from any image-producing node
    const getImageOutput = (): string | null => {
      if (sourceNode.type === "static-image") return (sourceData as StaticImageNodeData).imageUrl || null;
      if (sourceNode.type === "static-image-group") {
        const group = sourceData as StaticImageGroupNodeData;
        return group.images?.[0]?.url || null;
      }
      if (sourceNode.type === "image") return (sourceData as ImageNodeData).outputUrl || null;
      return null;
    };

    // Helper: get all image URLs from image-group nodes
    const getAllImageOutputs = (): string[] => {
      if (sourceNode.type === "static-image-group") {
        return ((sourceData as StaticImageGroupNodeData).images || []).map(i => i.url).filter(Boolean);
      }
      const single = getImageOutput();
      return single ? [single] : [];
    };

    if (input.targetHandle === HANDLE_IDS.INPUT_PROMPT) {
      const text = getTextOutput();
      if (text) {
        promptContext += (promptContext ? "\n\n" : "") + text;
      }
    }

    if (input.targetHandle === HANDLE_IDS.INPUT_FIRST_FRAME) {
      const url = getImageOutput();
      if (url) firstFrameUrl = url;
    }

    if (input.targetHandle === HANDLE_IDS.INPUT_LAST_FRAME) {
      const url = getImageOutput();
      if (url) lastFrameUrl = url;
    }

    if (input.targetHandle === HANDLE_IDS.INPUT_REFERENCE) {
      const urls = getAllImageOutputs();
      if (urls.length > 0) {
        referenceImageUrl = urls[0];
        referenceImageUrls.push(...urls);
      }
    }

    if (input.targetHandle === HANDLE_IDS.INPUT_MEDIA) {
      // Image or video as media input for text models
      const imgUrl = getImageOutput();
      if (imgUrl) {
        mediaUrls.push({ url: imgUrl, type: "image" });
      }
      if (sourceNode.type === "video") {
        const vidData = sourceData as VideoNodeData;
        if (vidData.outputUrl) {
          mediaUrls.push({ url: vidData.outputUrl, type: "video" });
        }
      }
    }

    if (input.targetHandle === HANDLE_IDS.INPUT_PARAMS) {
      // Extract params data (strip base fields)
      const { label: _l, status: _s, errorMessage: _e, outputMessageId: _o, modelName: _mn, locked: _lk, type: _t, ...params } = sourceData as Record<string, unknown>;
      paramsOverride = params;
    }
  }

  return { promptContext, referenceImageUrl, firstFrameUrl, lastFrameUrl, referenceImageUrls, mediaUrls, paramsOverride };
}

/**
 * Check if all upstream dependencies are completed.
 */
function areUpstreamReady(
  nodeId: string,
  nodes: Node[],
  edges: CanvasEdge[]
): boolean {
  const inputs = getDirectInputs(nodeId, edges);
  for (const input of inputs) {
    const sourceNode = nodes.find((n) => n.id === input.sourceNodeId);
    if (!sourceNode || (sourceNode.data as CanvasNodeData).status !== "completed") {
      return false;
    }
  }
  return true;
}

export function useCanvasExecution({
  conversationId,
  nodes,
  edges,
  setNodes,
  generationConfig,
}: UseCanvasExecutionOptions) {
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionProgress, setExecutionProgress] = useState<ExecutionProgress | null>(null);
  const abortRef = useRef(false);
  const currentRunIdRef = useRef<string | null>(null);

  /**
   * Execute a single node. Uses `liveNodes` for resolving inputs —
   * this allows executeAll to pass a mutable snapshot that stays
   * up-to-date across the cascade without waiting for React re-renders.
   */
  const runNode = useCallback(
    async (nodeId: string, liveNodes: Node[], skipUpstreamCheck = false) => {
      const node = liveNodes.find((n) => n.id === nodeId);
      if (!node) return;

      const nodeData = node.data as CanvasNodeData;

      // Check upstream readiness (skip when called from executeAll — it already guarantees order)
      if (!skipUpstreamCheck && !areUpstreamReady(nodeId, liveNodes, edges)) {
        updateNodeStatus(setNodes, nodeId, {
          status: "error",
          errorMessage: "Dependencias no completadas",
        } as Partial<CanvasNodeData>);
        return;
      }

      // Resolve inputs from the live snapshot
      const { promptContext, referenceImageUrl, firstFrameUrl, lastFrameUrl, referenceImageUrls, mediaUrls, paramsOverride } = resolveNodeInputs(nodeId, liveNodes, edges);

      // Set generating
      updateNodeStatus(setNodes, nodeId, { status: "generating", errorMessage: undefined } as Partial<CanvasNodeData>);
      const startTime = Date.now();

      try {
        let result: { outputUrl?: string; outputText?: string; messageId?: number } = {};

        // Apply params override if connected
        const effectiveData = paramsOverride
          ? { ...nodeData, ...paramsOverride } as CanvasNodeData
          : nodeData;

        switch (node.type) {
          case "text": {
            const textData = effectiveData as TextNodeData;
            const fullPrompt = promptContext
              ? `${promptContext}\n\n${textData.prompt}`
              : textData.prompt;

            result = await executeTextNode(conversationId, fullPrompt, textData, nodeId, liveNodes, edges, mediaUrls);
            break;
          }
          case "image": {
            const imgData = effectiveData as ImageNodeData;
            const fullPrompt = promptContext
              ? `${promptContext}\n\n${imgData.prompt}`
              : imgData.prompt;

            if (isNanoBananaModel(imgData.modelId, generationConfig)) {
              result = await executeNanoBananaNode(conversationId, fullPrompt, imgData, referenceImageUrls);
            } else {
              result = await executeImageNode(conversationId, fullPrompt, imgData, referenceImageUrls);
            }
            break;
          }
          case "video": {
            const vidData = effectiveData as VideoNodeData;
            const fullPrompt = promptContext
              ? `${promptContext}\n\n${vidData.prompt}`
              : vidData.prompt;

            result = await executeVideoNode(conversationId, fullPrompt, vidData, { firstFrameUrl, lastFrameUrl, referenceImageUrls });
            break;
          }
        }

        const completedData: Partial<CanvasNodeData> = {
          status: "completed",
          outputUrl: result.outputUrl,
          outputText: result.outputText,
          outputMessageId: result.messageId,
          errorMessage: undefined,
        };

        // Update React state
        updateNodeStatus(setNodes, nodeId, completedData);

        // Also update the live snapshot so downstream nodes see the result
        const liveNode = liveNodes.find((n) => n.id === nodeId);
        if (liveNode) {
          (liveNode as Node).data = { ...liveNode.data, ...completedData };
        }

        // Persist to DB
        await fetch(`/api/conversations/${conversationId}/canvas/nodes`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId,
            updates: {
              status: "completed",
              output_url: result.outputUrl || null,
              output_text: result.outputText || null,
              output_message_id: result.messageId || null,
            },
          }),
        });

        // Record execution history
        const durationMs = Date.now() - startTime;
        fetch(`/api/conversations/${conversationId}/canvas/executions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            node_id: nodeId,
            node_type: node.type,
            run_id: currentRunIdRef.current,
            model_name: (nodeData as Record<string, unknown>).modelName || null,
            status: "completed",
            duration_ms: durationMs,
            output_message_id: result.messageId || null,
          }),
        }).catch(() => {});
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Error desconocido";
        const durationMs = Date.now() - startTime;

        updateNodeStatus(setNodes, nodeId, {
          status: "error",
          errorMessage: errorMsg,
        } as Partial<CanvasNodeData>);

        // Update live snapshot with error
        const liveNode = liveNodes.find((n) => n.id === nodeId);
        if (liveNode) {
          (liveNode as Node).data = { ...liveNode.data, status: "error", errorMessage: errorMsg };
        }

        await fetch(`/api/conversations/${conversationId}/canvas/nodes`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            nodeId,
            updates: { status: "error", error_message: errorMsg },
          }),
        }).catch(() => {});

        // Record failed execution
        fetch(`/api/conversations/${conversationId}/canvas/executions`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            node_id: nodeId,
            node_type: node.type,
            run_id: currentRunIdRef.current,
            model_name: (nodeData as Record<string, unknown>).modelName || null,
            status: "error",
            duration_ms: durationMs,
            error_message: errorMsg,
          }),
        }).catch(() => {});
      }
    },
    [conversationId, edges, setNodes]
  );

  /**
   * Execute a single node (public API — uses current React state).
   */
  const executeNode = useCallback(
    async (nodeId: string) => {
      currentRunIdRef.current = null; // Single node execution, no run group
      const snapshot = nodes.map((n) => ({ ...n, data: { ...n.data } }));
      await runNode(nodeId, snapshot, false);
    },
    [nodes, runNode]
  );

  /**
   * Execute all nodes in topological order using a shared mutable snapshot.
   */
  const executeAll = useCallback(async () => {
    const levels = topologicalSort(nodes, edges);
    if (!levels) {
      alert("Se detectó un ciclo en el grafo. Elimina conexiones circulares.");
      return;
    }

    setIsExecuting(true);
    abortRef.current = false;
    currentRunIdRef.current = `run-${Date.now()}`;
    let completed = 0;

    // Create a mutable snapshot
    const liveNodes = nodes.map((n) => ({ ...n, data: { ...n.data } }));

    // Reset all AI nodes to idle before running (clear previous outputs)
    const aiNodeTypes = new Set(["text", "image", "video"]);
    const resetData: Partial<CanvasNodeData> = {
      status: "idle",
      outputUrl: undefined,
      outputText: undefined,
      outputMessageId: undefined,
      errorMessage: undefined,
    };
    for (const liveNode of liveNodes) {
      if (aiNodeTypes.has(liveNode.type!)) {
        liveNode.data = { ...liveNode.data, ...resetData };
        updateNodeStatus(setNodes, liveNode.id, resetData);
      }
    }

    const total = liveNodes.filter((n) => aiNodeTypes.has(n.type!)).length;

    try {
      for (const level of levels) {
        if (abortRef.current) break;

        for (const nodeId of level) {
          if (abortRef.current) break;

          const liveNode = liveNodes.find((n) => n.id === nodeId);
          if (!liveNode) continue;

          // Skip non-AI nodes (static nodes don't need execution)
          if (!aiNodeTypes.has(liveNode.type!)) continue;

          setExecutionProgress({
            nodeId,
            status: "generating",
            message: `Ejecutando ${completed + 1}/${total}...`,
          });

          await runNode(nodeId, liveNodes, true);
          completed++;
        }
      }
    } finally {
      currentRunIdRef.current = null;
      setIsExecuting(false);
      setExecutionProgress(null);
    }
  }, [nodes, edges, runNode]);

  return { executeNode, executeAll, isExecuting, executionProgress };
}

// --- Individual execution functions ---

/**
 * Analyze downstream nodes to determine what the text output will be used for.
 */
function getDownstreamContext(
  nodeId: string,
  nodes: Node[],
  edges: CanvasEdge[]
): { types: string[]; prompts: string[] } {
  const types: string[] = [];
  const prompts: string[] = [];

  for (const edge of edges) {
    if (edge.source !== nodeId) continue;
    const targetNode = nodes.find((n) => n.id === edge.target);
    if (!targetNode) continue;

    const targetType = targetNode.type as string;
    if (!types.includes(targetType)) types.push(targetType);

    const targetData = targetNode.data as Record<string, unknown>;
    const targetPrompt = targetData.prompt as string | undefined;
    if (targetPrompt) {
      prompts.push(`[Nodo ${targetType}]: "${targetPrompt}"`);
    }
  }

  return { types, prompts };
}

function buildPromptModeInstruction(downstream: { types: string[]; prompts: string[] }): string {
  const typeLabels: Record<string, string> = {
    image: "generación de imagen",
    video: "generación de video",
    text: "otro nodo de texto",
  };

  let targetDesc: string;
  if (downstream.types.length === 0) {
    targetDesc = "generación de contenido visual con IA";
  } else {
    targetDesc = downstream.types.map((t) => typeLabels[t] || t).join(" y ");
  }

  let instruction = `Eres un generador de prompts. Tu respuesta será usada directamente como prompt para ${targetDesc}.

RESPONDE SOLO CON EL PROMPT. NADA MÁS.

Prohibido:
- Introducciones ("Aquí tienes", "Te sugiero", "Claro")
- Opciones o alternativas
- Explicaciones o comentarios
- Markdown, comillas, numeración
- Cualquier texto que no sea el prompt en sí

Tu respuesta completa se copia tal cual al siguiente nodo. Si agregas texto extra, el resultado se corrompe.
Responde en español salvo instrucción contraria.`;

  if (downstream.prompts.length > 0) {
    instruction += `\n\nContexto de los nodos conectados downstream (usa esto para enfocar tu prompt):\n${downstream.prompts.join("\n")}`;
  }

  return instruction;
}

async function executeTextNode(
  conversationId: number,
  prompt: string,
  config: TextNodeData,
  nodeId: string,
  allNodes: Node[],
  allEdges: CanvasEdge[],
  mediaUrls: { url: string; type: "image" | "video" }[] = []
): Promise<{ outputText?: string; messageId?: number }> {
  // Build system instruction override
  const systemParts: string[] = [];
  if (config.outputAsPrompt) {
    const downstream = getDownstreamContext(nodeId, allNodes, allEdges);
    systemParts.push(buildPromptModeInstruction(downstream));
  }
  if (config.systemInstruction) {
    systemParts.push(config.systemInstruction);
  }

  const body: Record<string, unknown> = {
    content: prompt,
    generation_type_override: "text",
    selected_model_id: config.modelId,
    no_context: true,
    thinking_level: config.thinkingLevel || "none",
  };

  if (systemParts.length > 0) {
    body.system_instruction_override = systemParts.join("\n\n");
  }

  // Attach media files (images/videos) from connected nodes
  if (mediaUrls.length > 0) {
    const files = await Promise.all(
      mediaUrls.map(async (media, i) => {
        const dataUrl = await urlToDataUrl(media.url);
        return {
          dataUrl,
          mimeType: media.type === "video" ? "video/mp4" : "image/png",
          name: `media-${i}.${media.type === "video" ? "mp4" : "png"}`,
          type: "image" as const, // stream endpoint treats all media as "image" type files
        };
      })
    );
    body.files = files;
  }

  const res = await fetch(`/api/conversations/${conversationId}/messages/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = res.statusText;
    try { const err = await res.json(); detail = err.error || JSON.stringify(err); } catch {}
    throw new Error(`${res.status}: ${detail}`);
  }

  // Parse SSE stream
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let fullText = "";
  let messageId: number | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === "chunk") {
            fullText += data.text || "";
          } else if (data.type === "complete") {
            messageId = data.messageId;
            if (data.fullText) fullText = data.fullText;
          } else if (data.type === "error") {
            throw new Error(data.message || "Error en generación");
          } else if (data.type === "user_message") {
            // User message created, continue
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  }

  return { outputText: fullText, messageId };
}

async function executeNanoBananaNode(
  conversationId: number,
  prompt: string,
  config: ImageNodeData,
  referenceImageUrls: string[]
): Promise<{ outputUrl?: string; messageId?: number }> {
  const body: Record<string, unknown> = {
    content: prompt,
    generation_type_override: "image",
    selected_model_id: config.modelId,
    no_context: true,
    imageSettings: {
      aspectRatio: config.aspectRatio,
      size: config.resolution,
      numberOfImages: 1,
    },
  };

  // Pass all reference images as file attachments — convert URLs to base64
  if (referenceImageUrls.length > 0) {
    const files = await Promise.all(
      referenceImageUrls.map(async (url, i) => ({
        dataUrl: await urlToDataUrl(url),
        mimeType: "image/png",
        name: `reference-${i}.png`,
        type: "image" as const,
      }))
    );
    body.files = files;
  }

  const res = await fetch(`/api/conversations/${conversationId}/messages/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = res.statusText;
    try { const err = await res.json(); detail = err.error || JSON.stringify(err); } catch {}
    throw new Error(`NanoBanana ${res.status}: ${detail}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let outputUrl: string | undefined;
  let messageId: number | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === "image") {
            outputUrl = data.imageUrl || data.url;
            messageId = data.messageId;
          } else if (data.type === "complete") {
            messageId = messageId || data.messageId;
          } else if (data.type === "error") {
            throw new Error(data.message || "Error en generación nano banana");
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  }

  if (!outputUrl) throw new Error("No se recibió imagen generada");
  return { outputUrl, messageId };
}

async function executeImageNode(
  conversationId: number,
  prompt: string,
  config: ImageNodeData,
  referenceImageUrls: string[]
): Promise<{ outputUrl?: string; messageId?: number }> {
  const body: Record<string, unknown> = {
    content: prompt,
    generation_type_override: "image",
    selected_model_id: config.modelId,
    imageSettings: {
      aspectRatio: config.aspectRatio,
      resolution: config.resolution,
      negativePrompt: config.negativePrompt,
      numberOfImages: 1,
      seed: config.seed,
    },
  };

  if (referenceImageUrls.length > 0) {
    body.files = referenceImageUrls.map((url, i) => ({
      url,
      type: "image",
      mimeType: "image/png",
      name: `reference-${i}.png`,
    }));
  }

  const res = await fetch(`/api/conversations/${conversationId}/messages/imagen`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = res.statusText;
    try { const err = await res.json(); detail = err.error || JSON.stringify(err); } catch {}
    throw new Error(`Imagen ${res.status}: ${detail}`);
  }

  // Parse SSE stream
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let outputUrl: string | undefined;
  let messageId: number | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === "image") {
            outputUrl = data.imageUrl || data.url;
            messageId = data.messageId;
          } else if (data.type === "complete") {
            messageId = messageId || data.messageId;
          } else if (data.type === "error") {
            throw new Error(data.message || "Error en generación de imagen");
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  }

  if (!outputUrl) throw new Error("No se recibió imagen generada");
  return { outputUrl, messageId };
}

async function executeVideoNode(
  conversationId: number,
  prompt: string,
  config: VideoNodeData,
  imageInputs: { firstFrameUrl: string | null; lastFrameUrl: string | null; referenceImageUrls: string[] }
): Promise<{ outputUrl?: string; messageId?: number }> {
  const body: Record<string, unknown> = {
    content: prompt,
    selected_model_id: config.modelId,
    videoSettings: {
      duration: config.duration,
      aspectRatio: config.aspectRatio,
      resolution: config.resolution,
      audioEnabled: config.audioEnabled,
      negativePrompt: config.negativePrompt,
    },
  };

  // Pass image inputs using the videoInputs structure the endpoint expects
  const videoInputs: Record<string, unknown> = {};
  if (imageInputs.firstFrameUrl) {
    videoInputs.firstFrame = imageInputs.firstFrameUrl;
  }
  if (imageInputs.lastFrameUrl) {
    videoInputs.lastFrame = imageInputs.lastFrameUrl;
  }
  if (imageInputs.referenceImageUrls.length > 0) {
    videoInputs.referenceImages = imageInputs.referenceImageUrls.map((url) => ({
      image: url,
      type: "STYLE",
    }));
  }
  if (Object.keys(videoInputs).length > 0) {
    body.videoInputs = videoInputs;
  }

  const res = await fetch(`/api/conversations/${conversationId}/messages/video`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = res.statusText;
    try { const err = await res.json(); detail = err.error || JSON.stringify(err); } catch {}
    throw new Error(`${res.status}: ${detail}`);
  }

  // Parse SSE stream - video generation can be long
  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let outputUrl: string | undefined;
  let messageId: number | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value, { stream: true });
    const lines = chunk.split("\n");

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === "video") {
            outputUrl = data.videoUrl || data.url;
            messageId = data.messageId;
          } else if (data.type === "complete") {
            outputUrl = outputUrl || data.videoUrl || data.url;
            messageId = messageId || data.messageId;
          } else if (data.type === "error") {
            throw new Error(data.message || "Error en generación de video");
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  }

  if (!outputUrl) throw new Error("No se recibió video generado");
  return { outputUrl, messageId };
}
