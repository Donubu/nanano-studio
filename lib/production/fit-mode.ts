// Heurísticas para elegir el fit_mode default y para detectar mismatches
// de aspect ratio que probablemente requieren ajuste manual.
//
// Reglas (basadas en la diferencia relativa de aspect ratios):
//   - Diff ≤ 20%  → "responsive": los constraints reflowan bien la pieza.
//   - Diff ≤ 200% → "cover":      llena la adaptación, recorta lo que sobra.
//   - Diff > 200% → "cover" + warning: aspect demasiado distinto, sugerir
//                    override manual o un master dedicado.

export type FitMode = "contain" | "cover" | "width" | "height" | "responsive";

const RESPONSIVE_THRESHOLD = 0.2;
const EXTREME_THRESHOLD = 2.0;

function aspectDiff(masterW: number, masterH: number, adaptW: number, adaptH: number): number {
  const m = masterW / masterH;
  const a = adaptW / adaptH;
  return Math.abs(m - a) / Math.min(m, a);
}

export function suggestFitMode(
  masterW: number,
  masterH: number,
  adaptW: number,
  adaptH: number,
): FitMode {
  const diff = aspectDiff(masterW, masterH, adaptW, adaptH);
  if (diff <= RESPONSIVE_THRESHOLD) return "responsive";
  return "cover";
}

export function hasExtremeAspectMismatch(
  masterW: number,
  masterH: number,
  adaptW: number,
  adaptH: number,
): boolean {
  return aspectDiff(masterW, masterH, adaptW, adaptH) > EXTREME_THRESHOLD;
}
