/**
 * XLSX（Excelブック）→ 2次元配列。ブラウザ専用の最小リーダー。
 *
 * McFrameの実績出力や現場の集計表は .xlsx のまま渡されることが多いため、
 * CSVに保存し直さなくても取込ボタンにそのまま渡せるようにする。
 * 追加パッケージは使わず、zipの展開は DecompressionStream("deflate-raw")、
 * XMLは正規表現で読む（取込に必要なのはセルの値だけで、書式や数式は読まない）。
 */

type ZipEntry = { method: number; start: number; size: number };

/** zipの中央目録を読み、ファイル名 → 位置の索引を作る（展開は必要なものだけ後から行う）。 */
function zipIndex(buf: ArrayBuffer): Map<string, ZipEntry> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  // 末尾（コメント最大64KB）から EOCD レコードを探す
  let eocd = -1;
  const min = Math.max(0, bytes.length - 66000);
  for (let i = bytes.length - 22; i >= min; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("Excelファイルとして読み取れませんでした。");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  if (p === 0xffffffff) throw new Error("このExcelファイルは取り込めません。CSVで保存し直してください。");
  const entries = new Map<string, ZipEntry>();
  const dec = new TextDecoder("utf-8");
  for (let i = 0; i < count; i++) {
    if (p + 46 > bytes.length || view.getUint32(p, true) !== 0x02014b50) break;
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    // 実データの開始位置はローカルヘッダーから求める（拡張領域の長さが中央目録と異なることがある）
    const localName = view.getUint16(local + 26, true);
    const localExtra = view.getUint16(local + 28, true);
    entries.set(name, { method, start: local + 30 + localName + localExtra, size });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** zipの1エントリをテキストとして取り出す（見つからない場合は空文字）。 */
async function unzipText(buf: ArrayBuffer, entry: ZipEntry | undefined): Promise<string> {
  if (!entry) return "";
  const raw = new Uint8Array(buf, entry.start, entry.size);
  if (entry.method === 0) return new TextDecoder("utf-8").decode(raw);
  if (entry.method !== 8 || typeof DecompressionStream === "undefined") {
    throw new Error(
      "お使いのブラウザではExcelファイルを直接読み取れません。Excelで「CSV」として保存してから取り込んでください。"
    );
  }
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return await new Response(stream).text();
}

/** XMLの文字参照・実体参照を戻す。 */
function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

/** <t> の中身を連結する。ふりがな（<rPh>）は本文ではないので落とす。 */
function textOf(xml: string): string {
  const body = xml.replace(/<rPh[\s\S]*?<\/rPh>/g, "");
  let out = "";
  for (const m of body.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)) out += decodeXml(m[1]);
  return out;
}

/** 共有文字列表（セルの t="s" が指す文字列）。 */
function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  for (const m of xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si\s*\/>/g)) {
    out.push(m[1] === undefined ? "" : textOf(m[1]));
  }
  return out;
}

/** 表示形式が日付・時刻か（書式記号の y/m/d/h/s で判定。[$-411] や "文字" は書式記号ではない）。 */
function isDateFormat(id: number, code: string | undefined): boolean {
  if (code === undefined) return (id >= 14 && id <= 22) || (id >= 45 && id <= 47);
  const c = code
    .replace(/\[[^\]]*\]/g, "")
    .replace(/"[^"]*"/g, "")
    .replace(/\\./g, "");
  return /[ymdhs]/i.test(c);
}

/** 書式番号（セルの s 属性）ごとに「日付として表示されているか」を返す。 */
function dateStyles(xml: string): boolean[] {
  const fmt = new Map<number, string>();
  for (const m of xml.matchAll(/<numFmt\s[^>]*?numFmtId="(\d+)"[^>]*?formatCode="([^"]*)"/g)) {
    fmt.set(Number(m[1]), decodeXml(m[2]));
  }
  const block = xml.match(/<cellXfs[\s\S]*?<\/cellXfs>/)?.[0] ?? "";
  const out: boolean[] = [];
  for (const m of block.matchAll(/<xf\b[^>]*>/g)) {
    const id = Number(m[0].match(/numFmtId="(\d+)"/)?.[1] ?? 0);
    out.push(isDateFormat(id, fmt.get(id)));
  }
  return out;
}

/** Excelの日付シリアル値 → 'YYYY-MM-DD'（時刻があれば ' HH:MM:SS' つき）。 */
function serialToText(serial: number, date1904: boolean): string {
  // 1900年方式の起点は 1899-12-30（Excelの「1900年はうるう年」互換のため）。
  const base = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const days = Math.floor(serial);
  const secs = Math.round((serial - days) * 86400);
  const d = new Date(base + days * 86400000 + secs * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  const hms = `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}`;
  if (serial < 1) return hms;
  const ymd = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  return secs === 0 ? ymd : `${ymd} ${hms}`;
}

/** 列参照 'A' 'AB' → 0始まりの列番号。 */
function colNum(ref: string): number {
  let n = 0;
  for (let i = 0; i < ref.length; i++) n = n * 26 + (ref.charCodeAt(i) - 64);
  return n - 1;
}

/** シートXML → 2次元配列（空行は除く。CSV取込と同じ形にそろえる）。 */
function sheetRows(
  xml: string,
  shared: string[],
  dateStyle: boolean[],
  date1904: boolean
): string[][] {
  const rows: string[][] = [];
  for (const rm of xml.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    if (rm[1] === undefined) continue;
    const cells: string[] = [];
    let col = 0;
    for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const inner = cm[2] ?? "";
      const ref = attrs.match(/\br="([A-Z]+)\d+"/)?.[1];
      const at = ref ? colNum(ref) : col;
      col = at + 1;
      const type = attrs.match(/\bt="([^"]+)"/)?.[1] ?? "n";
      let value = "";
      if (type === "inlineStr") {
        value = textOf(inner);
      } else {
        const text = decodeXml(inner.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1] ?? "");
        if (type === "s") value = shared[Number(text)] ?? "";
        else if (type === "b") value = text === "1" ? "TRUE" : "FALSE";
        else if (type === "str" || type === "e") value = text;
        else if (text !== "") {
          const style = Number(attrs.match(/\bs="(\d+)"/)?.[1] ?? -1);
          const num = Number(text);
          value =
            style >= 0 && dateStyle[style] && Number.isFinite(num)
              ? serialToText(num, date1904)
              : text;
        }
      }
      while (cells.length < at) cells.push("");
      cells.push(value);
    }
    if (cells.some((c) => c.trim() !== "")) rows.push(cells);
  }
  return rows;
}

/** xlsx（ArrayBuffer）→ 先頭シートの2次元配列。日付セルは 'YYYY-MM-DD' の文字列になる。 */
export async function readXlsxRows(buf: ArrayBuffer): Promise<string[][]> {
  const entries = zipIndex(buf);
  const read = (name: string) => unzipText(buf, entries.get(name));
  const workbook = await read("xl/workbook.xml");
  const rels = await read("xl/_rels/workbook.xml.rels");
  // 先頭シート（ブックの並び順）の実ファイルを rels から引く
  const rid = workbook.match(/<sheet\b[^>]*?r:id="([^"]+)"/)?.[1] ?? "";
  const target = rels.match(new RegExp(`<Relationship\\b[^>]*?Id="${rid}"[^>]*?Target="([^"]+)"`))?.[1];
  let path = target ? (target.startsWith("/") ? target.slice(1) : `xl/${target.replace(/^\.\//, "")}`) : "";
  if (!entries.has(path)) {
    path = [...entries.keys()].filter((n) => /^xl\/worksheets\/.*\.xml$/.test(n)).sort()[0] ?? "";
  }
  if (!path) throw new Error("Excelファイルにシートが見つかりませんでした。");
  const date1904 = /date1904="(1|true)"/.test(workbook);
  const [sheet, sst, styles] = await Promise.all([
    read(path),
    read("xl/sharedStrings.xml"),
    read("xl/styles.xml"),
  ]);
  return sheetRows(sheet, sharedStrings(sst), dateStyles(styles), date1904);
}
