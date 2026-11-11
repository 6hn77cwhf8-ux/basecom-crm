import ExcelJS from "exceljs";

export type Sheet = { name: string; headers: string[]; rows: unknown[][] };

/** Valor simples de uma célula (texto, número, data), sem fórmulas nem formatação. */
function cellValue(v: ExcelJS.CellValue): unknown {
  if (v == null) return null;
  if (v instanceof Date || typeof v !== "object") return typeof v === "string" ? v.trim() : v;
  if ("result" in v) return cellValue(v.result as ExcelJS.CellValue);
  if ("richText" in v) return v.richText.map((t) => t.text).join("").trim();
  if ("text" in v) return String(v.text).trim();
  if ("error" in v) return null;
  return String(v);
}

/** Lê todas as folhas de um Excel: a primeira linha é o cabeçalho. */
export async function readWorkbook(data: Buffer): Promise<Sheet[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as unknown as ArrayBuffer);
  const out: Sheet[] = [];
  wb.eachSheet((ws) => {
    const rows: unknown[][] = [];
    let headers: string[] = [];
    ws.eachRow({ includeEmpty: false }, (row, n) => {
      const values = (row.values as ExcelJS.CellValue[]).slice(1).map(cellValue);
      if (n === 1) headers = values.map((h) => String(h ?? "").trim());
      else if (values.some((v) => v !== null && v !== "")) rows.push(values);
    });
    out.push({ name: ws.name, headers, rows });
  });
  return out;
}
