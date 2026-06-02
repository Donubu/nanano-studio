"use client";

import { useCallback } from "react";
import { useCanvasContext } from "../canvas-context";

/**
 * Hook que usan los componentes de nodo para editar su data. A diferencia del
 * `useReactFlow().updateNodeData` crudo, esto: (1) actualiza el state local,
 * (2) PERSISTE el cambio en la BD (UPSERT con debounce) y (3) lo emite a los
 * colaboradores. Sin la persistencia, las ediciones hechas dentro del nodo
 * (imágenes de galería, texto estático, notas, labels) se perdían al refrescar.
 */
export function useNodeUpdate() {
  const { persistNodeData } = useCanvasContext();

  const updateNodeData = useCallback(
    (nodeId: string, data: Record<string, unknown>) => {
      persistNodeData(nodeId, data);
    },
    [persistNodeData]
  );

  return { updateNodeData };
}
