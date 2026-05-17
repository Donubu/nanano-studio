// Variable substitution para templates.
//
// Sintaxis: {{nombre_variable}} dentro de un text layer. Cuando el productor
// adjunta un dataset (CSV/Excel) al producir, cada fila reemplaza las
// variables y genera una pieza distinta. Útil para mail merge: un solo master
// + un Excel con 100 filas → 100 piezas listas.
//
// Las variables se DETECTAN automáticamente de los text layers (no hay que
// declararlas). El productor solo escribe {{precio}} en el master y al subir
// el CSV el sistema le pide mapearlo a una columna.

import {
  TemplateDefinition,
  TemplateLayer,
  TextLayer,
  FrameLayer,
} from "./types";

const VAR_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

export type DataRow = Record<string, string | number | null | undefined>;

// Extrae todas las variables únicas declaradas en los text layers del
// template (incluyendo frames anidados). Preserva el orden de aparición.
export function extractVariables(def: TemplateDefinition): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const visit = (layer: TemplateLayer) => {
    if (layer.type === "text") {
      VAR_RE.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = VAR_RE.exec(layer.content)) !== null) {
        const name = m[1];
        if (!seen.has(name)) {
          seen.add(name);
          out.push(name);
        }
      }
    }
    if (layer.type === "frame") {
      layer.children.forEach(visit);
    }
  };
  def.children.forEach(visit);
  return out;
}

// Reemplaza {{var}} con data[var] en strings. Variables sin valor en la fila
// se reemplazan por "" (string vacío) en vez de dejar el literal {{var}}.
function substituteString(s: string, data: DataRow): string {
  return s.replace(VAR_RE, (_, name) => {
    const v = data[name];
    if (v === undefined || v === null) return "";
    return String(v);
  });
}

// Aplica substitución recursiva al árbol. No muta el original.
export function substituteVariables(
  def: TemplateDefinition,
  data: DataRow,
): TemplateDefinition {
  return substituteLayer(def, data) as TemplateDefinition;
}

function substituteLayer(layer: TemplateLayer, data: DataRow): TemplateLayer {
  if (layer.type === "text") {
    const text = layer as TextLayer;
    return { ...text, content: substituteString(text.content, data) };
  }
  if (layer.type === "frame") {
    const frame = layer as FrameLayer;
    return { ...frame, children: frame.children.map((c) => substituteLayer(c, data)) };
  }
  return layer;
}

// Verifica si el dataset tiene todas las columnas necesarias. Devuelve las
// variables que NO están en la fila (placeholders perdidos).
export function missingVariables(template: TemplateDefinition, data: DataRow): string[] {
  const vars = extractVariables(template);
  return vars.filter((v) => !(v in data));
}
