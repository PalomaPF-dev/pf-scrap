/**
 * 初品重量測定のExcel/CSVから「品目CD × 測定日 × 実測重量」を取り出す（純粋関数）。
 *
 * 現場のブックは様式がまちまちなので、次のいずれでも読めるようにする。
 *   A. 品目が行・日付が列（例: 管理図番 / 品名 / 職場名 / 構成重量 / 完成重量 / 日付…）
 *   B. 日付が上段・列見出しが「完成重量」（例: 日付ごとに 加工数 と 完成重量 が並ぶ表）
 *   C. 正規化: 品目CD, （格納場所CD/製造場所CD）, 測定日, 実測重量
 * 「生産なし」「0」「空欄」「#REF!」は測定していない印なので飛ばす。
 */
import { normDateStr } from "./format";

export interface FaRecord {
  hinmokuCD: string;
  /** 分かれば格納場所CD（無ければ空。サーバー側で品目マスターから解決する） */
  kakunoCD: string;
  /** 分かれば製造場所CD（格納場所CDが無いブック用） */
  seizoBashoCD: string;
  measuredOn: string;
  weight: string;
}

export interface FaExtract {
  records: FaRecord[];
  /** 読めたシートと件数（取込結果の内訳表示用） */
  sheets: { name: string; count: number }[];
  /** 測定なし（空欄・0・生産なし等）として飛ばしたセル数 */
  skipped: number;
}

/** 見出し照合用の正規化（全角英数字・空白・引用符のゆれを吸収）。 */
const norm = (v: unknown) =>
  String(v ?? "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[\s　"']/g, "")
    .toLowerCase();

const has = (v: string, ...names: string[]) => names.some((n) => norm(v).includes(n));

/** Excelのシリアル値（1900年方式）→ 'YYYY-MM-DD'。日付らしくない数値は null。 */
function serialDate(v: string): string | null {
  // 時刻付きの日付セル（46170.5 など）も日付として扱う
  if (!/^\d{4,6}(\.\d+)?$/.test(v.trim())) return null;
  const n = Number(v);
  // 1954-10-03（20000）〜 2117年ごろ（80000）の範囲だけ日付とみなす
  if (n < 20000 || n > 80000) return null;
  const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(
    d.getUTCDate()
  ).padStart(2, "0")}`;
}

/** セルが日付なら 'YYYY-MM-DD'（日付文字列・Excelシリアルの両対応）。 */
function cellDate(v: string): string | null {
  return normDateStr(v) ?? serialDate(v);
}

/** 測定値セル → 数値文字列。測定していない印（空欄・0・生産なし・#REF! 等）は null。 */
function measureValue(v: string): string | null {
  const t = String(v ?? "").trim();
  if (t === "") return null;
  const n = Number(t.replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return String(n);
}

/** 1シートから測定値を取り出す。読めない様式なら空配列。 */
function fromSheet(rows: string[][], skipped: { n: number }): FaRecord[] {
  // 品目CDの見出し行を探す（先頭10行まで）
  let head = -1;
  let idxItem = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const j = rows[i].findIndex((v) => has(v, "管理図番", "品目cd", "品目コード", "itm_cd"));
    if (j >= 0) {
      head = i;
      idxItem = j;
      break;
    }
  }
  if (head < 0) return [];
  const h = rows[head];
  const find = (...names: string[]) => h.findIndex((v) => has(v, ...names));
  const idxKakuno = find("格納場所cd", "strg_loc_cd");
  const idxSeizo = find("製造場所cd", "mfg_loc_cd");

  // 測定値の列 → 測定日
  const cols = new Map<number, string>();
  for (let c = idxItem + 1; c < h.length; c++) {
    const d = cellDate(h[c]);
    if (d) {
      cols.set(c, d); // A: 見出しそのものが日付
      continue;
    }
    // B: 見出しは「完成重量」で、日付はすぐ左の列（加工数など）の上にある
    //    ＝ 日付ごとに「加工数 / 完成重量」が並ぶ様式。
    //    日付列そのものの見出しが重量系の表は、単品重量ではなく日合計を並べた表なので採らない
    //    （例: 日付ごとに完成重量の合計kgが並ぶブロック。単価と桁が2〜3桁違う）。
    if (
      c > 0 &&
      has(h[c], "完成重量", "実測重量", "実測値", "測定値") &&
      !has(h[c], "構成重量", "理論") &&
      !has(h[c - 1], "完成重量", "構成重量", "スクラップ", "実測")
    ) {
      let found: string | null = null;
      for (let r = head - 1; r >= 0 && !found; r--) found = cellDate(rows[r]?.[c - 1] ?? "");
      if (found) cols.set(c, found);
    }
  }

  const out: FaRecord[] = [];
  const push = (item: string, kakuno: string, seizo: string, date: string, raw: string) => {
    const w = measureValue(raw);
    if (w === null) {
      skipped.n++;
      return;
    }
    out.push({
      hinmokuCD: item,
      kakunoCD: kakuno,
      seizoBashoCD: seizo,
      measuredOn: date,
      weight: w,
    });
  };

  if (cols.size > 0) {
    for (let r = head + 1; r < rows.length; r++) {
      const row = rows[r];
      const item = String(row[idxItem] ?? "").trim();
      if (!item || has(item, "管理図番", "品目cd", "合計")) continue;
      const kakuno = idxKakuno >= 0 ? String(row[idxKakuno] ?? "").trim() : "";
      const seizo = idxSeizo >= 0 ? String(row[idxSeizo] ?? "").trim() : "";
      for (const [c, date] of cols) push(item, kakuno, seizo, date, String(row[c] ?? ""));
    }
    return out;
  }

  // C: 正規化様式（測定日の列 + 実測重量の列）
  const idxDate = find("測定日", "日付", "計上日");
  const idxWeight = h.findIndex(
    (v) => has(v, "実測", "完成重量", "重量") && !has(v, "構成重量", "理論")
  );
  if (idxDate < 0 || idxWeight < 0) return [];
  for (let r = head + 1; r < rows.length; r++) {
    const row = rows[r];
    const item = String(row[idxItem] ?? "").trim();
    const date = cellDate(String(row[idxDate] ?? ""));
    if (!item || !date) continue;
    push(
      item,
      idxKakuno >= 0 ? String(row[idxKakuno] ?? "").trim() : "",
      idxSeizo >= 0 ? String(row[idxSeizo] ?? "").trim() : "",
      date,
      String(row[idxWeight] ?? "")
    );
  }
  return out;
}

/**
 * ブック全体（全シート）から測定値を取り出し、同じ測定の重複を畳む。
 * 同じ品目・同じ日が複数シートに出てくる（まとめ表と職場別表など）ため、
 * 場所の手がかり（格納場所CD/製造場所CD）を持つ行を優先して1件にする。
 */
export function extractFirstArticles(
  tables: { name: string; rows: string[][] }[]
): FaExtract {
  const skipped = { n: 0 };
  const sheets: { name: string; count: number }[] = [];
  const byItemDate = new Map<string, FaRecord[]>();
  for (const t of tables) {
    const rows = fromSheet(t.rows, skipped);
    if (rows.length > 0) sheets.push({ name: t.name, count: rows.length });
    for (const r of rows) {
      const k = `${r.hinmokuCD}\t${r.measuredOn}`;
      const list = byItemDate.get(k);
      if (list) list.push(r);
      else byItemDate.set(k, [r]);
    }
  }
  const records: FaRecord[] = [];
  for (const list of byItemDate.values()) {
    const hinted = list.filter((r) => r.kakunoCD || r.seizoBashoCD);
    const use = hinted.length > 0 ? hinted : list.slice(0, 1);
    const seen = new Set<string>();
    for (const r of use) {
      const k = `${r.kakunoCD}\t${r.seizoBashoCD}`;
      if (seen.has(k)) continue;
      seen.add(k);
      records.push(r);
    }
  }
  records.sort(
    (a, b) => a.measuredOn.localeCompare(b.measuredOn) || a.hinmokuCD.localeCompare(b.hinmokuCD)
  );
  return { records, sheets, skipped: skipped.n };
}
