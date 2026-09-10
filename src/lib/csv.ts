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
  return decodeText(await file.arrayBuffer());
}

/** バイト列 → テキスト（UTF-8優先、失敗時 Shift_JIS）。 */
function decodeText(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf).replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("shift_jis").decode(buf);
  }
}

/**
 * File → 2次元配列。CSV/TSV でも Excelブック(.xlsx) でも同じ形で読む。ブラウザ専用。
 * McFrameの出力などをCSVに保存し直さずそのまま取り込めるようにするための入口。
 */
export async function readSheetRows(file: File): Promise<string[][]> {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
  // zip（=xlsx/xlsm）は "PK"
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const { readXlsxRows } = await import("./xlsx");
    return readXlsxRows(buf);
  }
  // 旧Excel形式(.xls)は複合ドキュメント。中身を読めないので案内を返す
  if (head[0] === 0xd0 && head[1] === 0xcf) {
    throw new Error(
      "旧Excel形式(.xls)は取り込めません。Excelで「.xlsx」またはCSVとして保存し直してください。"
    );
  }
  return parseCsv(decodeText(buf));
}

/**
 * File → シートごとの2次元配列。Excelブックは全シート、CSVは1枚として返す。ブラウザ専用。
 * 1つのブックに様式違いの記録が同居することがあるため、取込側で全シートを見たいときに使う。
 */
export async function readSheetTables(file: File): Promise<{ name: string; rows: string[][] }[]> {
  const buf = await file.arrayBuffer();
  const head = new Uint8Array(buf, 0, Math.min(8, buf.byteLength));
  if (head[0] === 0x50 && head[1] === 0x4b) {
    const { readXlsx } = await import("./xlsx");
    // 取込側は文字列で扱う（日付はシリアル値のまま渡り、取込側が日付に直す）
    return (await readXlsx(buf)).map((s) => ({
      name: s.name,
      rows: s.rows.map((r) =>
        Array.from(r, (c) => (c === null || c === undefined ? "" : String(c)))
      ),
    }));
  }
  if (head[0] === 0xd0 && head[1] === 0xcf) {
    throw new Error(
      "旧Excel形式(.xls)は取り込めません。Excelで「.xlsx」またはCSVとして保存し直してください。"
    );
  }
  return [{ name: file.name, rows: parseCsv(decodeText(buf)) }];
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
