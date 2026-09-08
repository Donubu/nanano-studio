// Heurísticas para elegir el fit_mode default y para detectar mismatches
// de aspect ratio que probablemente requieren ajuste manual.
//
// Reglas:
//   - fit_mode default = "responsive" (adapt.ts elige reflow o recomposición
//     lineal según el aspect).
//   - Diff > 200% → warning informativo: el resultado automático conviene
//     revisarlo o pedir "Adaptar con IA".

export type FitMode = "contain" | "cover" | "width" | "height" | "responsive";

const EXTREME_THRESHOLD = 2.0;

function aspectDiff(masterW: number, masterH: number, adaptW: number, adaptH: number): number {
  const m = masterW / masterH;
  const a = adaptW / adaptH;
  return Math.abs(m - a) / Math.min(m, a);
}

// Default: "responsive" siempre. El motor de adaptación (adapt.ts) decide
// internamente entre reflow+ajuste y recomposición lineal según el aspect,
// así que ya no hace falta caer a "cover" (que recortaba el centro del
// master en tiras como 728×90). Los modos scale-based quedan como opción
// manual para casos puntuales.
// Los parámetros se conservan por compatibilidad con los callers.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function suggestFitMode(masterW: number, masterH: number, adaptW: number, adaptH: number): FitMode {
  return "responsive";
}

export function hasExtremeAspectMismatch(
  masterW: number,
  masterH: number,
  adaptW: number,
  adaptH: number,
): boolean {
  return aspectDiff(masterW, masterH, adaptW, adaptH) > EXTREME_THRESHOLD;
}
