"use client";

import { useCallback, useRef, useState } from "react";
import type { Node } from "@xyflow/react";
import type { CanvasNodeData, CanvasNodeStatus, ExecutionProgress, ImageNodeData, TextNodeData, TextPracticanteNodeData, VideoNodeData, StaticTextNodeData, StaticImageNodeData, StaticImageGroupNodeData, OutputHistoryEntry, PracticanteFile, SceneNodeData, ParamsSceneNodeData } from "../lib/canvas-types";
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

/** Max history entries per node to prevent unbounded growth */
const MAX_HISTORY = 20;

/**
 * Append a new output to the node's history array.
 * outputHistory contains ALL outputs (including the latest).
 */
function appendToHistory(
  currentHistory: OutputHistoryEntry[] | undefined,
  entry: OutputHistoryEntry
): OutputHistoryEntry[] {
  return [...(currentHistory || []), entry].slice(-MAX_HISTORY);
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
      if (sourceNode.type === "text-practicante") return (sourceData as TextPracticanteNodeData).outputText || null;
      if (sourceNode.type === "scene") return (sourceData as SceneNodeData).text || null;
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
 * If the node receives input from a Scene on INPUT_PROMPT, build the full
 * script context (sent as systemInstruction to the destination model):
 *   - generalInfo of the script
 *   - literal text of all upstream scenes (chained via INPUT_SCRIPT_CHAIN)
 *   - Params Escena content (style/visual/technique) connected to the current Scene
 *   - the task instruction
 * The Scene's own text and the destination node's prompt remain in the
 * primary prompt — only narrative/style context lives here.
 * Returns null when there's no scene in the prompt path.
 */
function resolveScriptContext(
  nodeId: string,
  nodes: Node[],
  edges: CanvasEdge[]
): string | null {
  const inputs = getDirectInputs(nodeId, edges);
  const promptInput = inputs.find((i) => i.targetHandle === HANDLE_IDS.INPUT_PROMPT);
  if (!promptInput) return null;
  const sceneNode = nodes.find((n) => n.id === promptInput.sourceNodeId);
  if (!sceneNode || sceneNode.type !== "scene") return null;
  const sceneData = sceneNode.data as SceneNodeData;

  // Walk upstream through the chain to collect previous scenes (oldest first)
  const previousScenes: SceneNodeData[] = [];
  let cursor = sceneNode.id;
  const visited = new Set<string>([cursor]);
  while (true) {
    const upChain = edges.find(
      (e) => e.target === cursor && e.targetHandle === HANDLE_IDS.INPUT_SCRIPT_CHAIN
    );
    if (!upChain) break;
    if (visited.has(upChain.source)) break;
    visited.add(upChain.source);
    const prev = nodes.find((n) => n.id === upChain.source);
    if (!prev) break;
    if (prev.type !== "scene") break;
    previousScenes.unshift(prev.data as SceneNodeData);
    cursor = prev.id;
  }

  // Look up Params Escena connected to the current Scene
  let sceneParamsContent: string | null = null;
  const paramsEdge = edges.find(
    (e) => e.target === sceneNode.id && e.targetHandle === HANDLE_IDS.INPUT_SCENE_PARAMS
  );
  if (paramsEdge) {
    const paramsNode = nodes.find((n) => n.id === paramsEdge.source);
    if (paramsNode && paramsNode.type === "params-scene") {
      const c = (paramsNode.data as ParamsSceneNodeData).content?.trim();
      if (c && c.length > 0) sceneParamsContent = c;
    }
  }

  const parts: string[] = [];
  const generalInfo = sceneData.generalInfo;
  if (generalInfo) {
    const lines: string[] = ["[Información general del guion]"];
    if (generalInfo.synopsis) lines.push(`Sinopsis: ${generalInfo.synopsis}`);
    if (generalInfo.tone) lines.push(`Tono: ${generalInfo.tone}`);
    if (generalInfo.genre) lines.push(`Género: ${generalInfo.genre}`);
    if (generalInfo.visualStyle) lines.push(`Estilo visual: ${generalInfo.visualStyle}`);
    if (generalInfo.characters?.length) {
      lines.push("Personajes:");
      for (const c of generalInfo.characters) lines.push(`- ${c.name}: ${c.description}`);
    }
    if (generalInfo.settings?.length) {
      lines.push("Locaciones:");
      for (const s of generalInfo.settings) lines.push(`- ${s.name}: ${s.description}`);
    }
    parts.push(lines.join("\n"));
  }

  if (previousScenes.length > 0) {
    const lines: string[] = ["[Escenas anteriores (texto íntegro)]"];
    for (const s of previousScenes) {
      lines.push(`--- Escena ${s.sceneIndex} ---`);
      lines.push(s.text);
    }
    parts.push(lines.join("\n"));
  }

  if (sceneParamsContent) {
    parts.push(`[Estilo / Visual / Técnica]\n${sceneParamsContent}`);
  }

  // If we got nothing useful, don't inject empty context.
  if (parts.length === 0) return null;

  parts.push(
    `[Tu tarea]\nVas a generar contenido para la Escena ${sceneData.sceneIndex} de ${sceneData.totalScenes}. El prompt que recibes es el texto literal de esa escena (más el prompt local del nodo si lo hay). Aplica la información general, las escenas anteriores y las directrices de estilo como contexto — no las repitas en la salida.`
  );

  return parts.join("\n\n");
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
      const scriptContext = resolveScriptContext(nodeId, liveNodes, edges);

      // Set generating
      updateNodeStatus(setNodes, nodeId, { status: "generating", errorMessage: undefined } as Partial<CanvasNodeData>);
      const startTime = Date.now();

      try {
        // Practicante has its own completion shape — handle separately and return.
        if (node.type === "text-practicante") {
          const practicanteData = nodeData as TextPracticanteNodeData;
          const basePrompt = practicanteData.prompt || "";
          const fullPrompt = promptContext ? `${promptContext}\n\n${basePrompt}` : basePrompt;

          const practicanteFiles: Array<{ filename: string; publicUrl: string; mimeType: string }> =
            mediaUrls.map((m, i) => {
              const urlPath = m.url.split("?")[0];
              const urlName = urlPath.split("/").pop() || `media-${i}`;
              const ext = urlName.includes(".") ? urlName.split(".").pop()!.toLowerCase() : (m.type === "video" ? "mp4" : "png");
              const mimeType = m.type === "video"
                ? (ext === "mov" ? "video/quicktime" : ext === "webm" ? "video/webm" : "video/mp4")
                : (ext === "jpg" || ext === "jpeg" ? "image/jpeg" : ext === "webp" ? "image/webp" : "image/png");
              return { filename: urlName, publicUrl: m.url, mimeType };
            });

          // Build a promptSuffix when the node must emit a clean prompt for downstream nodes.
          // Skipped in dry-run because there the user wants the full analysis text.
          const wantsCleanPrompt = practicanteData.outputAsPrompt && !practicanteData.dryRun;
          const downstream = wantsCleanPrompt ? getDownstreamContext(nodeId, liveNodes, edges) : null;
          let promptSuffix = wantsCleanPrompt && downstream ? buildPracticantePromptSuffix(downstream) : undefined;
          if (scriptContext) {
            // Prepend script context as additional context for the agent. Place it before
            // any output contract so the agent reads narrative context first, then the
            // formatting restrictions (when present).
            promptSuffix = promptSuffix
              ? `${scriptContext}\n\n${promptSuffix}`
              : scriptContext;
          }
          // End-of-message restriction: most reliable way to get an agent with its own
          // strong system prompt to actually respect the format rules.
          const messageWithRestriction = wantsCleanPrompt && downstream
            ? wrapMessageWithOutputContract(fullPrompt, downstream)
            : fullPrompt;

          const result = await executeTextPracticanteNode(
            messageWithRestriction,
            practicanteData,
            practicanteFiles,
            promptSuffix,
            wantsCleanPrompt ? true : undefined,
          );

          // Defensive fallback: practicante now filters intermediate turns server-side via
          // returnOnlyFinalText, but keep the client-side strip to catch the rare case where
          // an agent emits a "---" organically inside its final turn (e.g. markdown hr).
          const cleanResponse = wantsCleanPrompt ? stripProcessNarration(result.response) : result.response;

          const completedData: Partial<TextPracticanteNodeData> = {
            status: "completed",
            errorMessage: undefined,
            delegatedTo: result.delegatedTo,
            toolsUsed: result.toolsUsed,
            files: result.files,
            tokensUsed: result.tokensUsed,
            estimatedCost: result.estimatedCost,
            conversationId: result.conversationId || practicanteData.conversationId,
          };

          if (practicanteData.dryRun) {
            completedData.dryRunResponse = result.response;
            // Keep outputText untouched in dry-run so downstream nodes don't get the analysis as prompt
          } else {
            completedData.outputText = cleanResponse;
            completedData.outputMessageId = undefined;
            completedData.dryRunResponse = undefined;

            // Append to output history (text-only for practicante)
            const prevHistory = practicanteData.outputHistory;
            const newEntry: OutputHistoryEntry = {
              text: cleanResponse,
              createdAt: new Date().toISOString(),
              modelName: result.delegatedTo,
            };
            completedData.outputHistory = appendToHistory(prevHistory, newEntry);
          }

          updateNodeStatus(setNodes, nodeId, completedData as Partial<CanvasNodeData>);

          const liveNode = liveNodes.find((n) => n.id === nodeId);
          if (liveNode) {
            (liveNode as Node).data = { ...liveNode.data, ...completedData };
          }

          // Persist core fields via PATCH; the rest of the config is saved by autosave.
          await fetch(`/api/conversations/${conversationId}/canvas/nodes`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              nodeId,
              updates: {
                status: "completed",
                output_text: practicanteData.dryRun ? null : cleanResponse,
                output_url: null,
                output_message_id: null,
              },
            }),
          }).catch(() => {});

          const durationMs = Date.now() - startTime;
          fetch(`/api/conversations/${conversationId}/canvas/executions`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              node_id: nodeId,
              node_type: node.type,
              run_id: currentRunIdRef.current,
              model_name: result.delegatedTo || practicanteData.agentName || "Orquestador",
              status: "completed",
              duration_ms: durationMs,
              output_message_id: null,
            }),
          }).catch(() => {});

          return;
        }

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

            result = await executeTextNode(conversationId, fullPrompt, textData, nodeId, liveNodes, edges, mediaUrls, scriptContext);
            break;
          }
          case "image": {
            const imgData = effectiveData as ImageNodeData;
            const fullPrompt = promptContext
              ? `${promptContext}\n\n${imgData.prompt}`
              : imgData.prompt;

            if (isNanoBananaModel(imgData.modelId, generationConfig)) {
              result = await executeNanoBananaNode(conversationId, fullPrompt, imgData, referenceImageUrls, scriptContext);
            } else {
              // Imagen endpoint doesn't accept systemInstruction → prepend context to prompt
              const promptWithContext = scriptContext ? `${scriptContext}\n\n${fullPrompt}` : fullPrompt;
              result = await executeImageNode(conversationId, promptWithContext, imgData, referenceImageUrls);
            }
            break;
          }
          case "video": {
            const vidData = effectiveData as VideoNodeData;
            const fullPrompt = promptContext
              ? `${promptContext}\n\n${vidData.prompt}`
              : vidData.prompt;
            // Video endpoint doesn't accept systemInstruction → prepend context to prompt
            const promptWithContext = scriptContext ? `${scriptContext}\n\n${fullPrompt}` : fullPrompt;

            result = await executeVideoNode(conversationId, promptWithContext, vidData, { firstFrameUrl, lastFrameUrl, referenceImageUrls });
            break;
          }
        }

        // Append new result to outputHistory (history keeps ALL outputs)
        // Migrate pre-existing output from canvas created before history feature
        let prevHistory = (nodeData as Record<string, unknown>).outputHistory as OutputHistoryEntry[] | undefined;
        if ((!prevHistory || prevHistory.length === 0) && (nodeData.outputUrl || (nodeData as TextNodeData).outputText)) {
          prevHistory = [{
            url: (nodeData as ImageNodeData | VideoNodeData).outputUrl,
            text: (nodeData as TextNodeData).outputText,
            messageId: nodeData.outputMessageId,
            modelName: nodeData.modelName,
            createdAt: new Date().toISOString(),
          }];
        }
        const newEntry: OutputHistoryEntry = {
          url: result.outputUrl,
          text: result.outputText,
          messageId: result.messageId,
          modelName: (nodeData as Record<string, unknown>).modelName as string | undefined,
          createdAt: new Date().toISOString(),
        };
        const updatedHistory = appendToHistory(prevHistory, newEntry);

        const completedData: Partial<CanvasNodeData> = {
          status: "completed",
          outputUrl: result.outputUrl,
          outputText: result.outputText,
          outputMessageId: result.messageId,
          errorMessage: undefined,
          outputHistory: updatedHistory,
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

    // Reset all AI nodes to idle (history is preserved, new outputs appended on completion)
    const aiNodeTypes = new Set(["text", "text-practicante", "image", "video"]);
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

interface PracticanteRunResult {
  response: string;
  conversationId?: string;
  delegatedTo?: string;
  toolsUsed?: string[];
  files?: PracticanteFile[];
  tokensUsed?: { inputTokens: number; outputTokens: number };
  estimatedCost?: number;
}

const DOWNSTREAM_TYPE_LABELS: Record<string, string> = {
  image: "generación de imagen",
  video: "generación de video",
  text: "otro nodo de texto",
  "text-practicante": "otro agente de Practicante",
};

function describeDownstream(downstream: { types: string[] }): string {
  if (downstream.types.length === 0) return "un pipeline automatizado downstream";
  return downstream.types.map((t) => DOWNSTREAM_TYPE_LABELS[t] || t).join(" y ");
}

function buildPracticantePromptSuffix(downstream: { types: string[]; prompts: string[] }): string {
  const targetDesc = describeDownstream(downstream);

  let suffix = `MODO PIPELINE — restricción de salida (solo esta solicitud):
Tu respuesta final será consumida LITERALMENTE por ${targetDesc}, sin pasar por un humano.
Entrega SOLO el texto útil que resuelve la solicitud. Nada más.

Importante: usa español de Chile (tuteo, no voseo). No uses formas como "devolvé", "usalo", "agregás", "tené", "mirá".

Responde en UN SOLO turno, sin dividir la respuesta en pasos. No narres tu proceso antes de contestar ("Voy a revisar...", "Déjame analizar...", "Primero voy a...", "Permíteme...", "Con todo el material revisado..."). Ve directo al contenido.

PROHIBIDO (el pipeline se rompe si aparecen):
- Prefijos y saludos: "Aquí tienes", "Acá va el prompt", "Listo", "Perfecto", "Hecho"
- Narración de proceso: "Voy a...", "Déjame...", "Primero voy a...", "Permíteme...", "Con todo el material revisado..."
- Respuestas en varios turnos separados por "---"
- Headers markdown (##, ###), separadores (---), tablas de racional o fuentes
- Code fences \`\`\` salvo que la salida misma sea código
- Secciones extras tipo "VARIABLES MODULABLES", "POR QUÉ CUMPLE", "VARIACIONES SUGERIDAS"
- Versiones en varios idiomas ("PROMPT EN INGLÉS" / "VERSIÓN EN ESPAÑOL") — entrega una sola
- Preguntas de cierre ("¿Quieres variaciones?", "¿Te parece?", "¿Te sirve así?")
- Cualquier meta-comentario sobre el prompt

Si tu respuesta requiere más de un bloque o lleva título, estás rompiendo la restricción.`;

  if (downstream.prompts.length > 0) {
    suffix += `\n\nContexto de los nodos downstream (úsalo para enfocar, NUNCA lo repitas en la salida):\n${downstream.prompts.join("\n")}`;
  }

  return suffix;
}

function wrapMessageWithOutputContract(userMessage: string, downstream: { types: string[]; prompts: string[] }): string {
  const targetDesc = describeDownstream(downstream);
  return `<user_request>
${userMessage}
</user_request>

<output_contract>
La respuesta a <user_request> se inyecta TAL CUAL en ${targetDesc}.
Entrega SOLO el contenido útil, en un único bloque de texto plano, sin ornamentos, en UN SOLO turno.

Idioma: español de Chile (tuteo). No uses voseo argentino ("devolvé", "usalo", "agregás", "tené").

No narres tu proceso antes de responder: nada de "Voy a revisar...", "Déjame analizar...", "Primero voy a...", "Permíteme...", "Con todo el material revisado...". Ve directo al contenido.

No uses: prefijos ("Aquí tienes...", "Acá va...", "Listo..."), headers markdown, tablas, code fences, separadores (---), secciones múltiples, variantes en otros idiomas, preguntas finales, ni explicaciones sobre cómo se construyó.

Si la solicitud es un prompt, entrega el prompt crudo. Si es un texto, entrega el texto. Punto.
</output_contract>`;
}

/**
 * Safety net for practicante's "multi-turn joined with ---" behavior. When the agent
 * narrates its process in a first turn and then returns the actual content in a later
 * turn, practicante joins them with a "---" separator. Detect and strip that leading
 * narration if present.
 */
function stripProcessNarration(text: string): string {
  const trimmed = text.trimStart();
  // Find the first "---" on its own line within the preamble zone (first ~500 chars).
  const match = trimmed.match(/^([\s\S]{1,500}?)\n+---+\n+([\s\S]+)$/);
  if (!match) return text;
  const [, preamble, rest] = match;
  const preambleTrimmed = preamble.trim();
  const restTrimmed = rest.trim();
  // Only strip if the preamble is short (looks like narration, not real content)
  // and the remaining content is substantial.
  if (preambleTrimmed.length < 400 && restTrimmed.length > 30) {
    return restTrimmed;
  }
  return text;
}

async function executeTextPracticanteNode(
  prompt: string,
  config: TextPracticanteNodeData,
  files: Array<{ filename: string; publicUrl: string; mimeType: string }>,
  promptSuffix?: string,
  returnOnlyFinalText?: boolean
): Promise<PracticanteRunResult> {
  if (!prompt.trim()) {
    throw new Error("El prompt está vacío. Escribe una instrucción para Practicante.");
  }

  const body: Record<string, unknown> = {
    message: prompt,
    dryRun: config.dryRun === true,
  };
  if (config.agentId) body.agentId = config.agentId;
  if (config.agentName) body.agentName = config.agentName;
  if (config.conversationId) body.existingConversationId = config.conversationId;
  if (files.length > 0) body.files = files;
  if (promptSuffix) body.promptSuffix = promptSuffix;
  if (typeof returnOnlyFinalText === "boolean") body.returnOnlyFinalText = returnOnlyFinalText;

  const res = await fetch(`/api/practicante/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const responseBody = await res.json().catch(() => ({} as Record<string, unknown>));

  if (!res.ok) {
    const errMsg = typeof responseBody.error === "string" ? responseBody.error : `Practicante ${res.status}`;
    const code = typeof responseBody.code === "string" ? ` [${responseBody.code}]` : "";
    throw new Error(`${errMsg}${code}`);
  }

  if (responseBody.status === "failed") {
    const errMsg = typeof responseBody.error === "string" ? responseBody.error : "Ejecución fallida en Practicante";
    throw new Error(errMsg);
  }

  const response = typeof responseBody.response === "string" ? responseBody.response : "";
  const tokenUsage = responseBody.tokenUsage as
    | { inputTokens?: number; outputTokens?: number; estimatedCost?: number }
    | undefined;

  return {
    response,
    conversationId: typeof responseBody.conversationId === "string" ? responseBody.conversationId : undefined,
    delegatedTo: typeof responseBody.delegatedTo === "string" ? responseBody.delegatedTo : undefined,
    toolsUsed: Array.isArray(responseBody.toolsUsed) ? (responseBody.toolsUsed as string[]) : undefined,
    files: Array.isArray(responseBody.files) ? (responseBody.files as PracticanteFile[]) : undefined,
    tokensUsed:
      tokenUsage && typeof tokenUsage.inputTokens === "number" && typeof tokenUsage.outputTokens === "number"
        ? { inputTokens: tokenUsage.inputTokens, outputTokens: tokenUsage.outputTokens }
        : undefined,
    estimatedCost: tokenUsage && typeof tokenUsage.estimatedCost === "number" ? tokenUsage.estimatedCost : undefined,
  };
}

async function executeTextNode(
  conversationId: number,
  prompt: string,
  config: TextNodeData,
  nodeId: string,
  allNodes: Node[],
  allEdges: CanvasEdge[],
  mediaUrls: { url: string; type: "image" | "video" }[] = [],
  scriptContext: string | null = null
): Promise<{ outputText?: string; messageId?: number }> {
  // Build system instruction override
  const systemParts: string[] = [];
  if (scriptContext) {
    systemParts.push(scriptContext);
  }
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
  referenceImageUrls: string[],
  scriptContext: string | null = null
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
  if (scriptContext) {
    body.system_instruction_override = scriptContext;
  }

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
