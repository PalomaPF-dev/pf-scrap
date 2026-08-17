import { getSql } from "./neon";
import { ensureSchema } from "./schema";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** スクラップの区分（品種）。日次記録・品目マスターで共通。 */
export const KUBUN_LIST = ["銅条", "銅管", "その他"] as const;
export type Kubun = (typeof KUBUN_LIST)[number];

export interface ScrapItem {
  id: string;
  kanriZuban: string;
  hinmei: string;
  key: string;
  kubun: string;
  oyaZuban: string;
  oyaHinmei: string;
  koZuban: string;
  koHinmei: string;
  tani: string;
  koseiJuryo: number;
  kanseiJuryo: number;
  seizoBashoCD: string;
  seizoBashoMei: string;
  factory: string;
}

export interface DailyEntry {
  jikoku: string;
  busho: string;
  kikai: string;
  hinshu: string;
  kotei: string;
  weight: number;
  kirokusha: string;
  ijo: string;
}

export interface DailyRecord {
  id: string;
  recordDate: string; // YYYY-MM-DD
  factory: string;
  sekininsha: string;
  zenjitsuOk: boolean;
  hakoZanryo: number;
  kaishuSokuteichi: number | null;
  tonyuKanryo: boolean;
  shonin: string;
  biko: string;
  updatedBy: string;
  entries: DailyEntry[];
}

export interface FirstArticle {
  measuredOn: string;
  itemKey: string;
  weight: number;
  sokuteisha: string;
  /** 品目マスターの表示用（品名・理論値）。未登録は null */
  hinmei: string | null;
  kanseiJuryo: number | null;
}

export interface MonthlyInput {
  ym: string;
  zaikoDojo: number | null;
  zaikoDokan: number | null;
  zaikoSonota: number | null;
  konyuDojo: number | null;
  konyuDokan: number | null;
  konyuSonota: number | null;
  baikyaku: number | null;
}

const num = (v: any): number => (v === null || v === undefined ? 0 : Number(v));
const numOrNull = (v: any): number | null => (v === null || v === undefined ? null : Number(v));
/** DATE 列を YYYY-MM-DD 文字列へ（ドライバにより Date / string の両方があり得る） */
const dateStr = (v: any): string =>
  v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10);

function mapItem(r: any): ScrapItem {
  return {
    id: r.id,
    kanriZuban: r.kanri_zuban,
    hinmei: r.hinmei,
    key: r.key,
    kubun: r.kubun,
    oyaZuban: r.oya_zuban,
    oyaHinmei: r.oya_hinmei,
    koZuban: r.ko_zuban,
    koHinmei: r.ko_hinmei,
    tani: r.tani,
    koseiJuryo: num(r.kosei_juryo),
    kanseiJuryo: num(r.kansei_juryo),
    seizoBashoCD: r.seizo_basho_cd,
    seizoBashoMei: r.seizo_basho_mei,
    factory: r.factory,
  };
}

// ===== ② 品目マスター =====

export async function listItems(
  companyId: string,
  opts: { q?: string; factory?: string | null; limit?: number } = {}
): Promise<{ items: ScrapItem[]; total: number }> {
  await ensureSchema();
  const sql = getSql();
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 2000);
  const q = (opts.q ?? "").trim();
  const like = `%${q}%`;
  const factory = opts.factory ?? null;
  // 子図番・親図番・管理図番・KEY・品名で検索（子図番での呼び出しが主用途）
  const rows = await sql`
    SELECT *, COUNT(*) OVER() AS total FROM scrap_items
    WHERE company_id = ${companyId}
      AND (${q} = '' OR ko_zuban ILIKE ${like} OR oya_zuban ILIKE ${like}
           OR kanri_zuban ILIKE ${like} OR key ILIKE ${like}
           OR hinmei ILIKE ${like} OR ko_hinmei ILIKE ${like} OR oya_hinmei ILIKE ${like})
      AND (${factory}::text IS NULL OR factory = ${factory} OR factory = '')
    ORDER BY kanri_zuban, ko_zuban
    LIMIT ${limit}`;
  return { items: rows.map(mapItem), total: rows.length ? Number(rows[0].total) : 0 };
}

export async function getItemById(companyId: string, id: string): Promise<ScrapItem | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM scrap_items WHERE company_id = ${companyId} AND id = ${id} LIMIT 1`;
  return rows[0] ? mapItem(rows[0]) : null;
}

/** KEY×子図番で upsert。id を返す。 */
export async function upsertItem(
  companyId: string,
  it: Omit<ScrapItem, "id">
): Promise<string> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO scrap_items (
      company_id, kanri_zuban, hinmei, key, kubun, oya_zuban, oya_hinmei,
      ko_zuban, ko_hinmei, tani, kosei_juryo, kansei_juryo,
      seizo_basho_cd, seizo_basho_mei, factory
    ) VALUES (
      ${companyId}, ${it.kanriZuban}, ${it.hinmei}, ${it.key}, ${it.kubun},
      ${it.oyaZuban}, ${it.oyaHinmei}, ${it.koZuban}, ${it.koHinmei}, ${it.tani},
      ${it.koseiJuryo}, ${it.kanseiJuryo}, ${it.seizoBashoCD}, ${it.seizoBashoMei}, ${it.factory}
    )
    ON CONFLICT (company_id, key, ko_zuban) DO UPDATE SET
      kanri_zuban = EXCLUDED.kanri_zuban,
      hinmei = EXCLUDED.hinmei,
      kubun = EXCLUDED.kubun,
      oya_zuban = EXCLUDED.oya_zuban,
      oya_hinmei = EXCLUDED.oya_hinmei,
      ko_hinmei = EXCLUDED.ko_hinmei,
      tani = EXCLUDED.tani,
      kosei_juryo = EXCLUDED.kosei_juryo,
      kansei_juryo = EXCLUDED.kansei_juryo,
      seizo_basho_cd = EXCLUDED.seizo_basho_cd,
      seizo_basho_mei = EXCLUDED.seizo_basho_mei,
      factory = EXCLUDED.factory,
      updated_at = NOW()
    RETURNING id`;
  return rows[0].id as string;
}

export async function deleteItem(companyId: string, id: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`DELETE FROM scrap_items WHERE company_id = ${companyId} AND id = ${id}`;
}

// ===== ① 日次記録 =====

export async function getDailyRecord(
  companyId: string,
  recordDate: string,
  factory: string
): Promise<DailyRecord | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM scrap_daily_records
    WHERE company_id = ${companyId} AND record_date = ${recordDate} AND factory = ${factory}
    LIMIT 1`;
  const r = rows[0];
  if (!r) return null;
  const entries = await sql`
    SELECT jikoku, busho, kikai, hinshu, kotei, weight, kirokusha, ijo
    FROM scrap_daily_entries WHERE record_id = ${r.id} ORDER BY sort ASC`;
  return {
    id: r.id,
    recordDate: dateStr(r.record_date),
    factory: r.factory,
    sekininsha: r.sekininsha,
    zenjitsuOk: Boolean(r.zenjitsu_ok),
    hakoZanryo: num(r.hako_zanryo),
    kaishuSokuteichi: numOrNull(r.kaishu_sokuteichi),
    tonyuKanryo: Boolean(r.tonyu_kanryo),
    shonin: r.shonin,
    biko: r.biko,
    updatedBy: r.updated_by,
    entries: entries.map((e: any) => ({
      jikoku: e.jikoku,
      busho: e.busho,
      kikai: e.kikai,
      hinshu: e.hinshu,
      kotei: e.kotei,
      weight: num(e.weight),
      kirokusha: e.kirokusha,
      ijo: e.ijo,
    })),
  };
}

/** 日次記録票を保存（日付×工場で upsert。明細は全置換）。 */
export async function saveDailyRecord(
  companyId: string,
  rec: Omit<DailyRecord, "id">
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO scrap_daily_records (
      company_id, record_date, factory, sekininsha, zenjitsu_ok, hako_zanryo,
      kaishu_sokuteichi, tonyu_kanryo, shonin, biko, updated_by
    ) VALUES (
      ${companyId}, ${rec.recordDate}, ${rec.factory}, ${rec.sekininsha}, ${rec.zenjitsuOk},
      ${rec.hakoZanryo}, ${rec.kaishuSokuteichi}, ${rec.tonyuKanryo}, ${rec.shonin},
      ${rec.biko}, ${rec.updatedBy}
    )
    ON CONFLICT (company_id, record_date, factory) DO UPDATE SET
      sekininsha = EXCLUDED.sekininsha,
      zenjitsu_ok = EXCLUDED.zenjitsu_ok,
      hako_zanryo = EXCLUDED.hako_zanryo,
      kaishu_sokuteichi = EXCLUDED.kaishu_sokuteichi,
      tonyu_kanryo = EXCLUDED.tonyu_kanryo,
      shonin = EXCLUDED.shonin,
      biko = EXCLUDED.biko,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()
    RETURNING id`;
  const recordId = rows[0].id as string;
  await sql`DELETE FROM scrap_daily_entries WHERE record_id = ${recordId}`;
  for (let i = 0; i < rec.entries.length; i++) {
    const e = rec.entries[i];
    await sql`
      INSERT INTO scrap_daily_entries (company_id, record_id, jikoku, busho, kikai, hinshu, kotei, weight, kirokusha, ijo, sort)
      VALUES (${companyId}, ${recordId}, ${e.jikoku}, ${e.busho}, ${e.kikai}, ${e.hinshu}, ${e.kotei}, ${e.weight}, ${e.kirokusha}, ${e.ijo}, ${i})`;
  }
}

export async function deleteDailyRecord(
  companyId: string,
  recordDate: string,
  factory: string
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    DELETE FROM scrap_daily_records
    WHERE company_id = ${companyId} AND record_date = ${recordDate} AND factory = ${factory}`;
}

export interface DailyAggRow {
  recordDate: string;
  factory: string;
  sekininsha: string;
  shonin: string;
  kaishuSokuteichi: number | null;
  total: number;
  byKubun: Record<Kubun, number>;
  ijoCount: number;
}

/** 月間の日次記録集計（1日1工場1行、区分別合計つき）。 */
export async function listDailyAgg(
  companyId: string,
  ym: string,
  factory: string | null
): Promise<DailyAggRow[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT r.record_date, r.factory, r.sekininsha, r.shonin, r.kaishu_sokuteichi,
      COALESCE(SUM(e.weight), 0) AS total,
      COALESCE(SUM(e.weight) FILTER (WHERE e.hinshu = '銅条'), 0) AS w_dojo,
      COALESCE(SUM(e.weight) FILTER (WHERE e.hinshu = '銅管'), 0) AS w_dokan,
      COALESCE(SUM(e.weight) FILTER (WHERE e.hinshu NOT IN ('銅条', '銅管')), 0) AS w_sonota,
      COUNT(*) FILTER (WHERE e.ijo <> '') AS ijo_count
    FROM scrap_daily_records r
    LEFT JOIN scrap_daily_entries e ON e.record_id = r.id
    WHERE r.company_id = ${companyId}
      AND to_char(r.record_date, 'YYYY-MM') = ${ym}
      AND (${factory}::text IS NULL OR r.factory = ${factory})
    GROUP BY r.id
    ORDER BY r.record_date, r.factory`;
  return rows.map((r: any) => ({
    recordDate: dateStr(r.record_date),
    factory: r.factory,
    sekininsha: r.sekininsha,
    shonin: r.shonin,
    kaishuSokuteichi: numOrNull(r.kaishu_sokuteichi),
    total: num(r.total),
    byKubun: { 銅条: num(r.w_dojo), 銅管: num(r.w_dokan), その他: num(r.w_sonota) },
    ijoCount: Number(r.ijo_count) || 0,
  }));
}

/** 月間の日次記録合計（区分別）。⑥の突合に使う。factory 指定で自工場のみ。 */
export async function dailyMonthTotals(
  companyId: string,
  ym: string,
  factory: string | null = null
): Promise<{ total: number; byKubun: Record<Kubun, number>; days: number }> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT
      COALESCE(SUM(e.weight), 0) AS total,
      COALESCE(SUM(e.weight) FILTER (WHERE e.hinshu = '銅条'), 0) AS w_dojo,
      COALESCE(SUM(e.weight) FILTER (WHERE e.hinshu = '銅管'), 0) AS w_dokan,
      COALESCE(SUM(e.weight) FILTER (WHERE e.hinshu NOT IN ('銅条', '銅管')), 0) AS w_sonota,
      COUNT(DISTINCT r.id) AS days
    FROM scrap_daily_records r
    LEFT JOIN scrap_daily_entries e ON e.record_id = r.id
    WHERE r.company_id = ${companyId}
      AND to_char(r.record_date, 'YYYY-MM') = ${ym}
      AND (${factory}::text IS NULL OR r.factory = ${factory})`;
  const r = rows[0] ?? {};
  return {
    total: num(r.total),
    byKubun: { 銅条: num(r.w_dojo), 銅管: num(r.w_dokan), その他: num(r.w_sonota) },
    days: Number(r.days) || 0,
  };
}

// ===== ③ 初品重量測定 =====

export async function listFirstArticles(
  companyId: string,
  limit = 200
): Promise<FirstArticle[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT f.measured_on, f.item_key, f.weight, f.sokuteisha,
      (SELECT hinmei FROM scrap_items i
        WHERE i.company_id = f.company_id AND i.key = f.item_key
        ORDER BY i.ko_zuban LIMIT 1) AS hinmei,
      (SELECT kansei_juryo FROM scrap_items i
        WHERE i.company_id = f.company_id AND i.key = f.item_key
        ORDER BY i.ko_zuban LIMIT 1) AS kansei_juryo
    FROM scrap_first_articles f
    WHERE f.company_id = ${companyId}
    ORDER BY f.measured_on DESC, f.item_key
    LIMIT ${limit}`;
  return rows.map((r: any) => ({
    measuredOn: dateStr(r.measured_on),
    itemKey: r.item_key,
    weight: num(r.weight),
    sokuteisha: r.sokuteisha,
    hinmei: r.hinmei ?? null,
    kanseiJuryo: numOrNull(r.kansei_juryo),
  }));
}

export async function upsertFirstArticle(
  companyId: string,
  fa: { measuredOn: string; itemKey: string; weight: number; sokuteisha: string }
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO scrap_first_articles (company_id, measured_on, item_key, weight, sokuteisha)
    VALUES (${companyId}, ${fa.measuredOn}, ${fa.itemKey}, ${fa.weight}, ${fa.sokuteisha})
    ON CONFLICT (company_id, measured_on, item_key) DO UPDATE SET
      weight = EXCLUDED.weight, sokuteisha = EXCLUDED.sokuteisha`;
}

export async function deleteFirstArticle(
  companyId: string,
  measuredOn: string,
  itemKey: string
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    DELETE FROM scrap_first_articles
    WHERE company_id = ${companyId} AND measured_on = ${measuredOn} AND item_key = ${itemKey}`;
}

// ===== ④ McFrame取込 =====

/** 年月×KEY で upsert（再取込は上書き）。取込件数を返す。 */
export async function upsertMcframeQty(
  companyId: string,
  rows: { ym: string; itemKey: string; qty: number }[]
): Promise<number> {
  await ensureSchema();
  const sql = getSql();
  let count = 0;
  for (const r of rows) {
    await sql`
      INSERT INTO scrap_mcframe_qty (company_id, ym, item_key, qty)
      VALUES (${companyId}, ${r.ym}, ${r.itemKey}, ${r.qty})
      ON CONFLICT (company_id, ym, item_key) DO UPDATE SET
        qty = EXCLUDED.qty, updated_at = NOW()`;
    count++;
  }
  return count;
}

// ===== ⑤ 月次入力 =====

export async function listMonthlyInputs(
  companyId: string,
  year: number
): Promise<MonthlyInput[]> {
  await ensureSchema();
  const sql = getSql();
  const prefix = `${year}-%`;
  const rows = await sql`
    SELECT * FROM scrap_monthly_inputs
    WHERE company_id = ${companyId} AND ym LIKE ${prefix}
    ORDER BY ym`;
  return rows.map((r: any) => ({
    ym: r.ym,
    zaikoDojo: numOrNull(r.zaiko_dojo),
    zaikoDokan: numOrNull(r.zaiko_dokan),
    zaikoSonota: numOrNull(r.zaiko_sonota),
    konyuDojo: numOrNull(r.konyu_dojo),
    konyuDokan: numOrNull(r.konyu_dokan),
    konyuSonota: numOrNull(r.konyu_sonota),
    baikyaku: numOrNull(r.baikyaku),
  }));
}

export async function getMonthlyInput(
  companyId: string,
  ym: string
): Promise<MonthlyInput | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM scrap_monthly_inputs
    WHERE company_id = ${companyId} AND ym = ${ym} LIMIT 1`;
  const r = rows[0];
  if (!r) return null;
  return {
    ym: r.ym,
    zaikoDojo: numOrNull(r.zaiko_dojo),
    zaikoDokan: numOrNull(r.zaiko_dokan),
    zaikoSonota: numOrNull(r.zaiko_sonota),
    konyuDojo: numOrNull(r.konyu_dojo),
    konyuDokan: numOrNull(r.konyu_dokan),
    konyuSonota: numOrNull(r.konyu_sonota),
    baikyaku: numOrNull(r.baikyaku),
  };
}

export async function saveMonthlyInput(companyId: string, m: MonthlyInput): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO scrap_monthly_inputs (
      company_id, ym, zaiko_dojo, zaiko_dokan, zaiko_sonota,
      konyu_dojo, konyu_dokan, konyu_sonota, baikyaku
    ) VALUES (
      ${companyId}, ${m.ym}, ${m.zaikoDojo}, ${m.zaikoDokan}, ${m.zaikoSonota},
      ${m.konyuDojo}, ${m.konyuDokan}, ${m.konyuSonota}, ${m.baikyaku}
    )
    ON CONFLICT (company_id, ym) DO UPDATE SET
      zaiko_dojo = EXCLUDED.zaiko_dojo,
      zaiko_dokan = EXCLUDED.zaiko_dokan,
      zaiko_sonota = EXCLUDED.zaiko_sonota,
      konyu_dojo = EXCLUDED.konyu_dojo,
      konyu_dokan = EXCLUDED.konyu_dokan,
      konyu_sonota = EXCLUDED.konyu_sonota,
      baikyaku = EXCLUDED.baikyaku,
      updated_at = NOW()`;
}

// ===== ポータル配信の工場・職場マスタ =====

export interface PortalFactory {
  code: string;
  name: string;
  sort: number;
}

export interface PortalWorkplace {
  code: string;
  name: string;
  factoryCode: string;
  sort: number;
}

/** ポータルからの工場・職場マスタを upsert（配信は upsert のみ。自動削除はしない）。 */
export async function syncPortalMasters(
  companyId: string,
  factories: PortalFactory[],
  workplaces: PortalWorkplace[]
): Promise<{ factories: number; workplaces: number; skipped: number }> {
  await ensureSchema();
  const sql = getSql();
  let f = 0;
  let w = 0;
  for (const x of factories) {
    await sql`
      INSERT INTO portal_factories (company_id, code, name, sort)
      VALUES (${companyId}, ${x.code}, ${x.name}, ${x.sort})
      ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name, sort = EXCLUDED.sort`;
    f++;
  }
  for (const x of workplaces) {
    await sql`
      INSERT INTO portal_workplaces (company_id, code, name, factory_code, sort)
      VALUES (${companyId}, ${x.code}, ${x.name}, ${x.factoryCode}, ${x.sort})
      ON CONFLICT (company_id, code) DO UPDATE SET
        name = EXCLUDED.name, factory_code = EXCLUDED.factory_code, sort = EXCLUDED.sort`;
    w++;
  }
  return { factories: f, workplaces: w, skipped: 0 };
}

/** 工場の入力候補。ポータル配信のマスタ＋既存記録の工場名をマージして返す。 */
export async function listFactoryOptions(companyId: string): Promise<string[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT name, sort FROM portal_factories WHERE company_id = ${companyId}
    ORDER BY sort ASC, name ASC`;
  const names: string[] = rows.map((r: any) => String(r.name));
  const used = await sql`
    SELECT DISTINCT factory FROM scrap_daily_records
    WHERE company_id = ${companyId} AND factory <> '' ORDER BY factory`;
  for (const u of used) {
    const name = String(u.factory);
    if (!names.includes(name)) names.push(name);
  }
  return names;
}
