/**
 * CSV ユーティリティ（クライアント/サーバー共用の純粋関数）。
 * 取込はブラウザ側でパースしてから Server Action に渡す。
 * 出力は UTF-8 BOM 付き（Excel でそのまま開ける）。
 */

/** CSVテキスト → 2次元配列（引用符・改行対応）。空行は除く。 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => String(v).trim() !== ""));
}

export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((r) =>
      r
        .map((v) => {
          const s = String(v ?? "");
          return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        })
        .join(",")
    )
    .join("\r\n");
}

/** File → テキスト（UTF-8優先、失敗時 Shift_JIS。Excel保存のCSVに対応）。ブラウザ専用。 */
export async function readTextFile(file: File): Promise<string> {
  const buf = await file.arrayBuffer();
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("shift_jis").decode(buf);
  }
}

/** CSV をダウンロードさせる（UTF-8 BOM 付き）。ブラウザ専用。 */
export function downloadCsv(filename: string, rows: (string | number | null | undefined)[][]): void {
  const blob = new Blob(["\uFEFF" + toCsv(rows)], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
