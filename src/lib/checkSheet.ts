/**
 * 品質チェックシート（PDF）の読み取り（クライアント/サーバー共用の純粋関数）。
 *
 * 大口工場では、初品の単品完成品重量を品質チェックシートの「備考」欄に書いている
 * （例: 備考「0.043」= 0.043 kg）。シートはExcelからPDF出力したものでテキストを持つため、
 * 文字の位置から「ラベルの右隣／真下」の値を拾う。
 *   - 加工日 … 「加工日」の右隣
 *   - 図番   … 「図番」の右隣（品目CD、または子図番）
 *   - 品名   … 「品名」の右隣
 *   - 工程   … 「工程」の右隣
 *   - 重量   … 左下の「備考」枠の中（「※判定が…」の注記より上）
 *   - 検査者 … 検査結果の「検査者」列の最初の記入
 * 重量の単位は kg。「43g」のように g が付いていれば kg に直す。
 */

import { normDateStr } from "./format";

/** PDFの文字1つ分（左上原点・ページ座標）。 */
export interface SheetTextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CheckSheetRow {
  /** 'YYYY-MM-DD'。読めなければ '' */
  date: string;
  zuban: string;
  hinmei: string;
  kotei: string;
  /** 備考欄の原文 */
  bikou: string;
  /** kg。読めなければ null */
  weight: number | null;
  inspector: string;
  /** 読み取り上の注意（空なら問題なし） */
  warnings: string[];
}

/** 全角英数字・記号を半角へ、全角空白を半角へ */
export function toHalfWidth(s: string): string {
  return s
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ");
}

const clean = (s: string) => toHalfWidth(s).replace(/\s+/g, "");

/**
 * 備考欄の文字から重量(kg)を読む。
 * 「0.043」「0.043kg」「完成品重量 0.043」「43g」に対応。数値が複数あれば先頭を採る。
 */
export function parseBikouWeight(text: string): { weight: number | null; note: string } {
  const t = toHalfWidth(text).replace(/,/g, "");
  const nums = [...t.matchAll(/(\d+(?:\.\d+)?)\s*(kg|g)?/gi)];
  if (nums.length === 0) return { weight: null, note: "備考に数値がありません" };
  const [, v, unit] = nums[0];
  let w = Number(v);
  if (!Number.isFinite(w) || w <= 0) return { weight: null, note: "備考の数値が0以下です" };
  if (unit && unit.toLowerCase() === "g") w = w / 1000;
  const note = nums.length > 1 ? `備考に数値が${nums.length}つあります（先頭を採用）` : "";
  return { weight: Math.round(w * 1e6) / 1e6, note };
}

/** 1ページ分の文字から、チェックシートの項目を読み取る。 */
export function parseCheckSheet(
  items: SheetTextItem[],
  page: { width: number; height: number }
): CheckSheetRow {
  const its = items.filter((i) => i.str.trim() !== "");
  const W = page.width;
  const H = page.height;
  const warnings: string[] = [];
  const cy = (i: SheetTextItem) => i.y + i.h / 2;

  /** 左上寄りのラベル（同じ文字が複数あれば最も左上のもの） */
  const label = (name: string) =>
    its
      .filter((i) => clean(i.str) === name)
      .sort((a, b) => a.x + a.y - (b.x + b.y))[0];

  /** ラベルの右隣（同じ行）の値 */
  const rightOf = (name: string, maxDx = 0.08 * W): string => {
    const l = label(name);
    if (!l) return "";
    const hit = its
      .filter(
        (i) =>
          i !== l &&
          Math.abs(cy(i) - cy(l)) < l.h * 0.6 &&
          i.x >= l.x + l.w - 1 &&
          i.x - (l.x + l.w) < maxDx
      )
      .sort((a, b) => a.x - b.x)[0];
    return hit ? hit.str.trim() : "";
  };

  const dateRaw = rightOf("加工日");
  const date = normDateStr(toHalfWidth(dateRaw)) ?? "";
  if (!date) warnings.push("加工日が読めません");
  const zuban = clean(rightOf("図番"));
  if (!zuban) warnings.push("図番が読めません");
  const hinmei = rightOf("品名");
  const kotei = rightOf("工程");

  // 備考: 左下の「備考」ラベル（右側の検査結果表にも「備考」列があるので最も左のもの）
  let bikou = "";
  const bl = its.filter((i) => clean(i.str) === "備考").sort((a, b) => a.x - b.x)[0];
  if (bl) {
    // 枠の下端は「※判定が…」の注記。無ければラベルから 8% 下まで。
    const note = its
      .filter((i) => i.y > bl.y && i.str.trim().startsWith("※") && Math.abs(i.x - bl.x) < 0.02 * W)
      .sort((a, b) => a.y - b.y)[0];
    const bottom = note ? note.y : bl.y + 0.08 * H;
    bikou = its
      .filter(
        (i) =>
          i.y >= bl.y + bl.h * 0.8 &&
          i.y < bottom &&
          i.x >= bl.x - 0.01 * W &&
          i.x < bl.x + 0.14 * W
      )
      .sort((a, b) => a.y - b.y || a.x - b.x)
      .map((i) => i.str.trim())
      .join(" ")
      .trim();
  } else {
    warnings.push("備考欄が見つかりません");
  }
  const { weight, note } = bikou ? parseBikouWeight(bikou) : { weight: null, note: "備考が空です" };
  if (note) warnings.push(note);

  // 検査者: 「検査者」列の見出しの真下にある最初の記入
  let inspector = "";
  const il = its.filter((i) => clean(i.str) === "検査者").sort((a, b) => a.y - b.y)[0];
  if (il) {
    // 隣の「時間」列を拾わないよう、見出しの中心から見出し幅ぶん以内に中心がある記入だけ。
    const mid = il.x + il.w / 2;
    const hit = its
      .filter(
        (i) =>
          i.y > il.y + il.h * 0.8 &&
          Math.abs(i.x + i.w / 2 - mid) <= Math.max(il.w, 0.01 * W) &&
          /[^\d:.\s]/.test(i.str)
      )
      .sort((a, b) => a.y - b.y)[0];
    if (hit) {
      // 姓と名が別の文字列に分かれていることがあるので、同じ行の続きをつなげる
      inspector = its
        .filter(
          (i) =>
            Math.abs(cy(i) - cy(hit)) < hit.h * 0.6 &&
            i.x >= hit.x &&
            i.x < hit.x + 0.04 * W &&
            /[^\d:.\s]/.test(i.str)
        )
        .sort((a, b) => a.x - b.x)
        .map((i) => i.str.trim())
        .join(" ")
        .replace(/\s+/g, " ");
    }
  }

  return { date, zuban, hinmei, kotei, bikou, weight, inspector, warnings };
}
