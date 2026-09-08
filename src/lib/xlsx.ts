/**
 * 最小限の .xlsx 読み取り（依存パッケージなし・ブラウザ／Node 共用）。
 *
 * 現場のExcel（スクラップ日次記録票）を取り込むためだけの実装なので、
 * セルの「値」しか読まない（書式・グラフ・図形は無視する）。
 *   - ZIP は中央ディレクトリを見て必要なエントリだけ展開（deflate は DecompressionStream）
 *   - 共有文字列（sharedStrings.xml）とシートXMLの `<v>` / `<is>` だけを解釈
 *   - 数式セルは Excel が保存したキャッシュ値（`<v>`）を返す
 *
 * 日付・時刻はシリアル値（数値）のまま返す。1900年うるう年バグを含む変換は
 * 使う側（dailyExcel.ts）で行う。
 */

export type XlsxCell = string | number | boolean | null;

export interface XlsxSheet {
  name: string;
  /** 行 × 列（どちらも0始まり）。空セルは null。 */
  rows: XlsxCell[][];
}

const utf8 = new TextDecoder("utf-8");

interface ZipEntry {
  method: number;
  offset: number;
  compSize: number;
}

/** ZIP の中央ディレクトリを読み、エントリ名 → 位置の対応を作る。 */
function readCentralDirectory(buf: ArrayBuffer): Map<string, ZipEntry> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  // EOCD（End Of Central Directory）を末尾から探す。コメントは最大64KB。
  let eocd = -1;
  const min = Math.max(0, bytes.length - 22 - 0xffff);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Excelファイルとして読めません（ZIPの終端が見つかりません）。");

  const count = view.getUint16(eocd + 10, true);
  let ptr = view.getUint32(eocd + 16, true);
  const entries = new Map<string, ZipEntry>();
  for (let i = 0; i < count; i++) {
    if (ptr + 46 > bytes.length || view.getUint32(ptr, true) !== 0x02014b50) break;
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const offset = view.getUint32(ptr + 42, true);
    const name = utf8.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    // ZIP64（4GB超・65535エントリ超）は業務用のExcelでは出ないので対応しない
    if (compSize === 0xffffffff || offset === 0xffffffff) {
      throw new Error("このExcelファイル（ZIP64形式）には対応していません。");
    }
    entries.set(name, { method, offset, compSize });
    ptr += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** エントリを展開してテキストで返す。無ければ null。 */
async function readEntry(
  buf: ArrayBuffer,
  entries: Map<string, ZipEntry>,
  name: string
): Promise<string | null> {
  const e = entries.get(name);
  if (!e) return null;
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  if (view.getUint32(e.offset, true) !== 0x04034b50) {
    throw new Error("Excelファイルが壊れています（ZIPのヘッダーが不正）。");
  }
  const nameLen = view.getUint16(e.offset + 26, true);
  const extraLen = view.getUint16(e.offset + 28, true);
  const start = e.offset + 30 + nameLen + extraLen;
  const data = bytes.subarray(start, start + e.compSize);
  if (e.method === 0) return utf8.decode(data);
  if (e.method !== 8) throw new Error("このExcelファイルの圧縮形式には対応していません。");
  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "このブラウザではExcelの取込に対応していません。Chrome / Edge の最新版でお試しください。"
    );
  }
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).text();
}

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function unescapeXml(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, ref: string) => {
    if (ref[0] === "#") {
      const code = ref[1] === "x" ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return XML_ENTITIES[ref] ?? m;
  });
}

/** タグの属性値を取り出す（`r="A11"` → A11）。 */
function attr(tag: string, name: string): string {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`));
  return m ? unescapeXml(m[1]) : "";
}

/**
 * `<t>` の中身をつなげる（リッチテキストは複数の `<r><t>` に分かれる）。
 * ふりがな（`<rPh>`）は本文ではないので落とす。これを含めると
 * 「祖父江」が「祖父江ソブエ」になってしまう。
 */
function joinText(xml: string): string {
  let out = "";
  const body = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, "");
  const re = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out += unescapeXml(m[1]);
  return out;
}

function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  const re = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out.push(m[1] ? joinText(m[1]) : "");
  return out;
}

/** 列名（A, B, … AA）→ 0始まりの列番号。 */
function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

function parseSheetXml(xml: string, shared: string[]): XlsxCell[][] {
  const rows: XlsxCell[][] = [];
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let rowMatch: RegExpExecArray | null;
  let autoRow = 0;
  while ((rowMatch = rowRe.exec(xml))) {
    const rowNo = Number(attr(rowMatch[1] ?? "", "r"));
    const r = Number.isFinite(rowNo) && rowNo > 0 ? rowNo - 1 : autoRow;
    autoRow = r + 1;
    const body = rowMatch[2] ?? "";
    const cells: XlsxCell[] = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch: RegExpExecArray | null;
    let autoCol = 0;
    while ((cellMatch = cellRe.exec(body))) {
      const tag = cellMatch[1] ?? "";
      const inner = cellMatch[2] ?? "";
      const ref = attr(tag, "r");
      const c = ref ? colIndex(ref) : autoCol;
      autoCol = c + 1;
      const type = attr(tag, "t");
      let value: XlsxCell = null;
      if (type === "inlineStr") {
        value = joinText(inner);
      } else {
        const v = inner.match(/<v\b[^>]*>([\s\S]*?)<\/v>/);
        const raw = v ? unescapeXml(v[1]) : "";
        if (raw === "") value = null;
        else if (type === "s") value = shared[Number(raw)] ?? "";
        else if (type === "str") value = raw;
        else if (type === "b") value = raw === "1";
        else if (type === "e") value = null; // #REF! などのエラーは空扱い
        else {
          const n = Number(raw);
          value = Number.isFinite(n) ? n : raw;
        }
      }
      if (typeof value === "string" && value === "") value = null;
      while (cells.length < c) cells.push(null);
      cells[c] = value;
    }
    while (rows.length < r) rows.push([]);
    rows[r] = cells;
  }
  return rows;
}

/**
 * .xlsx（ArrayBuffer）を読み、シートをブック内の並び順で返す。
 * 非表示シートも含める（取り込む側で中身を見て判断する）。
 */
export async function readXlsx(buf: ArrayBuffer): Promise<XlsxSheet[]> {
  const entries = readCentralDirectory(buf);
  const workbook = await readEntry(buf, entries, "xl/workbook.xml");
  if (!workbook) throw new Error("Excelファイルとして読めません（workbook.xml がありません）。");

  // rId → シートXMLのパス
  const relsXml = (await readEntry(buf, entries, "xl/_rels/workbook.xml.rels")) ?? "";
  const targets = new Map<string, string>();
  const relRe = /<Relationship\b([^>]*)\/>/g;
  let rel: RegExpExecArray | null;
  while ((rel = relRe.exec(relsXml))) {
    const id = attr(rel[1], "Id");
    let target = attr(rel[1], "Target");
    if (!id || !target) continue;
    target = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
    targets.set(id, target.replace(/^xl\/\.\.\//, ""));
  }

  const sharedXml = await readEntry(buf, entries, "xl/sharedStrings.xml");
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];

  const sheets: XlsxSheet[] = [];
  const sheetRe = /<sheet\b([^>]*)\/>/g;
  let sheetMatch: RegExpExecArray | null;
  let fallbackNo = 0;
  while ((sheetMatch = sheetRe.exec(workbook))) {
    const tag = sheetMatch[1];
    const name = attr(tag, "name");
    if (!name) continue;
    fallbackNo++;
    const rid = attr(tag, "r:id") || attr(tag, "id");
    const path = targets.get(rid) ?? `xl/worksheets/sheet${fallbackNo}.xml`;
    const xml = await readEntry(buf, entries, path);
    sheets.push({ name, rows: xml ? parseSheetXml(xml, shared) : [] });
  }
  if (sheets.length === 0) throw new Error("シートが見つかりませんでした。");
  return sheets;
}
