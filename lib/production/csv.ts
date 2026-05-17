// CSV parsing helpers. Cliente-side via PapaParse — el dataset queda en
// memoria de la sesión (no se persiste todavía; eso es trabajo futuro
// usando la tabla production_datasets).

import Papa from "papaparse";
import { DataRow } from "./variables";

export interface ParsedDataset {
  columns: string[];
  rows: DataRow[];
  totalRows: number;
  // Filename original para mostrarlo en la UI.
  filename: string;
}

export async function parseCsvFile(file: File): Promise<ParsedDataset> {
  return new Promise((resolve, reject) => {
    Papa.parse<DataRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        // PapaParse infiere los headers de la primera fila. Convertimos los
        // valores no-string en strings — más predecible para substitución.
        const columns = result.meta.fields ?? [];
        const rows = (result.data as DataRow[]).map((row) => {
          const cleaned: DataRow = {};
          for (const col of columns) {
            const v = row[col];
            cleaned[col] = v == null ? "" : String(v).trim();
          }
          return cleaned;
        });
        resolve({
          columns,
          rows,
          totalRows: rows.length,
          filename: file.name,
        });
      },
      error: (err: Error) => reject(err),
    });
  });
}
