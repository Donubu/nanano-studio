// Override layout per adaptation.
//
// Modelo: cada adaptación puede tener `overrides_json` con un manual_layout
// (un TemplateDefinition completo dimensionado al tamaño de la adaptación).
// Cuando existe, el renderer lo usa tal cual e ignora el fit_mode automático.
// Cuando no existe, se aplica fit_mode + reflow desde el master.
//
// Cape, Celtra y otras plataformas adoptan este modelo: el master sigue
// sincronizado para las adaptaciones que están en "auto"; las que el
// productor ajustó manualmente quedan desacopladas y persisten su propio
// layout. La contrapartida es que cambios al master no se propagan a las
// piezas manuales (es responsabilidad del productor refrescarlas si lo
// necesita).

import { TemplateDefinition } from "./types";
import { reflowForPreview } from "./reflow";

export interface AdaptationOverrides {
  manual_layout?: TemplateDefinition;
}

export function parseOverrides(json: string | null | undefined): AdaptationOverrides {
  if (!json) return {};
  try {
    const parsed = typeof json === "string" ? JSON.parse(json) : json;
    return (parsed && typeof parsed === "object" ? parsed : {}) as AdaptationOverrides;
  } catch {
    return {};
  }
}

export function serializeOverrides(o: AdaptationOverrides): string {
  return JSON.stringify(o);
}

// Construye un layout inicial para el override editor a partir del master.
// Usa reflowForPreview (que ya aprovecha smart constraints) para que el
// productor reciba algo razonable de entrada y solo tenga que ajustar lo
// que no se vea bien.
export function deriveManualLayoutFromMaster(
  master: TemplateDefinition,
  adaptW: number,
  adaptH: number,
): TemplateDefinition {
  return reflowForPreview(master, { w: adaptW, h: adaptH });
}
