"use client";

// Sección "Heredado del Personaje" del panel de una imagen de etapa: muestra
// y deja editar, sin ir al nodo Personaje, lo que esa imagen recibe al
// ejecutar (texto de la etapa, ADN y estilo global) más sus fotos y el prompt
// final. Los cambios se guardan en el Personaje (o en el texto de estilo):
// es el mismo vínculo vivo, así que aplican en la próxima ejecución.

import { useMemo, useState } from "react";
import type { Node } from "@xyflow/react";
import { ChevronRight, Dna, Images, Palette, UserRound } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  HANDLE_IDS,
  baseHandleId,
  type CanvasNodeData,
  type CharacterNodeData,
  type CharacterStage,
} from "../lib/canvas-types";
import { composeCharacterPrompt, stageReferenceUrls } from "../lib/character";

interface Props {
  imageNode: Node;
  nodes: Node[];
  edges: Array<{ source: string; target: string; targetHandle?: string | null }>;
  onUpdateData: (nodeId: string, updates: Partial<CanvasNodeData>) => void;
}

export function CharacterInheritedSection({ imageNode, nodes, edges, onUpdateData }: Props) {
  const [showPreview, setShowPreview] = useState(false);

  const info = useMemo(() => {
    const promptEdge = edges.find(
      (e) => e.target === imageNode.id && baseHandleId(e.targetHandle) === HANDLE_IDS.INPUT_PROMPT &&
        nodes.find((n) => n.id === e.source)?.type === "character",
    );
    const character = promptEdge ? nodes.find((n) => n.id === promptEdge.source) : undefined;
    if (!character) return null;
    const data = character.data as unknown as CharacterNodeData;
    const stageIndex = (data.stages ?? []).findIndex((s) => s.imageNodeId === imageNode.id);
    const stage = stageIndex >= 0 ? data.stages[stageIndex] : null;

    const inputsOf = (handle: string) =>
      edges.filter((e) => e.target === character.id && baseHandleId(e.targetHandle) === handle);
    const styleEdge = inputsOf(HANDLE_IDS.INPUT_CHARACTER_STYLE)[0];
    const styleNode = styleEdge ? nodes.find((n) => n.id === styleEdge.source) : undefined;
    const styleData = (styleNode?.data ?? {}) as Record<string, unknown>;
    const styleText =
      styleNode?.type === "static-text"
        ? String(styleData.content ?? "")
        : String(styleData.outputText ?? "");
    // Otros Personajes que usan el mismo texto de estilo.
    const styleSharedWith = styleNode
      ? edges.filter(
          (e) => e.source === styleNode.id && e.target !== character.id &&
            baseHandleId(e.targetHandle) === HANDLE_IDS.INPUT_CHARACTER_STYLE,
        ).length
      : 0;

    const galleries = inputsOf(HANDLE_IDS.INPUT_CHARACTER_GALLERY)
      .map((e) => nodes.find((n) => n.id === e.source))
      .filter((n): n is Node => !!n)
      .map((n) => ({ id: n.id, type: n.type, data: n.data as Record<string, unknown> }));
    const photos = stageReferenceUrls(stage, galleries);
    const hasContinuity = edges.some(
      (e) => e.target === imageNode.id && baseHandleId(e.targetHandle) === HANDLE_IDS.INPUT_REFERENCE,
    );

    return { character, data, stage, stageIndex, styleNode, styleText, styleSharedWith, photos, hasContinuity };
  }, [imageNode.id, nodes, edges]);

  if (!info) return null;
  const { character, data, stage, stageIndex, styleNode, styleText, styleSharedWith, photos, hasContinuity } = info;

  const patchStage = (patch: Partial<CharacterStage>) => {
    if (!stage) return;
    onUpdateData(character.id, {
      stages: data.stages.map((s) => (s.id === stage.id ? { ...s, ...patch } : s)),
    } as Partial<CanvasNodeData>);
  };

  const ownPrompt = String((imageNode.data as Record<string, unknown>).prompt ?? "").trim();
  const finalPrompt = [
    composeCharacterPrompt({
      dna: data.dna,
      style: styleText,
      stage,
      hasReferences: photos.length > 0 || hasContinuity,
    }),
    ownPrompt,
  ]
    .filter(Boolean)
    .join("\n\n");

  return (
    <div className="space-y-3 rounded-lg border border-pink-400/40 bg-pink-500/5 p-3">
      <div className="flex items-center gap-1.5 text-xs font-medium">
        <UserRound className="h-3.5 w-3.5 shrink-0 text-pink-500" />
        <span className="min-w-0 truncate">
          Heredado de {data.label || "Personaje"}
          {stage ? ` · etapa ${stageIndex + 1}` : ""}
        </span>
      </div>

      {!stage ? (
        <p className="text-xs text-amber-700 dark:text-amber-300">
          Esta imagen ya no corresponde a ninguna etapa del Personaje: recibe solo el ADN y el estilo.
        </p>
      ) : (
        <div className="space-y-1.5">
          <Label className="text-xs">Etapa</Label>
          <Input
            value={stage.name}
            onChange={(e) => patchStage({ name: e.target.value })}
            placeholder="Nombre de la etapa"
            className="h-8 text-sm"
          />
          <Textarea
            value={stage.text}
            onChange={(e) => patchStage({ text: e.target.value })}
            placeholder="Cómo es el personaje en esta etapa: edad, ropa, pelo, contexto…"
            className="min-h-[72px] resize-y text-sm"
          />
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Images className="h-3 w-3 shrink-0" />
            {photos.length > 0 ? (
              <>
                <span className="shrink-0">
                  {photos.length} {photos.length === 1 ? "foto de referencia" : "fotos de referencia"}
                </span>
                <span className="flex min-w-0 gap-0.5 overflow-hidden">
                  {photos.slice(0, 6).map((url) => (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={url} src={url} alt="" className="h-6 w-6 shrink-0 rounded object-cover" loading="lazy" />
                  ))}
                </span>
              </>
            ) : (
              <span>Sin fotos de referencia (se eligen en el nodo Personaje)</span>
            )}
          </div>
        </div>
      )}

      <div className="space-y-1.5">
        <Label className="flex items-center gap-1 text-xs">
          <Dna className="h-3 w-3 text-pink-500" /> ADN (todas las etapas)
        </Label>
        <Textarea
          value={data.dna ?? ""}
          onChange={(e) => onUpdateData(character.id, { dna: e.target.value } as Partial<CanvasNodeData>)}
          placeholder="Rasgos que no cambian entre etapas"
          className="min-h-[60px] resize-y text-sm"
        />
      </div>

      {styleNode && (
        <div className="space-y-1.5">
          <Label className="flex items-center gap-1 text-xs">
            <Palette className="h-3 w-3 text-blue-500" /> Estilo global
            {styleSharedWith > 0 && (
              <span className="font-normal text-muted-foreground">
                · compartido con {styleSharedWith} {styleSharedWith === 1 ? "personaje más" : "personajes más"}
              </span>
            )}
          </Label>
          {styleNode.type === "static-text" ? (
            <Textarea
              value={styleText}
              onChange={(e) => onUpdateData(styleNode.id, { content: e.target.value } as Partial<CanvasNodeData>)}
              placeholder="Estilo de ilustración, paleta, encuadre…"
              className="min-h-[60px] resize-y text-sm"
            />
          ) : (
            <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-2 text-xs text-muted-foreground">
              {styleText || "Lo genera un nodo de IA conectado (todavía sin resultado)."}
            </p>
          )}
        </div>
      )}

      <div>
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
        >
          <ChevronRight className={`h-3 w-3 transition-transform ${showPreview ? "rotate-90" : ""}`} />
          Ver el prompt final que recibe esta imagen
        </button>
        {showPreview && (
          <pre className="mt-1.5 max-h-60 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 font-sans text-[11px] text-muted-foreground">
            {finalPrompt || "(vacío)"}
          </pre>
        )}
      </div>
    </div>
  );
}
