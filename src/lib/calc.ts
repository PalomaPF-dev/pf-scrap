import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import {
  dailyMonthTotals,
  getMonthlyInput,
  monthlyAdjSums,
  monthlyProcureSums,
  KUBUN_LIST,
  type Kubun,
} from "./db";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * 集計・照合の計算ロジック（月次集計Excelの式を踏襲）。
 *
 *   使用量(在庫法)   = 月初在庫 + 購入重量 − 翌月月初在庫
 *   使用量(構成法)   = Σ(加工数 × 構成重量)          … McFrame取込 × 品目マスター
 *   完成重量         = Σ(加工数 × 単品完成重量)       … 単品完成重量は初品実測を優先
 *   理論スクラップ   = 使用量 − 完成重量 (在庫法があれば在庫法、なければ構成法)
 *   ⑥ 売却 − 日次記録合計
 *   ⑦ 売却 − 理論スクラップ (=Excelの「売量vs理論」) / 日次記録 − 理論スクラップ
 */

export interface MonthlyItemRow {
  itemKey: string;
  hinmei: string | null;
  kubun: string;
  found: boolean;
  qty: number;
  unitFinished: number;
  unitSource: "実測" | "理論" | "未登録";
  faDate: string | null;
  usage: number;
  finished: number;
  scrap: number;
}

/**
 * 対象月の品目別計算。加工数があるKEYごとに1行。
 * factory 指定でその工場の品目のみ（null=全社）。
 * 単品完成重量は「対象月末以前の最新の承認済み初品実測」を優先（無ければマスター理論値）。
 */
export async function monthlyItemRows(
  companyId: string,
  ym: string,
  factory: string | null = null
): Promise<MonthlyItemRow[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT m.item_key, m.qty,
      i.kubun, i.hinmei, i.kansei_juryo AS theo_unit, i.kosei_sum, i.cnt, i.all_cnt,
      fa.weight AS fa_weight, fa.measured_on AS fa_date
    FROM scrap_mcframe_qty m
    LEFT JOIN LATERAL (
      SELECT (ARRAY_AGG(kubun ORDER BY ko_zuban)) [1] AS kubun,
             (ARRAY_AGG(hinmei ORDER BY ko_zuban)) [1] AS hinmei,
             (ARRAY_AGG(kansei_juryo ORDER BY ko_zuban)) [1] AS kansei_juryo,
             SUM(kosei_juryo) FILTER (WHERE ${factory}::text IS NULL OR factory = ${factory}) AS kosei_sum,
             COUNT(*) FILTER (WHERE ${factory}::text IS NULL OR factory = ${factory}) AS cnt,
             COUNT(*) AS all_cnt
      FROM scrap_items s
      WHERE s.company_id = m.company_id AND s.key = m.item_key
    ) i ON true
    LEFT JOIN LATERAL (
      SELECT weight, measured_on FROM scrap_first_articles f
      WHERE f.company_id = m.company_id AND f.item_key = m.item_key
        AND f.status = 'approved'
        AND f.measured_on <= ((m.ym || '-01')::date + interval '1 month' - interval '1 day')
      ORDER BY f.measured_on DESC LIMIT 1
    ) fa ON true
    WHERE m.company_id = ${companyId} AND m.ym = ${ym}
      AND (${factory}::text IS NULL OR COALESCE(i.cnt, 0) > 0)`;
  const out: MonthlyItemRow[] = rows.map((r: any) => {
    const qty = Number(r.qty) || 0;
    const found = Number(r.all_cnt) > 0;
    const theoUnit = Number(r.theo_unit) || 0;
    const faWeight = r.fa_weight === null || r.fa_weight === undefined ? null : Number(r.fa_weight);
    const unitFinished = faWeight ?? theoUnit;
    const usage = qty * (Number(r.kosei_sum) || 0);
    const finished = qty * unitFinished;
    return {
      itemKey: r.item_key,
      hinmei: r.hinmei ?? null,
      kubun: found ? r.kubun ?? "その他" : "その他",
      found,
      qty,
      unitFinished,
      unitSource: faWeight !== null ? "実測" : found ? "理論" : "未登録",
      faDate:
        r.fa_date instanceof Date
          ? r.fa_date.toISOString().slice(0, 10)
          : r.fa_date
            ? String(r.fa_date).slice(0, 10)
            : null,
      usage,
      finished,
      scrap: usage - finished,
    };
  });
  out.sort((a, b) => b.scrap - a.scrap);
  return out;
}

export interface KubunSummary {
  zaiko: number | null;
  konyu: number | null;
  zaikoNext: number | null;
  usageInv: number | null;
  usageBom: number;
  finished: number;
  scrapTheo: number | null;
  method: "在庫法" | "構成法" | null;
}

export interface MonthlySummary {
  ym: string;
  perKubun: Record<string, KubunSummary>;
  itemRows: MonthlyItemRow[];
  daily: { total: number; byKind: { 上銅: number; 銅ダライ: number; その他: number }; days: number };
  baikyaku: number | null;
  diff6: number | null;
  rate6: number | null;
  diff7sell: number | null;
  rate7sell: number | null;
  diff7daily: number | null;
  rate7daily: number | null;
}

const nextYm = (ym: string): string => {
  const [y, m] = ym.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

const prevYmOf = (ym: string): string => {
  const [y, m] = ym.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

type KubunAmounts = { 銅条: number; 銅管: number; その他: number };

/** 対象月の使用量(構成法)を区分別に集計。 */
async function usageBomByKubun(
  companyId: string,
  ym: string,
  factory: string | null
): Promise<KubunAmounts> {
  const rows = await monthlyItemRows(companyId, ym, factory);
  const out: KubunAmounts = { 銅条: 0, 銅管: 0, その他: 0 };
  for (const r of rows) {
    const kb = (KUBUN_LIST as readonly string[]).includes(r.kubun) ? (r.kubun as Kubun) : "その他";
    out[kb] += r.usage;
  }
  return out;
}

/**
 * 対象月の購入重量（区分別）。日次調達データがあればその月間集計を優先し、
 * 無い月は月次保存値（過去データ取込分）を使う。どちらも無ければ null。
 */
async function effectiveKonyu(
  companyId: string,
  ym: string,
  factory: string | null
): Promise<KubunAmounts | null> {
  const p = await monthlyProcureSums(companyId, ym, factory);
  if (p.cnt > 0) return { 銅条: p.konyuDojo, 銅管: p.konyuDokan, その他: p.konyuSonota };
  const inp = await getMonthlyInput(companyId, ym, factory);
  if (inp && (inp.konyuDojo !== null || inp.konyuDokan !== null || inp.konyuSonota !== null)) {
    return { 銅条: inp.konyuDojo ?? 0, 銅管: inp.konyuDokan ?? 0, その他: inp.konyuSonota ?? 0 };
  }
  return null;
}

/**
 * 月初在庫（区分別）の解決。
 * - 月次保存値（棚卸で確定した月初在庫＝アンカー）があればそれを使う
 * - 無ければ前月から理論ロール: 前月月初 + 前月購入 − 前月使用量(構成法) + 前月在庫補正
 * - アンカーが見つからない場合（18か月まで遡索）は null（不明）
 */
async function resolveZaiko(
  companyId: string,
  ym: string,
  factory: string | null,
  depth = 0
): Promise<KubunAmounts | null> {
  const inp = await getMonthlyInput(companyId, ym, factory);
  if (inp && (inp.zaikoDojo !== null || inp.zaikoDokan !== null || inp.zaikoSonota !== null)) {
    return { 銅条: inp.zaikoDojo ?? 0, 銅管: inp.zaikoDokan ?? 0, その他: inp.zaikoSonota ?? 0 };
  }
  if (depth >= 18) return null;
  const pm = prevYmOf(ym);
  const prev = await resolveZaiko(companyId, pm, factory, depth + 1);
  if (!prev) return null;
  const konyu = await effectiveKonyu(companyId, pm, factory);
  if (!konyu) return null; // 前月の購入が不明なら理論ロールできない
  const usage = await usageBomByKubun(companyId, pm, factory);
  const adj = await monthlyAdjSums(companyId, pm, factory);
  return {
    銅条: prev.銅条 + konyu.銅条 - usage.銅条 + adj.銅条,
    銅管: prev.銅管 + konyu.銅管 - usage.銅管 + adj.銅管,
    その他: prev.その他 + konyu.その他 - usage.その他 + adj.その他,
  };
}

/** 月次サマリー（区分別 + 全体）と ⑥⑦ の突合結果。factory 指定でその工場、null=全社合算。 */
export async function monthlySummary(
  companyId: string,
  ym: string,
  factory: string | null = null
): Promise<MonthlySummary> {
  const [inp, itemRows, daily, procure] = await Promise.all([
    getMonthlyInput(companyId, ym, factory),
    monthlyItemRows(companyId, ym, factory),
    dailyMonthTotals(companyId, ym, factory),
    monthlyProcureSums(companyId, ym, factory),
  ]);
  const [zaiko, zaikoNext, konyu] = await Promise.all([
    resolveZaiko(companyId, ym, factory),
    resolveZaiko(companyId, nextYm(ym), factory),
    effectiveKonyu(companyId, ym, factory),
  ]);

  const perKubun: Record<string, KubunSummary> = {};
  for (const kb of [...KUBUN_LIST, "全体"]) {
    perKubun[kb] = {
      zaiko: null,
      konyu: null,
      zaikoNext: null,
      usageInv: null,
      usageBom: 0,
      finished: 0,
      scrapTheo: null,
      method: null,
    };
  }
  const hasBom = itemRows.length > 0;
  for (const r of itemRows) {
    const kb = (KUBUN_LIST as readonly string[]).includes(r.kubun) ? r.kubun : "その他";
    perKubun[kb].usageBom += r.usage;
    perKubun["全体"].usageBom += r.usage;
    perKubun[kb].finished += r.finished;
    perKubun["全体"].finished += r.finished;
  }
  for (const kb of KUBUN_LIST) {
    const t = perKubun[kb];
    t.zaiko = zaiko ? zaiko[kb] : null;
    t.konyu = konyu ? konyu[kb] : null;
    t.zaikoNext = zaikoNext ? zaikoNext[kb] : null;
    if (t.zaiko !== null && t.konyu !== null && t.zaikoNext !== null) {
      t.usageInv = t.zaiko + t.konyu - t.zaikoNext;
    }
    const usage = t.usageInv !== null ? t.usageInv : t.usageBom;
    t.method = t.usageInv !== null ? "在庫法" : "構成法";
    // 完成重量が算出できない月（McFrame加工数が未取込）は理論スクラップも不明とする。
    // 0扱いにすると「使用量まるごとがスクラップ」という誤った数字になる。
    t.scrapTheo = hasBom ? usage - t.finished : null;
  }
  {
    const t = perKubun["全体"];
    const sum = (a: KubunAmounts | null) => (a ? a.銅条 + a.銅管 + a.その他 : null);
    t.zaiko = sum(zaiko);
    t.konyu = sum(konyu);
    t.zaikoNext = sum(zaikoNext);
    if (t.zaiko !== null && t.konyu !== null && t.zaikoNext !== null) {
      t.usageInv = t.zaiko + t.konyu - t.zaikoNext;
    }
    const usage = t.usageInv !== null ? t.usageInv : t.usageBom;
    t.method = t.usageInv !== null ? "在庫法" : "構成法";
    t.scrapTheo = hasBom ? usage - t.finished : null;
  }

  // 売却数量: 日次調達の月間集計を優先（無い月は月次保存値）
  const baikyaku =
    procure.cnt > 0 && procure.baikyaku !== null ? procure.baikyaku : (inp?.baikyaku ?? null);
  const dailyTotal = daily.total;
  const scrapTheo = perKubun["全体"].scrapTheo;

  return {
    ym,
    perKubun,
    itemRows,
    daily,
    baikyaku,
    // ⑥ 売却 vs 日次記録
    diff6: baikyaku !== null ? baikyaku - dailyTotal : null,
    rate6: baikyaku !== null && dailyTotal ? (baikyaku - dailyTotal) / dailyTotal : null,
    // ⑦ 売却 vs 理論 (Excel「売量vs理論」) / 日次 vs 理論
    diff7sell: baikyaku !== null && scrapTheo !== null ? baikyaku - scrapTheo : null,
    rate7sell: baikyaku !== null && scrapTheo ? (baikyaku - scrapTheo) / scrapTheo : null,
    diff7daily: scrapTheo !== null ? dailyTotal - scrapTheo : null,
    rate7daily: scrapTheo ? (dailyTotal - scrapTheo) / scrapTheo : null,
  };
}

export interface YearRow {
  ym: string;
  zaiko: number | null;
  konyu: number | null;
  usage: number | null;
  usageBom: number | null;
  finished: number | null;
  scrapTheo: number | null;
  baikyaku: number | null;
  daily: number | null;
  diff7sell: number | null;
  diff6: number | null;
}

/** 年間推移（全体）。データのある月だけ返す。factory 指定でその工場、null=全社合算。 */
export async function yearSummary(
  companyId: string,
  year: number,
  factory: string | null = null
): Promise<YearRow[]> {
  const out: YearRow[] = [];
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${String(m).padStart(2, "0")}`;
    const s = await monthlySummary(companyId, ym, factory);
    const g = s.perKubun["全体"];
    const hasData = s.baikyaku !== null || g.zaiko !== null || s.itemRows.length > 0 || s.daily.days > 0;
    if (!hasData) continue;
    out.push({
      ym,
      zaiko: g.zaiko,
      konyu: g.konyu,
      usage: g.usageInv !== null ? g.usageInv : s.itemRows.length ? g.usageBom : null,
      usageBom: s.itemRows.length ? g.usageBom : null,
      finished: s.itemRows.length ? g.finished : null,
      scrapTheo: s.itemRows.length ? g.scrapTheo : null,
      baikyaku: s.baikyaku,
      daily: s.daily.days ? s.daily.total : null,
      diff7sell: s.diff7sell,
      diff6: s.diff6,
    });
  }
  return out;
}
