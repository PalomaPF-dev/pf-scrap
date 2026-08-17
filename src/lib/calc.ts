import { getSql } from "./neon";
import { ensureSchema } from "./schema";
import {
  dailyMonthTotals,
  getMonthlyInput,
  KUBUN_LIST,
  type Kubun,
  type MonthlyInput,
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

/** 対象月の品目別計算。加工数があるKEYごとに1行。 */
export async function monthlyItemRows(companyId: string, ym: string): Promise<MonthlyItemRow[]> {
  await ensureSchema();
  const sql = getSql();
  // 単品完成重量は「対象月末以前の最新」の初品実測値を使う（未測定はマスター理論値）
  const rows = await sql`
    SELECT m.item_key, m.qty,
      i.kubun, i.hinmei, i.kansei_juryo AS theo_unit, i.kosei_sum, i.cnt,
      fa.weight AS fa_weight, fa.measured_on AS fa_date
    FROM scrap_mcframe_qty m
    LEFT JOIN LATERAL (
      SELECT (ARRAY_AGG(kubun ORDER BY ko_zuban))[1] AS kubun,
             (ARRAY_AGG(hinmei ORDER BY ko_zuban))[1] AS hinmei,
             (ARRAY_AGG(kansei_juryo ORDER BY ko_zuban))[1] AS kansei_juryo,
             SUM(kosei_juryo) AS kosei_sum,
             COUNT(*) AS cnt
      FROM scrap_items s
      WHERE s.company_id = m.company_id AND s.key = m.item_key
    ) i ON true
    LEFT JOIN LATERAL (
      SELECT weight, measured_on FROM scrap_first_articles f
      WHERE f.company_id = m.company_id AND f.item_key = m.item_key
        AND f.measured_on <= ((m.ym || '-01')::date + interval '1 month' - interval '1 day')
      ORDER BY f.measured_on DESC LIMIT 1
    ) fa ON true
    WHERE m.company_id = ${companyId} AND m.ym = ${ym}`;
  const out: MonthlyItemRow[] = rows.map((r: any) => {
    const qty = Number(r.qty) || 0;
    const found = Number(r.cnt) > 0;
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

const zaikoOf = (m: MonthlyInput | null, kb: Kubun): number | null => {
  if (!m) return null;
  const v = kb === "銅条" ? m.zaikoDojo : kb === "銅管" ? m.zaikoDokan : m.zaikoSonota;
  return v ?? 0;
};
const konyuOf = (m: MonthlyInput | null, kb: Kubun): number | null => {
  if (!m) return null;
  const v = kb === "銅条" ? m.konyuDojo : kb === "銅管" ? m.konyuDokan : m.konyuSonota;
  return v ?? 0;
};
const sumZaiko = (m: MonthlyInput | null): number | null =>
  m ? (m.zaikoDojo ?? 0) + (m.zaikoDokan ?? 0) + (m.zaikoSonota ?? 0) : null;
const sumKonyu = (m: MonthlyInput | null): number | null =>
  m ? (m.konyuDojo ?? 0) + (m.konyuDokan ?? 0) + (m.konyuSonota ?? 0) : null;

/** 月次サマリー（区分別 + 全体）と ⑥⑦ の突合結果。 */
export async function monthlySummary(companyId: string, ym: string): Promise<MonthlySummary> {
  const [inp, inpNext, itemRows, daily] = await Promise.all([
    getMonthlyInput(companyId, ym),
    getMonthlyInput(companyId, nextYm(ym)),
    monthlyItemRows(companyId, ym),
    dailyMonthTotals(companyId, ym),
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
  for (const r of itemRows) {
    const kb = (KUBUN_LIST as readonly string[]).includes(r.kubun) ? r.kubun : "その他";
    perKubun[kb].usageBom += r.usage;
    perKubun[kb].finished += r.finished;
    perKubun["全体"].usageBom += r.usage;
    perKubun["全体"].finished += r.finished;
  }
  for (const kb of KUBUN_LIST) {
    const t = perKubun[kb];
    t.zaiko = zaikoOf(inp, kb);
    t.konyu = konyuOf(inp, kb);
    t.zaikoNext = zaikoOf(inpNext, kb);
    if (t.zaiko !== null && t.konyu !== null && t.zaikoNext !== null) {
      t.usageInv = t.zaiko + t.konyu - t.zaikoNext;
    }
    const usage = t.usageInv !== null ? t.usageInv : t.usageBom;
    t.method = t.usageInv !== null ? "在庫法" : "構成法";
    t.scrapTheo = usage - t.finished;
  }
  {
    const t = perKubun["全体"];
    t.zaiko = sumZaiko(inp);
    t.konyu = sumKonyu(inp);
    t.zaikoNext = sumZaiko(inpNext);
    if (t.zaiko !== null && t.konyu !== null && t.zaikoNext !== null) {
      t.usageInv = t.zaiko + t.konyu - t.zaikoNext;
    }
    const usage = t.usageInv !== null ? t.usageInv : t.usageBom;
    t.method = t.usageInv !== null ? "在庫法" : "構成法";
    t.scrapTheo = usage - t.finished;
  }

  const baikyaku = inp?.baikyaku ?? null;
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

/** 年間推移（全体）。データのある月だけ返す。 */
export async function yearSummary(companyId: string, year: number): Promise<YearRow[]> {
  const out: YearRow[] = [];
  for (let m = 1; m <= 12; m++) {
    const ym = `${year}-${String(m).padStart(2, "0")}`;
    const s = await monthlySummary(companyId, ym);
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
      scrapTheo: g.zaiko !== null || s.itemRows.length ? g.scrapTheo : null,
      baikyaku: s.baikyaku,
      daily: s.daily.days ? s.daily.total : null,
      diff7sell: s.diff7sell,
      diff6: s.diff6,
    });
  }
  return out;
}
