import { getSql } from "./neon";
import { ensureSchema } from "./schema";

/* eslint-disable @typescript-eslint/no-explicit-any */

// 型・定数はクライアント/サーバー共用の scrapTypes.ts に分離（ここから再エクスポート）
export {
  KUBUN_LIST,
  SCALE_KIND_LIST,
  DAILY_STATUS_LABEL,
  FA_STATUS_LABEL,
  BAG_STATUS_LABEL,
  BAG_TARGET_KG,
  bagGap,
  bagWeight,
  type BagStatus,
  type ScrapBag,
  type FaStatus,
  type FirstArticle,
  type Kubun,
  type ScaleKind,
  type DailyStatus,
  type ScrapItem,
  type ScrapKind,
  type DailyEntry,
  type DailyRecord,
  type Scale,
} from "./scrapTypes";
import {
  type ScrapBag as _ScrapBag,
  type BagStatus as _BagStatus,
  type FirstArticle as _FirstArticle,
  type FaStatus as _FaStatus,
  type ScrapItem as _ScrapItem,
  type ScrapKind as _ScrapKind,
  type DailyEntry as _DailyEntry,
  type DailyRecord as _DailyRecord,
  type DailyStatus as _DailyStatus,
  type Scale as _Scale,
} from "./scrapTypes";
type ScrapBag = _ScrapBag;
type BagStatus = _BagStatus;
type ScrapItem = _ScrapItem;
type ScrapKind = _ScrapKind;
type FirstArticle = _FirstArticle;
type FaStatus = _FaStatus;
type DailyEntry = _DailyEntry;
type DailyRecord = _DailyRecord;
type DailyStatus = _DailyStatus;
type Scale = _Scale;

export interface MonthlyInput {
  ym: string;
  /** 工場（大口工場/直方工場…）。旧データは ''（全社扱い） */
  factory: string;
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
    kakunoCD: r.kakuno_cd ?? "",
    kakunoMei: r.kakuno_mei ?? "",
    factory: r.factory,
  };
}

// ===== ② 品目マスター =====

export async function listItems(
  companyId: string,
  opts: {
    q?: string;
    factory?: string | null;
    /** 製造場所名（職場）での絞り込み。null/空なら絞り込まない */
    workplace?: string | null;
    limit?: number;
  } = {}
): Promise<{ items: ScrapItem[]; total: number }> {
  await ensureSchema();
  const sql = getSql();
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 2000);
  const q = (opts.q ?? "").trim();
  const like = `%${q}%`;
  const factory = opts.factory ?? null;
  const workplace = (opts.workplace ?? "").trim() || null;
  // 子図番・親図番・品目CD・格納場所CD・品名で検索（子図番での呼び出しが主用途）
  const rows = await sql`
    SELECT *, COUNT(*) OVER() AS total FROM scrap_items
    WHERE company_id = ${companyId}
      AND (${q} = '' OR ko_zuban ILIKE ${like} OR oya_zuban ILIKE ${like}
           OR kanri_zuban ILIKE ${like} OR kakuno_cd ILIKE ${like}
           OR hinmei ILIKE ${like} OR ko_hinmei ILIKE ${like} OR oya_hinmei ILIKE ${like})
      AND (${factory}::text IS NULL OR factory = ${factory} OR factory = '')
      AND (${workplace}::text IS NULL OR seizo_basho_mei = ${workplace})
    ORDER BY kanri_zuban, ko_zuban
    LIMIT ${limit}`;
  return { items: rows.map(mapItem), total: rows.length ? Number(rows[0].total) : 0 };
}

/** 品目マスターに登録されている製造場所名（職場）の一覧。工場を指定すればその工場ぶんだけ。 */
export async function listItemWorkplaces(
  companyId: string,
  factory: string | null = null
): Promise<{ name: string; count: number }[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT seizo_basho_mei AS name, COUNT(DISTINCT (kanri_zuban || '\t' || kakuno_cd)) AS cnt
    FROM scrap_items
    WHERE company_id = ${companyId} AND seizo_basho_mei <> ''
      AND (${factory}::text IS NULL OR factory = ${factory} OR factory = '')
    GROUP BY seizo_basho_mei
    ORDER BY seizo_basho_mei`;
  return rows.map((r: any) => ({ name: String(r.name), count: Number(r.cnt) || 0 }));
}

export async function getItemById(companyId: string, id: string): Promise<ScrapItem | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM scrap_items WHERE company_id = ${companyId} AND id = ${id} LIMIT 1`;
  return rows[0] ? mapItem(rows[0]) : null;
}

/** 品目CD×格納場所CD×子図番で upsert。id を返す。 */
export async function upsertItem(
  companyId: string,
  it: Omit<ScrapItem, "id">
): Promise<string> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO scrap_items (
      company_id, kanri_zuban, hinmei, kubun, oya_zuban, oya_hinmei,
      ko_zuban, ko_hinmei, tani, kosei_juryo, kansei_juryo,
      seizo_basho_cd, seizo_basho_mei, kakuno_cd, kakuno_mei, factory
    ) VALUES (
      ${companyId}, ${it.kanriZuban}, ${it.hinmei}, ${it.kubun},
      ${it.oyaZuban}, ${it.oyaHinmei}, ${it.koZuban}, ${it.koHinmei}, ${it.tani},
      ${it.koseiJuryo}, ${it.kanseiJuryo}, ${it.seizoBashoCD}, ${it.seizoBashoMei},
      ${it.kakunoCD}, ${it.kakunoMei}, ${it.factory}
    )
    ON CONFLICT (company_id, kanri_zuban, kakuno_cd, ko_zuban) DO UPDATE SET
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
      kakuno_mei = EXCLUDED.kakuno_mei,
      factory = EXCLUDED.factory,
      updated_at = NOW()
    RETURNING id`;
  return rows[0].id as string;
}

/**
 * 品目マスターの一括UPSERT（CSV取込用）。
 * 1行ずつ往復するとサーバーレス環境で取込がタイムアウトするため、
 * unnest による複数行INSERTでチャンク単位に1往復へまとめる。
 */
export async function bulkUpsertItems(
  companyId: string,
  items: Omit<ScrapItem, "id">[],
  chunkSize = 200
): Promise<number> {
  await ensureSchema();
  const sql = getSql();
  // 同一チャンク内に同じ一意キーが2行あると ON CONFLICT DO UPDATE がエラーになるため、
  // 取込前に重複を畳む（後勝ち）。
  const uniq = new Map<string, Omit<ScrapItem, "id">>();
  for (const it of items) uniq.set(`${it.kanriZuban}\t${it.kakunoCD}\t${it.koZuban}`, it);
  const list = [...uniq.values()];
  let count = 0;
  for (let i = 0; i < list.length; i += chunkSize) {
    const c = list.slice(i, i + chunkSize);
    await sql`
      INSERT INTO scrap_items (
        company_id, kanri_zuban, hinmei, kubun, oya_zuban, oya_hinmei,
        ko_zuban, ko_hinmei, tani, kosei_juryo, kansei_juryo,
        seizo_basho_cd, seizo_basho_mei, kakuno_cd, kakuno_mei, factory
      )
      SELECT ${companyId}, * FROM unnest(
        ${c.map((x) => x.kanriZuban)}::text[], ${c.map((x) => x.hinmei)}::text[],
        ${c.map((x) => x.kubun)}::text[],
        ${c.map((x) => x.oyaZuban)}::text[], ${c.map((x) => x.oyaHinmei)}::text[],
        ${c.map((x) => x.koZuban)}::text[], ${c.map((x) => x.koHinmei)}::text[],
        ${c.map((x) => x.tani)}::text[], ${c.map((x) => x.koseiJuryo)}::numeric[],
        ${c.map((x) => x.kanseiJuryo)}::numeric[], ${c.map((x) => x.seizoBashoCD)}::text[],
        ${c.map((x) => x.seizoBashoMei)}::text[],
        ${c.map((x) => x.kakunoCD)}::text[], ${c.map((x) => x.kakunoMei)}::text[],
        ${c.map((x) => x.factory)}::text[]
      )
      ON CONFLICT (company_id, kanri_zuban, kakuno_cd, ko_zuban) DO UPDATE SET
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
        kakuno_mei = EXCLUDED.kakuno_mei,
        factory = EXCLUDED.factory,
        updated_at = NOW()`;
    count += c.length;
  }
  return count;
}

export async function deleteItem(companyId: string, id: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`DELETE FROM scrap_items WHERE company_id = ${companyId} AND id = ${id}`;
}

// ===== スクラップ種類マスター =====

/** 既定のスクラップ種類。会社に1件も無いときだけ、この2種を初期登録する。 */
const DEFAULT_KINDS = ["上銅", "銅ダライ"];

function mapKind(r: any): ScrapKind {
  return {
    id: r.id,
    name: r.name,
    sort: Number(r.sort) || 0,
    active: Boolean(r.active),
  };
}

/**
 * スクラップ種類の一覧（並び順）。
 * 未登録の会社には既定の2種を入れてから返す（設定画面を開かなくても従来どおり使える）。
 */
export async function listScrapKinds(
  companyId: string,
  opts: { activeOnly?: boolean } = {}
): Promise<ScrapKind[]> {
  await ensureSchema();
  const sql = getSql();
  const read = () => sql`
    SELECT id, name, sort, active FROM scrap_kinds
    WHERE company_id = ${companyId}
      AND (${opts.activeOnly ?? false} = false OR active = true)
    ORDER BY sort ASC, name ASC`;
  let rows = await read();
  if (rows.length === 0) {
    const any = await sql`SELECT 1 FROM scrap_kinds WHERE company_id = ${companyId} LIMIT 1`;
    if (any.length === 0) {
      await sql`
        INSERT INTO scrap_kinds (company_id, name, sort)
        SELECT ${companyId}, * FROM unnest(
          ${DEFAULT_KINDS}::text[], ${DEFAULT_KINDS.map((_, i) => i + 1)}::int[]
        )
        ON CONFLICT (company_id, name) DO NOTHING`;
      rows = await read();
    }
  }
  return rows.map(mapKind);
}

/** 種類の登録・更新（id があれば更新）。名称は会社内で一意。 */
export async function upsertScrapKind(
  companyId: string,
  k: { id?: string | null; name: string; sort: number; active: boolean }
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  if (k.id) {
    await sql`
      UPDATE scrap_kinds SET name = ${k.name}, sort = ${k.sort}, active = ${k.active}
      WHERE company_id = ${companyId} AND id = ${k.id}`;
    return;
  }
  await sql`
    INSERT INTO scrap_kinds (company_id, name, sort, active)
    VALUES (${companyId}, ${k.name}, ${k.sort}, ${k.active})
    ON CONFLICT (company_id, name) DO UPDATE SET
      sort = EXCLUDED.sort, active = EXCLUDED.active`;
}

export async function getScrapKindById(
  companyId: string,
  id: string
): Promise<ScrapKind | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT id, name, sort, active FROM scrap_kinds
    WHERE company_id = ${companyId} AND id = ${id} LIMIT 1`;
  return rows[0] ? mapKind(rows[0]) : null;
}

/** この種類を使っている重量計・日次記録の件数（削除可否の判定に使う）。 */
export async function countScrapKindUsage(
  companyId: string,
  name: string
): Promise<{ scales: number; entries: number }> {
  await ensureSchema();
  const sql = getSql();
  const [sc, en] = await Promise.all([
    sql`SELECT COUNT(*)::int AS n FROM scrap_scales WHERE company_id = ${companyId} AND kind = ${name}`,
    sql`SELECT COUNT(*)::int AS n FROM scrap_daily_entries WHERE company_id = ${companyId} AND hinshu = ${name}`,
  ]);
  return { scales: Number(sc[0]?.n ?? 0), entries: Number(en[0]?.n ?? 0) };
}

export async function deleteScrapKind(companyId: string, id: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`DELETE FROM scrap_kinds WHERE company_id = ${companyId} AND id = ${id}`;
}

// ===== 重量計（スクラップ箱）マスター =====

function mapScale(r: any): Scale {
  return {
    id: r.id,
    qrCode: r.qr_code,
    equipNo: r.equip_no ?? "",
    name: r.name,
    kind: r.kind,
    factory: r.factory,
    sort: Number(r.sort) || 0,
    active: Boolean(r.active),
    capacity: numOrNull(r.capacity),
    division: numOrNull(r.division),
    bagTargetKg: numOrNull(r.bag_target_kg),
  };
}

/** 重量計の一覧。factory 指定で自工場のもの＋工場未設定のものに絞る。 */
export async function listScales(
  companyId: string,
  opts: { factory?: string | null; activeOnly?: boolean } = {}
): Promise<Scale[]> {
  await ensureSchema();
  const sql = getSql();
  const factory = opts.factory ?? null;
  const activeOnly = opts.activeOnly ?? false;
  const rows = await sql`
    SELECT * FROM scrap_scales
    WHERE company_id = ${companyId}
      AND (${factory}::text IS NULL OR factory = ${factory} OR factory = '')
      AND (${activeOnly} = false OR active = true)
    ORDER BY factory ASC, kind ASC, sort ASC, equip_no ASC, name ASC`;
  return rows.map(mapScale);
}

export async function getScaleById(companyId: string, id: string): Promise<Scale | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM scrap_scales WHERE company_id = ${companyId} AND id = ${id} LIMIT 1`;
  return rows[0] ? mapScale(rows[0]) : null;
}

/** QRコード値で重量計を引く（日次記録のQR読み取り用）。 */
export async function getScaleByQr(companyId: string, qrCode: string): Promise<Scale | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM scrap_scales
    WHERE company_id = ${companyId} AND qr_code = ${qrCode} AND active = true LIMIT 1`;
  return rows[0] ? mapScale(rows[0]) : null;
}

/** QRコード値で upsert。id を返す。 */
export async function upsertScale(
  companyId: string,
  s: Omit<Scale, "id"> & { id?: string | null }
): Promise<string> {
  await ensureSchema();
  const sql = getSql();
  if (s.id) {
    await sql`
      UPDATE scrap_scales SET
        qr_code = ${s.qrCode}, equip_no = ${s.equipNo}, name = ${s.name}, kind = ${s.kind},
        factory = ${s.factory}, sort = ${s.sort}, active = ${s.active},
        capacity = ${s.capacity}, division = ${s.division},
        bag_target_kg = ${s.bagTargetKg}
      WHERE company_id = ${companyId} AND id = ${s.id}`;
    return s.id;
  }
  const rows = await sql`
    INSERT INTO scrap_scales (
      company_id, qr_code, equip_no, name, kind, factory, sort, active, capacity, division,
      bag_target_kg
    )
    VALUES (
      ${companyId}, ${s.qrCode}, ${s.equipNo}, ${s.name}, ${s.kind}, ${s.factory},
      ${s.sort}, ${s.active}, ${s.capacity}, ${s.division}, ${s.bagTargetKg}
    )
    ON CONFLICT (company_id, qr_code) DO UPDATE SET
      equip_no = EXCLUDED.equip_no, name = EXCLUDED.name, kind = EXCLUDED.kind,
      factory = EXCLUDED.factory, sort = EXCLUDED.sort, active = EXCLUDED.active,
      capacity = EXCLUDED.capacity, division = EXCLUDED.division,
      bag_target_kg = EXCLUDED.bag_target_kg
    RETURNING id`;
  return rows[0].id as string;
}

export async function deleteScale(companyId: string, id: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`DELETE FROM scrap_scales WHERE company_id = ${companyId} AND id = ${id}`;
}

// ===== ① 日次記録 =====

function mapDailyRecord(r: any, entries: any[]): DailyRecord {
  return {
    id: r.id,
    recordDate: dateStr(r.record_date),
    factory: r.factory,
    sekininsha: r.sekininsha,
    zenjitsuOk: Boolean(r.zenjitsu_ok),
    hakoZanryo: num(r.hako_zanryo),
    kaishiCum: mapKaishiCum(r.kaishi_cum),
    kaishuSokuteichi: numOrNull(r.kaishu_sokuteichi),
    tonyuKanryo: Boolean(r.tonyu_kanryo),
    shonin: r.shonin,
    biko: r.biko,
    updatedBy: r.updated_by,
    status: (r.status ?? "draft") as DailyStatus,
    appliedBy: r.applied_by ?? "",
    appliedAt: r.applied_at ? new Date(r.applied_at).toISOString() : null,
    approvedBy: r.approved_by ?? "",
    approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
    rejectComment: r.reject_comment ?? "",
    entries: entries.map((e: any) => ({
      jikoku: e.jikoku,
      hinshu: e.hinshu,
      scaleId: e.scale_id ?? null,
      scaleName: e.scale_name ?? "",
      grossWeight: numOrNull(e.gross_weight),
      tareWeight: numOrNull(e.tare_weight),
      weight: num(e.weight),
      cumBefore: numOrNull(e.cum_before),
      cumAfter: numOrNull(e.cum_after),
      cumBeforeReason: e.cum_before_reason ?? "",
      cumAfterReason: e.cum_after_reason ?? "",
      cumBeforeReadId: e.cum_before_read_id ?? null,
      cumAfterReadId: e.cum_after_read_id ?? null,
      bagId: e.bag_id ?? null,
      kirokusha: e.kirokusha,
      ijo: e.ijo,
      busho: e.busho ?? "",
      kikai: e.kikai ?? "",
      zairyo: e.zairyo ?? "",
      kotei: e.kotei ?? "",
    })),
  };
}

/** kaishi_cum(JSONB) を scaleId → kg に正規化。ドライバによって文字列で返ることがある。 */
function mapKaishiCum(raw: unknown): Record<string, number> {
  let obj = raw;
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      return {};
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

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
    SELECT jikoku, hinshu, scale_id, scale_name, gross_weight, tare_weight,
           weight, cum_before, cum_after, cum_before_reason, cum_after_reason,
           cum_before_read_id, cum_after_read_id, bag_id, kirokusha, ijo,
           busho, kikai, zairyo, kotei
    FROM scrap_daily_entries WHERE record_id = ${r.id} ORDER BY sort ASC`;
  return mapDailyRecord(r, entries);
}

/** 日次記録票を保存（日付×工場で upsert。明細は全置換。承認状態は変更しない）。 */
export async function saveDailyRecord(
  companyId: string,
  rec: Omit<
    DailyRecord,
    "id" | "status" | "appliedBy" | "appliedAt" | "approvedBy" | "approvedAt" | "rejectComment"
  >
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO scrap_daily_records (
      company_id, record_date, factory, sekininsha, zenjitsu_ok, hako_zanryo,
      kaishi_cum, kaishu_sokuteichi, tonyu_kanryo, shonin, biko, updated_by
    ) VALUES (
      ${companyId}, ${rec.recordDate}, ${rec.factory}, ${rec.sekininsha}, ${rec.zenjitsuOk},
      ${rec.hakoZanryo}, ${JSON.stringify(rec.kaishiCum ?? {})}::jsonb,
      ${rec.kaishuSokuteichi}, ${rec.tonyuKanryo}, ${rec.shonin},
      ${rec.biko}, ${rec.updatedBy}
    )
    ON CONFLICT (company_id, record_date, factory) DO UPDATE SET
      sekininsha = EXCLUDED.sekininsha,
      zenjitsu_ok = EXCLUDED.zenjitsu_ok,
      hako_zanryo = EXCLUDED.hako_zanryo,
      kaishi_cum = EXCLUDED.kaishi_cum,
      kaishu_sokuteichi = EXCLUDED.kaishu_sokuteichi,
      tonyu_kanryo = EXCLUDED.tonyu_kanryo,
      shonin = EXCLUDED.shonin,
      biko = EXCLUDED.biko,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW()
    RETURNING id`;
  const recordId = rows[0].id as string;
  await replaceDailyEntries(companyId, recordId, rec.entries);
}

/**
 * 明細を全置換する（記録票の保存・取込で共通）。
 * 削除と挿入を1つのトランザクションにまとめる（途中で失敗して明細が消えたままにならない。
 * Excel取込では1日に100件超の明細があるので、1本ずつ往復するより速い）。
 */
async function replaceDailyEntries(
  companyId: string,
  recordId: string,
  entries: DailyEntry[]
): Promise<void> {
  const sql = getSql();
  const queries = [sql`DELETE FROM scrap_daily_entries WHERE record_id = ${recordId}`];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    queries.push(sql`
      INSERT INTO scrap_daily_entries (
        company_id, record_id, jikoku, hinshu, scale_id, scale_name,
        gross_weight, tare_weight, weight, cum_before, cum_after,
        cum_before_reason, cum_after_reason, cum_before_read_id, cum_after_read_id,
        bag_id, kirokusha, ijo, busho, kikai, zairyo, kotei, sort
      )
      VALUES (
        ${companyId}, ${recordId}, ${e.jikoku}, ${e.hinshu}, ${e.scaleId}, ${e.scaleName},
        ${e.grossWeight}, ${e.tareWeight}, ${e.weight}, ${e.cumBefore}, ${e.cumAfter},
        ${e.cumBeforeReason ?? ""}, ${e.cumAfterReason ?? ""},
        ${e.cumBeforeReadId ?? null}, ${e.cumAfterReadId ?? null},
        ${e.bagId ?? null}, ${e.kirokusha}, ${e.ijo},
        ${e.busho ?? ""}, ${e.kikai ?? ""}, ${e.zairyo ?? ""}, ${e.kotei ?? ""}, ${i}
      )`);
  }
  await sql.transaction(queries);
}

/**
 * Excel（紙様式）の日次記録票を取り込む。日付×工場で upsert し、明細は全置換。
 * 通常の保存（saveDailyRecord）と違い、承認状態も一緒に入れる:
 * Excelに責任者のサインがある日は、その時点で承認された記録なので approved にし、
 * 承認者にサインの名前を残す（誰の承認かを後から追えるようにする）。
 */
export async function importDailyRecord(
  companyId: string,
  rec: Omit<
    DailyRecord,
    "id" | "status" | "appliedBy" | "appliedAt" | "approvedBy" | "approvedAt" | "rejectComment"
  >,
  approval: { status: DailyStatus; approvedBy: string }
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  const approvedAt = approval.status === "approved" ? new Date().toISOString() : null;
  const rows = await sql`
    INSERT INTO scrap_daily_records (
      company_id, record_date, factory, sekininsha, zenjitsu_ok, hako_zanryo,
      kaishi_cum, kaishu_sokuteichi, tonyu_kanryo, shonin, biko, updated_by,
      status, approved_by, approved_at
    ) VALUES (
      ${companyId}, ${rec.recordDate}, ${rec.factory}, ${rec.sekininsha}, ${rec.zenjitsuOk},
      ${rec.hakoZanryo}, ${JSON.stringify(rec.kaishiCum ?? {})}::jsonb,
      ${rec.kaishuSokuteichi}, ${rec.tonyuKanryo}, ${rec.shonin},
      ${rec.biko}, ${rec.updatedBy},
      ${approval.status}, ${approval.approvedBy}, ${approvedAt}
    )
    ON CONFLICT (company_id, record_date, factory) DO UPDATE SET
      sekininsha = EXCLUDED.sekininsha,
      zenjitsu_ok = EXCLUDED.zenjitsu_ok,
      hako_zanryo = EXCLUDED.hako_zanryo,
      kaishi_cum = EXCLUDED.kaishi_cum,
      kaishu_sokuteichi = EXCLUDED.kaishu_sokuteichi,
      tonyu_kanryo = EXCLUDED.tonyu_kanryo,
      shonin = EXCLUDED.shonin,
      biko = EXCLUDED.biko,
      updated_by = EXCLUDED.updated_by,
      status = EXCLUDED.status,
      approved_by = EXCLUDED.approved_by,
      approved_at = EXCLUDED.approved_at,
      updated_at = NOW()
    RETURNING id`;
  await replaceDailyEntries(companyId, rows[0].id as string, rec.entries);
}

// ===== スクラップ袋 =====

function mapBag(r: any): ScrapBag {
  return {
    id: String(r.id),
    factory: r.factory ?? "",
    scaleId: r.scale_id ?? null,
    scaleName: r.scale_name ?? "",
    kind: r.kind ?? "",
    bagNo: r.bag_no ?? "",
    seq: Number(r.seq) || 1,
    openedOn: dateStr(r.opened_on),
    openedAt: r.opened_at ? new Date(r.opened_at).toISOString() : null,
    openedBy: r.opened_by ?? "",
    startCum: num(r.start_cum),
    closedOn: r.closed_on ? dateStr(r.closed_on) : null,
    closedAt: r.closed_at ? new Date(r.closed_at).toISOString() : null,
    closedBy: r.closed_by ?? "",
    closeCum: numOrNull(r.close_cum),
    closeCumReason: r.close_cum_reason ?? "",
    closeCumReadId: r.close_cum_read_id ?? null,
    totalWeight: numOrNull(r.total_weight),
    status: (r.status ?? "open") as BagStatus,
    approvedBy: r.approved_by ?? "",
    approvedAt: r.approved_at ? new Date(r.approved_at).toISOString() : null,
    note: r.note ?? "",
    runningTotal: num(r.running_total),
    entryCount: Number(r.entry_count) || 0,
    lastCum: numOrNull(r.last_cum),
  };
}

/**
 * 「記録中」の袋。重量計ごとに最大1つ（部分ユニーク索引で保証）。
 * 明細の合計・件数・最後の投入後の表示値も一緒に返す。最後の投入後は
 * 日をまたいで引き継ぐため、日付ではなく袋で辿る。
 */
export async function listOpenBags(companyId: string, factory: string): Promise<ScrapBag[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT b.*,
           COALESCE(a.total, 0) AS running_total,
           COALESCE(a.cnt, 0)   AS entry_count,
           a.last_cum
    FROM scrap_bags b
    LEFT JOIN LATERAL (
      SELECT SUM(e.weight) AS total, COUNT(*) AS cnt,
             (SELECT e2.cum_after
                FROM scrap_daily_entries e2
                JOIN scrap_daily_records r2 ON r2.id = e2.record_id
               WHERE e2.bag_id = b.id AND e2.cum_after IS NOT NULL
               ORDER BY r2.record_date DESC, e2.sort DESC
               LIMIT 1) AS last_cum
        FROM scrap_daily_entries e
       WHERE e.bag_id = b.id
    ) a ON TRUE
    WHERE b.company_id = ${companyId} AND b.factory = ${factory} AND b.status = 'open'
    ORDER BY b.opened_at ASC`;
  return rows.map(mapBag);
}

/**
 * その日の画面に出す袋。記録中のものと、その日に投入・締めがあったものを返す。
 * 袋は日をまたぐので「その日に開いた袋」だけでは足りない。
 */
export async function listBagsForDate(
  companyId: string,
  factory: string,
  date: string
): Promise<ScrapBag[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT b.*,
           COALESCE(a.total, 0) AS running_total,
           COALESCE(a.cnt, 0)   AS entry_count,
           a.last_cum
    FROM scrap_bags b
    LEFT JOIN LATERAL (
      SELECT SUM(e.weight) AS total, COUNT(*) AS cnt,
             (SELECT e2.cum_after
                FROM scrap_daily_entries e2
                JOIN scrap_daily_records r2 ON r2.id = e2.record_id
               WHERE e2.bag_id = b.id AND e2.cum_after IS NOT NULL
               ORDER BY r2.record_date DESC, e2.sort DESC
               LIMIT 1) AS last_cum
        FROM scrap_daily_entries e
       WHERE e.bag_id = b.id
    ) a ON TRUE
    WHERE b.company_id = ${companyId} AND b.factory = ${factory}
      AND (
        -- 記録中の袋は、その日にはまだ開いていなかったものを除く
        (b.status = 'open' AND b.opened_on <= ${date})
        OR b.closed_on = ${date}
        OR b.opened_on = ${date}
        OR EXISTS (
          SELECT 1 FROM scrap_daily_entries e3
          JOIN scrap_daily_records r3 ON r3.id = e3.record_id
          WHERE e3.bag_id = b.id AND r3.record_date = ${date}
        )
      )
    ORDER BY b.opened_at ASC`;
  return rows.map(mapBag);
}

export async function getBagById(companyId: string, id: string): Promise<ScrapBag | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT b.*,
           COALESCE(a.total, 0) AS running_total,
           COALESCE(a.cnt, 0)   AS entry_count,
           a.last_cum
    FROM scrap_bags b
    LEFT JOIN LATERAL (
      SELECT SUM(e.weight) AS total, COUNT(*) AS cnt,
             (SELECT e2.cum_after
                FROM scrap_daily_entries e2
                JOIN scrap_daily_records r2 ON r2.id = e2.record_id
               WHERE e2.bag_id = b.id AND e2.cum_after IS NOT NULL
               ORDER BY r2.record_date DESC, e2.sort DESC
               LIMIT 1) AS last_cum
        FROM scrap_daily_entries e
       WHERE e.bag_id = b.id
    ) a ON TRUE
    WHERE b.company_id = ${companyId} AND b.id = ${id}
    LIMIT 1`;
  return rows[0] ? mapBag(rows[0]) : null;
}

/**
 * 袋を開く。袋Noは現場の記入用紙と同じ「開始日 + その日の順番」で採番する
 * （重量が入るのは締めたとき）。同じ重量計で既に開いていれば部分ユニーク索引が
 * 弾くので、二重に開くことはない。
 */
export async function openBag(
  companyId: string,
  b: {
    factory: string;
    scaleId: string;
    scaleName: string;
    kind: string;
    openedOn: string;
    openedBy: string;
    startCum: number;
    note: string;
  }
): Promise<ScrapBag> {
  await ensureSchema();
  const sql = getSql();
  const seqRows = await sql`
    SELECT COALESCE(MAX(seq), 0) + 1 AS next
    FROM scrap_bags
    WHERE company_id = ${companyId} AND scale_id = ${b.scaleId} AND opened_on = ${b.openedOn}`;
  const seq = Number(seqRows[0]?.next) || 1;
  const bagNo = `${b.openedOn.replace(/-/g, "")}-${seq}`;
  const rows = await sql`
    INSERT INTO scrap_bags (
      company_id, factory, scale_id, scale_name, kind, bag_no, seq,
      opened_on, opened_by, start_cum, note
    ) VALUES (
      ${companyId}, ${b.factory}, ${b.scaleId}, ${b.scaleName}, ${b.kind}, ${bagNo}, ${seq},
      ${b.openedOn}, ${b.openedBy}, ${b.startCum}, ${b.note}
    )
    RETURNING *`;
  return mapBag({ ...rows[0], running_total: 0, entry_count: 0, last_cum: null });
}

/**
 * 袋を締める（＝交換する）。締めの表示値と、その時点の明細合計を確定させる。
 * status は closed（承認待ち）。記録中の袋にしか効かない。
 */
export async function closeBag(
  companyId: string,
  id: string,
  c: {
    closedOn: string;
    closedBy: string;
    closeCum: number;
    closeCumReadId: string | null;
    closeCumReason: string;
    totalWeight: number;
    note: string;
  }
): Promise<boolean> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    UPDATE scrap_bags SET
      status = 'closed',
      closed_on = ${c.closedOn},
      closed_at = NOW(),
      closed_by = ${c.closedBy},
      close_cum = ${c.closeCum},
      close_cum_read_id = ${c.closeCumReadId},
      close_cum_reason = ${c.closeCumReason},
      total_weight = ${c.totalWeight},
      note = ${c.note},
      updated_at = NOW()
    WHERE company_id = ${companyId} AND id = ${id} AND status = 'open'
    RETURNING id`;
  return rows.length > 0;
}

/** 袋の承認・承認取消（管理者のみ。取消は締め済みへ戻す）。 */
export async function setBagApproval(
  companyId: string,
  id: string,
  v: { status: BagStatus; approvedBy: string; note?: string }
): Promise<boolean> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    UPDATE scrap_bags SET
      status = ${v.status},
      approved_by = ${v.status === "approved" ? v.approvedBy : ""},
      approved_at = ${v.status === "approved" ? new Date().toISOString() : null},
      note = COALESCE(${v.note ?? null}, note),
      updated_at = NOW()
    WHERE company_id = ${companyId} AND id = ${id}
    RETURNING id`;
  return rows.length > 0;
}

/**
 * 締めの表示値を直す（管理者のみ）。袋は締めたままで数字だけ入れ直す。
 * 交換のときに次の袋が開いているのが普通なので、記録中に戻さずに直せる経路が要る。
 * 承認済みだった袋は承認待ちへ戻す（確認した数字と違うものを承認済みにしない）。
 * AI読取のIDはそのまま残すので、「AIはこう読んだが、人がこう直した」は後から追える。
 */
export async function correctBagClose(
  companyId: string,
  id: string,
  c: { closeCum: number; reason: string }
): Promise<boolean> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    UPDATE scrap_bags SET
      close_cum = ${c.closeCum},
      close_cum_reason = ${c.reason},
      status = 'closed',
      approved_by = '',
      approved_at = NULL,
      updated_at = NOW()
    WHERE company_id = ${companyId} AND id = ${id} AND status <> 'open'
    RETURNING id`;
  return rows.length > 0;
}

/**
 * 投入が1件も無い袋を消す。交換のときに自動で開いた次の袋を、締め取消で
 * 巻き戻すために使う（1台の重量計に記録中の袋は1つしか置けないため）。
 * 投入が入っている袋は消さない。
 */
export async function deleteEmptyBag(companyId: string, id: string): Promise<boolean> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    DELETE FROM scrap_bags
    WHERE company_id = ${companyId} AND id = ${id} AND status = 'open'
      AND NOT EXISTS (SELECT 1 FROM scrap_daily_entries e WHERE e.bag_id = scrap_bags.id)
    RETURNING id`;
  return rows.length > 0;
}

/** 締め済みの袋を記録中へ戻す（締め値の入れ直し。管理者のみ）。 */
export async function reopenBag(companyId: string, id: string): Promise<boolean> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    UPDATE scrap_bags SET
      status = 'open',
      closed_on = NULL, closed_at = NULL, closed_by = '',
      close_cum = NULL, close_cum_read_id = NULL, close_cum_reason = '',
      total_weight = NULL,
      approved_by = '', approved_at = NULL,
      updated_at = NOW()
    WHERE company_id = ${companyId} AND id = ${id} AND status <> 'open'
    RETURNING id`;
  return rows.length > 0;
}

/**
 * 袋運用の開始日。この日から「袋単位」で管理し、それより前は従来どおり日単位。
 *   setting  … 設定画面で決めた日
 *   firstBag … 設定が無いので、その工場で最初に袋を開いた日から袋運用とみなす
 *   none     … 設定も袋も無い（＝まだ袋運用を始めていない）
 * none のときは呼び出し側が「今日から」として扱う（過去日に袋を作らせないため）。
 */
export interface BagStart {
  factory: string;
  startOn: string | null;
  source: "setting" | "firstBag" | "none";
  updatedBy: string;
}

export async function getBagStart(companyId: string, factory: string): Promise<BagStart> {
  await ensureSchema();
  const sql = getSql();
  const setting = await sql`
    SELECT start_on, updated_by FROM scrap_bag_starts
    WHERE company_id = ${companyId} AND factory = ${factory} LIMIT 1`;
  if (setting[0]) {
    return {
      factory,
      startOn: dateStr(setting[0].start_on),
      source: "setting",
      updatedBy: setting[0].updated_by ?? "",
    };
  }
  const first = await sql`
    SELECT MIN(opened_on) AS d FROM scrap_bags
    WHERE company_id = ${companyId} AND factory = ${factory}`;
  const d = first[0]?.d;
  return d
    ? { factory, startOn: dateStr(d), source: "firstBag", updatedBy: "" }
    : { factory, startOn: null, source: "none", updatedBy: "" };
}

/** 工場ごとの袋運用の開始日（設定画面用）。設定が無い工場は推定値を返す。 */
export async function listBagStarts(companyId: string, factories: string[]): Promise<BagStart[]> {
  const out: BagStart[] = [];
  for (const f of factories) out.push(await getBagStart(companyId, f));
  return out;
}

export async function setBagStart(
  companyId: string,
  factory: string,
  startOn: string,
  updatedBy: string
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO scrap_bag_starts (company_id, factory, start_on, updated_by)
    VALUES (${companyId}, ${factory}, ${startOn}, ${updatedBy})
    ON CONFLICT (company_id, factory) DO UPDATE SET
      start_on = EXCLUDED.start_on, updated_by = EXCLUDED.updated_by, updated_at = NOW()`;
}

/** 袋運用の開始日の設定を消す（推定値に戻す）。 */
export async function clearBagStart(companyId: string, factory: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`DELETE FROM scrap_bag_starts WHERE company_id = ${companyId} AND factory = ${factory}`;
}

/**
 * 月ごとの袋の一覧。締めた月（締める前は開いた月）で拾う。
 * 紙の記入用紙・Excelの1枚に対応する単位なので、これが袋運用の台帳になる。
 */
export async function listBagsByMonth(
  companyId: string,
  ym: string,
  factory: string | null
): Promise<ScrapBag[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT b.*,
           COALESCE(a.total, 0) AS running_total,
           COALESCE(a.cnt, 0)   AS entry_count,
           a.last_cum
    FROM scrap_bags b
    LEFT JOIN LATERAL (
      SELECT SUM(e.weight) AS total, COUNT(*) AS cnt,
             (SELECT e2.cum_after
                FROM scrap_daily_entries e2
                JOIN scrap_daily_records r2 ON r2.id = e2.record_id
               WHERE e2.bag_id = b.id AND e2.cum_after IS NOT NULL
               ORDER BY r2.record_date DESC, e2.sort DESC
               LIMIT 1) AS last_cum
        FROM scrap_daily_entries e
       WHERE e.bag_id = b.id
    ) a ON TRUE
    WHERE b.company_id = ${companyId}
      AND to_char(COALESCE(b.closed_on, b.opened_on), 'YYYY-MM') = ${ym}
      AND (${factory}::text IS NULL OR b.factory = ${factory})
    ORDER BY COALESCE(b.closed_on, b.opened_on), b.opened_at`;
  return rows.map(mapBag);
}

/** 袋に入った投入の明細（袋別CSV用）。袋Noを各行に付けて出す。 */
export interface BagEntryRow {
  bagNo: string;
  bagStatus: BagStatus;
  factory: string;
  scaleName: string;
  recordDate: string;
  jikoku: string;
  hinshu: string;
  cumBefore: number | null;
  cumAfter: number | null;
  weight: number;
  kirokusha: string;
  ijo: string;
}

export async function listBagEntriesByMonth(
  companyId: string,
  ym: string,
  factory: string | null
): Promise<BagEntryRow[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT b.bag_no, b.status, b.factory, b.scale_name,
           r.record_date, e.jikoku, e.hinshu, e.cum_before, e.cum_after, e.weight,
           e.kirokusha, e.ijo
    FROM scrap_bags b
    JOIN scrap_daily_entries e ON e.bag_id = b.id
    JOIN scrap_daily_records r ON r.id = e.record_id
    WHERE b.company_id = ${companyId}
      AND to_char(COALESCE(b.closed_on, b.opened_on), 'YYYY-MM') = ${ym}
      AND (${factory}::text IS NULL OR b.factory = ${factory})
    ORDER BY COALESCE(b.closed_on, b.opened_on), b.opened_at, r.record_date, e.sort`;
  return rows.map((r: any) => ({
    bagNo: r.bag_no ?? "",
    bagStatus: (r.status ?? "open") as BagStatus,
    factory: r.factory ?? "",
    scaleName: r.scale_name ?? "",
    recordDate: dateStr(r.record_date),
    jikoku: r.jikoku ?? "",
    hinshu: r.hinshu ?? "",
    cumBefore: numOrNull(r.cum_before),
    cumAfter: numOrNull(r.cum_after),
    weight: num(r.weight),
    kirokusha: r.kirokusha ?? "",
    ijo: r.ijo ?? "",
  }));
}

/**
 * 袋の「次に入るはずの投入前の表示値」。いま編集している記録票を除いた
 * 最後の投入後を返す（日をまたいだ袋は前日の最後がこれに当たる）。
 * 記録票の明細は保存のたびに全置換されるので、自分自身は必ず除く。
 */
export async function getBagChainSeeds(
  companyId: string,
  bagIds: string[],
  excludeRecordId: string | null
): Promise<Map<string, number>> {
  await ensureSchema();
  const sql = getSql();
  const out = new Map<string, number>();
  for (const bagId of [...new Set(bagIds)]) {
    if (!bagId) continue;
    const rows = excludeRecordId
      ? await sql`
          SELECT e.cum_after
          FROM scrap_daily_entries e
          JOIN scrap_daily_records r ON r.id = e.record_id
          WHERE e.company_id = ${companyId} AND e.bag_id = ${bagId}
            AND e.record_id <> ${excludeRecordId} AND e.cum_after IS NOT NULL
          ORDER BY r.record_date DESC, e.sort DESC
          LIMIT 1`
      : await sql`
          SELECT e.cum_after
          FROM scrap_daily_entries e
          JOIN scrap_daily_records r ON r.id = e.record_id
          WHERE e.company_id = ${companyId} AND e.bag_id = ${bagId}
            AND e.cum_after IS NOT NULL
          ORDER BY r.record_date DESC, e.sort DESC
          LIMIT 1`;
    const v = numOrNull(rows[0]?.cum_after);
    if (v !== null) out.set(bagId, v);
  }
  return out;
}

/**
 * 締め済みの袋の明細合計を、いまの明細から取り直す。
 * 承認済みの袋の中身が変わったときは承認を外す（確認した数字と違うものを
 * 承認済みのままにしない）。承認が外れた袋を返す。
 */
export async function syncClosedBagTotals(
  companyId: string,
  bagIds: string[]
): Promise<ScrapBag[]> {
  await ensureSchema();
  const sql = getSql();
  const revoked: ScrapBag[] = [];
  for (const bagId of [...new Set(bagIds)]) {
    if (!bagId) continue;
    const bag = await getBagById(companyId, bagId);
    if (!bag || bag.status === "open") continue;
    const total = Math.round(bag.runningTotal * 1000) / 1000;
    if (bag.totalWeight !== null && Math.abs(bag.totalWeight - total) < 0.0005) continue;
    if (bag.status === "approved") {
      await sql`
        UPDATE scrap_bags SET
          total_weight = ${total}, status = 'closed', approved_by = '', approved_at = NULL,
          updated_at = NOW()
        WHERE company_id = ${companyId} AND id = ${bagId}`;
      revoked.push(bag);
    } else {
      await sql`
        UPDATE scrap_bags SET total_weight = ${total}, updated_at = NOW()
        WHERE company_id = ${companyId} AND id = ${bagId}`;
    }
  }
  return revoked;
}

// ===== AI読取のログ（追記のみ） =====

export interface ScaleRead {
  id: string;
  scaleId: string | null;
  scaleName: string;
  phase: "before" | "after";
  /** AIが読んだ値 kg。読めなかった記録は null で残る */
  value: number | null;
  digits: string;
  confidence: string;
  note: string;
  model: string;
  readBy: string;
  readAt: string;
}

/**
 * AI読取を1件記録する。書き込むのはサーバー（/api/scale-read）だけで、更新も削除もしない。
 * 「AIはこう読んだ」という事実を残すのが目的なので、読めなかった（value=null）ときも記録する。
 */
export async function insertScaleRead(
  companyId: string,
  r: {
    recordDate: string | null;
    factory: string;
    scaleId: string | null;
    scaleName: string;
    phase: "before" | "after";
    value: number | null;
    digits: string;
    confidence: string;
    note: string;
    model: string;
    readBy: string;
  }
): Promise<string> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    INSERT INTO scrap_scale_reads (
      company_id, record_date, factory, scale_id, scale_name, phase,
      ai_value, ai_digits, ai_confidence, ai_note, model, read_by
    ) VALUES (
      ${companyId}, ${r.recordDate}, ${r.factory}, ${r.scaleId}, ${r.scaleName}, ${r.phase},
      ${r.value}, ${r.digits}, ${r.confidence}, ${r.note}, ${r.model}, ${r.readBy}
    )
    RETURNING id`;
  return rows[0].id as string;
}

/** 読取ログをIDで引く（保存時の突き合わせ用）。他社のIDは引けない。 */
export async function getScaleReads(
  companyId: string,
  ids: string[]
): Promise<Map<string, ScaleRead>> {
  const out = new Map<string, ScaleRead>();
  const uniq = [...new Set(ids.filter(Boolean))];
  if (uniq.length === 0) return out;
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT id, scale_id, scale_name, phase, ai_value, ai_digits, ai_confidence,
           ai_note, model, read_by, read_at
      FROM scrap_scale_reads
     WHERE company_id = ${companyId} AND id = ANY(${uniq}::uuid[])`;
  for (const r of rows as any[]) out.set(String(r.id), mapScaleRead(r));
  return out;
}

/**
 * 日次記録に紐づく読取ログ（監査用）。AIが読んだ値と、実際に採用された値を
 * 並べて確認するために使う。
 */
export async function listScaleReads(
  companyId: string,
  recordDate: string,
  factory: string
): Promise<ScaleRead[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT id, scale_id, scale_name, phase, ai_value, ai_digits, ai_confidence,
           ai_note, model, read_by, read_at
      FROM scrap_scale_reads
     WHERE company_id = ${companyId} AND record_date = ${recordDate} AND factory = ${factory}
     ORDER BY read_at ASC`;
  return (rows as any[]).map(mapScaleRead);
}

function mapScaleRead(r: any): ScaleRead {
  return {
    id: String(r.id),
    scaleId: r.scale_id ?? null,
    scaleName: r.scale_name ?? "",
    phase: r.phase === "after" ? "after" : "before",
    value: numOrNull(r.ai_value),
    digits: r.ai_digits ?? "",
    confidence: r.ai_confidence ?? "",
    note: r.ai_note ?? "",
    model: r.model ?? "",
    readBy: r.read_by ?? "",
    readAt: r.read_at ? new Date(r.read_at).toISOString() : "",
  };
}

/** 日次記録の承認状態を取得（存在しなければ null）。編集可否・二重申請の判定用。 */
export async function getDailyStatus(
  companyId: string,
  recordDate: string,
  factory: string
): Promise<DailyStatus | null> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT status FROM scrap_daily_records
    WHERE company_id = ${companyId} AND record_date = ${recordDate} AND factory = ${factory}
    LIMIT 1`;
  return rows[0] ? ((rows[0].status ?? "draft") as DailyStatus) : null;
}

/** 承認状態の更新（申請/承認/差し戻し）。 */
export async function updateDailyStatus(
  companyId: string,
  recordDate: string,
  factory: string,
  patch:
    | { status: "pending"; appliedBy: string }
    | { status: "approved"; approvedBy: string }
    | { status: "rejected"; approvedBy: string; rejectComment: string }
    | { status: "draft" }
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  if (patch.status === "pending") {
    await sql`
      UPDATE scrap_daily_records SET status = 'pending',
        applied_by = ${patch.appliedBy}, applied_at = NOW(),
        approved_by = '', approved_at = NULL, reject_comment = '', updated_at = NOW()
      WHERE company_id = ${companyId} AND record_date = ${recordDate} AND factory = ${factory}`;
  } else if (patch.status === "approved") {
    await sql`
      UPDATE scrap_daily_records SET status = 'approved',
        approved_by = ${patch.approvedBy}, approved_at = NOW(),
        shonin = ${patch.approvedBy}, reject_comment = '', updated_at = NOW()
      WHERE company_id = ${companyId} AND record_date = ${recordDate} AND factory = ${factory}`;
  } else if (patch.status === "rejected") {
    await sql`
      UPDATE scrap_daily_records SET status = 'rejected',
        approved_by = ${patch.approvedBy}, approved_at = NOW(),
        reject_comment = ${patch.rejectComment}, updated_at = NOW()
      WHERE company_id = ${companyId} AND record_date = ${recordDate} AND factory = ${factory}`;
  } else {
    await sql`
      UPDATE scrap_daily_records SET status = 'draft', updated_at = NOW()
      WHERE company_id = ${companyId} AND record_date = ${recordDate} AND factory = ${factory}`;
  }
}

/** 申請中（pending）の件数。ポータルの承認待ちバッジ用。factory 指定で自工場のみ。 */
export async function countPendingDaily(
  companyId: string,
  factory: string | null = null
): Promise<number> {
  await ensureSchema();
  const sql = getSql();
  // 承認は終礼時に1日1回。記録者からの「申請」は無くしたので、
  // 承認待ち＝投入の記録があるのに、まだ承認されていない日。
  // 空の記録票（開いただけの日）は数えない。
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM scrap_daily_records r
    WHERE r.company_id = ${companyId}
      AND r.status <> 'approved'
      AND (${factory}::text IS NULL OR r.factory = ${factory})
      AND EXISTS (SELECT 1 FROM scrap_daily_entries e WHERE e.record_id = r.id)`;
  return Number(rows[0]?.n ?? 0);
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
  status: DailyStatus;
  appliedBy: string;
  approvedBy: string;
  kaishuSokuteichi: number | null;
  total: number;
  /** 種類名 → 合計kg。種類は設定で増やせるので固定の列は持たない */
  byKind: Record<string, number>;
  ijoCount: number;
  /** その日に投入が入った袋の数 */
  bagCount: number;
  /** 袋に紐づいていない投入の数（袋運用の期間なら開き忘れ） */
  noBagCount: number;
}

/** JSONB の {種類名: 重量} を Record<string, number> に正規化。 */
function mapByKind(raw: any): Record<string, number> {
  let obj = raw;
  if (typeof obj === "string") {
    try {
      obj = JSON.parse(obj);
    } catch {
      return {};
    }
  }
  if (!obj || typeof obj !== "object") return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const n = Number(v);
    if (Number.isFinite(n)) out[k] = n;
  }
  return out;
}

/** 月間の日次記録集計（1日1工場1行、種類別合計つき）。 */
export async function listDailyAgg(
  companyId: string,
  ym: string,
  factory: string | null
): Promise<DailyAggRow[]> {
  await ensureSchema();
  const sql = getSql();
  // 種類は設定で増やせるので、まず記録×種類で合計してから JSONB に畳む
  const rows = await sql`
    WITH per_kind AS (
      SELECT e.record_id AS rid, e.hinshu, SUM(e.weight) AS w
      FROM scrap_daily_entries e
      JOIN scrap_daily_records r2 ON r2.id = e.record_id
      WHERE r2.company_id = ${companyId}
        AND to_char(r2.record_date, 'YYYY-MM') = ${ym}
        AND (${factory}::text IS NULL OR r2.factory = ${factory})
      GROUP BY e.record_id, e.hinshu
    )
    SELECT r.record_date, r.factory, r.sekininsha, r.shonin, r.status, r.applied_by, r.approved_by,
      r.kaishu_sokuteichi,
      COALESCE(SUM(e.weight), 0) AS total,
      COALESCE(
        (SELECT jsonb_object_agg(p.hinshu, p.w) FROM per_kind p WHERE p.rid = r.id),
        '{}'::jsonb
      ) AS by_kind,
      COUNT(*) FILTER (WHERE e.ijo <> '') AS ijo_count,
      -- その日に投入が入った袋の数と、袋に紐づいていない投入の数。
      -- 袋運用の期間なのに「袋なし」があれば、袋を開き忘れて記録している。
      COUNT(DISTINCT e.bag_id) AS bag_count,
      COUNT(e.id) FILTER (WHERE e.bag_id IS NULL) AS no_bag_count
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
    status: (r.status ?? "draft") as DailyStatus,
    appliedBy: r.applied_by ?? "",
    approvedBy: r.approved_by ?? "",
    kaishuSokuteichi: numOrNull(r.kaishu_sokuteichi),
    total: num(r.total),
    byKind: mapByKind(r.by_kind),
    ijoCount: Number(r.ijo_count) || 0,
    bagCount: Number(r.bag_count) || 0,
    noBagCount: Number(r.no_bag_count) || 0,
  }));
}

/** 月間の日次記録合計（種類別）。⑥の突合に使う。factory 指定で自工場のみ。 */
export async function dailyMonthTotals(
  companyId: string,
  ym: string,
  factory: string | null = null
): Promise<{ total: number; byKind: Record<string, number>; days: number }> {
  await ensureSchema();
  const sql = getSql();
  const [totals, kinds] = await Promise.all([
    sql`
      SELECT COALESCE(SUM(e.weight), 0) AS total, COUNT(DISTINCT r.id) AS days
      FROM scrap_daily_records r
      LEFT JOIN scrap_daily_entries e ON e.record_id = r.id
      WHERE r.company_id = ${companyId}
        AND to_char(r.record_date, 'YYYY-MM') = ${ym}
        AND (${factory}::text IS NULL OR r.factory = ${factory})`,
    sql`
      SELECT e.hinshu, SUM(e.weight) AS w
      FROM scrap_daily_entries e
      JOIN scrap_daily_records r ON r.id = e.record_id
      WHERE r.company_id = ${companyId}
        AND to_char(r.record_date, 'YYYY-MM') = ${ym}
        AND (${factory}::text IS NULL OR r.factory = ${factory})
      GROUP BY e.hinshu`,
  ]);
  const byKind: Record<string, number> = {};
  for (const k of kinds) byKind[String((k as any).hinshu)] = num((k as any).w);
  const t = totals[0] ?? {};
  return { total: num((t as any).total), byKind, days: Number((t as any).days) || 0 };
}

// ===== ③ 初品重量測定 =====

export async function listFirstArticles(
  companyId: string,
  limit = 200,
  /** 指定すると、その工場の品目の測定記録だけを返す（品目マスターの工場で判定） */
  factory: string | null = null
): Promise<FirstArticle[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT f.measured_on, f.hinmoku_cd, f.kakuno_cd, f.weight, f.sokuteisha,
      f.status, f.approved_by, f.reject_comment, f.note,
      (SELECT hinmei FROM scrap_items i
        WHERE i.company_id = f.company_id
          AND i.kanri_zuban = f.hinmoku_cd AND i.kakuno_cd = f.kakuno_cd
        ORDER BY i.ko_zuban LIMIT 1) AS hinmei,
      (SELECT kansei_juryo FROM scrap_items i
        WHERE i.company_id = f.company_id
          AND i.kanri_zuban = f.hinmoku_cd AND i.kakuno_cd = f.kakuno_cd
        ORDER BY i.ko_zuban LIMIT 1) AS kansei_juryo
    FROM scrap_first_articles f
    WHERE f.company_id = ${companyId}
      AND (${factory}::text IS NULL OR EXISTS (
        SELECT 1 FROM scrap_items i
        WHERE i.company_id = f.company_id
          AND i.kanri_zuban = f.hinmoku_cd AND i.kakuno_cd = f.kakuno_cd
          AND (i.factory = ${factory} OR i.factory = '')))
    ORDER BY f.measured_on DESC, f.hinmoku_cd, f.kakuno_cd
    LIMIT ${limit}`;
  return rows.map((r: any) => ({
    measuredOn: dateStr(r.measured_on),
    hinmokuCD: r.hinmoku_cd,
    kakunoCD: r.kakuno_cd,
    weight: num(r.weight),
    sokuteisha: r.sokuteisha,
    status: (r.status ?? "approved") as FaStatus,
    approvedBy: r.approved_by ?? "",
    rejectComment: r.reject_comment ?? "",
    note: r.note ?? "",
    hinmei: r.hinmei ?? null,
    kanseiJuryo: numOrNull(r.kansei_juryo),
  }));
}

/** 登録＝管理者への申請（status='pending'）。再登録は再申請扱い。 */
export async function upsertFirstArticle(
  companyId: string,
  fa: {
    measuredOn: string;
    hinmokuCD: string;
    kakunoCD: string;
    weight: number;
    sokuteisha: string;
  }
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO scrap_first_articles
      (company_id, measured_on, hinmoku_cd, kakuno_cd, weight, sokuteisha, status)
    VALUES (${companyId}, ${fa.measuredOn}, ${fa.hinmokuCD}, ${fa.kakunoCD},
            ${fa.weight}, ${fa.sokuteisha}, 'pending')
    ON CONFLICT (company_id, measured_on, hinmoku_cd, kakuno_cd) DO UPDATE SET
      weight = EXCLUDED.weight, sokuteisha = EXCLUDED.sokuteisha,
      status = 'pending', approved_by = '', approved_at = NULL, reject_comment = ''`;
}

/**
 * 品目CDから品目マスターの候補を引く（Excel取込で格納場所CDを決めるため）。
 * 1つの品目CDに複数の子図番があるので、品目CD×格納場所CD単位に畳む。
 * 構成重量は子図番の合計、完成重量(理論)は子図番順の先頭（calc.ts と同じ扱い）。
 */
export async function listItemRefs(
  companyId: string,
  codes: string[]
): Promise<
  {
    hinmokuCD: string;
    kakunoCD: string;
    seizoBashoCD: string;
    factory: string;
    kanseiJuryo: number;
    koseiJuryo: number;
  }[]
> {
  await ensureSchema();
  const sql = getSql();
  if (codes.length === 0) return [];
  const rows = await sql`
    SELECT kanri_zuban, kakuno_cd,
      (ARRAY_AGG(seizo_basho_cd ORDER BY ko_zuban)) [1] AS seizo_basho_cd,
      (ARRAY_AGG(factory ORDER BY ko_zuban)) [1] AS factory,
      (ARRAY_AGG(kansei_juryo ORDER BY ko_zuban)) [1] AS kansei_juryo,
      SUM(kosei_juryo) AS kosei_juryo
    FROM scrap_items
    WHERE company_id = ${companyId} AND kanri_zuban = ANY(${codes}::text[])
    GROUP BY kanri_zuban, kakuno_cd`;
  return rows.map((r: any) => ({
    hinmokuCD: r.kanri_zuban,
    kakunoCD: r.kakuno_cd,
    seizoBashoCD: r.seizo_basho_cd ?? "",
    factory: r.factory ?? "",
    kanseiJuryo: num(r.kansei_juryo),
    koseiJuryo: num(r.kosei_juryo),
  }));
}

/**
 * 初品測定の一括取込（過去分の移行用。承認済みで入れる）。
 * 同じ 測定日×品目CD×格納場所CD は上書き。取込件数を返す。
 */
export async function bulkUpsertFirstArticles(
  companyId: string,
  rows: {
    measuredOn: string;
    hinmokuCD: string;
    kakunoCD: string;
    weight: number;
    sokuteisha: string;
    note: string;
  }[],
  approvedBy: string,
  chunkSize = 500
): Promise<number> {
  await ensureSchema();
  const sql = getSql();
  // 同一チャンクに同じ一意キーが2行あると ON CONFLICT DO UPDATE が失敗するため畳む（後勝ち）
  const uniq = new Map<string, (typeof rows)[number]>();
  for (const r of rows) uniq.set(`${r.measuredOn}\t${r.hinmokuCD}\t${r.kakunoCD}`, r);
  const list = [...uniq.values()];
  let count = 0;
  for (let i = 0; i < list.length; i += chunkSize) {
    const c = list.slice(i, i + chunkSize);
    await sql`
      INSERT INTO scrap_first_articles
        (company_id, measured_on, hinmoku_cd, kakuno_cd, weight, sokuteisha,
         status, approved_by, approved_at, note)
      SELECT ${companyId}, t.d, t.h, t.k, t.w, t.s, 'approved', ${approvedBy}, NOW(), t.n
      FROM unnest(
        ${c.map((x) => x.measuredOn)}::date[],
        ${c.map((x) => x.hinmokuCD)}::text[],
        ${c.map((x) => x.kakunoCD)}::text[],
        ${c.map((x) => x.weight)}::numeric[],
        ${c.map((x) => x.sokuteisha)}::text[],
        ${c.map((x) => x.note)}::text[]
      ) AS t(d, h, k, w, s, n)
      ON CONFLICT (company_id, measured_on, hinmoku_cd, kakuno_cd) DO UPDATE SET
        weight = EXCLUDED.weight, sokuteisha = EXCLUDED.sokuteisha,
        status = 'approved', approved_by = EXCLUDED.approved_by,
        approved_at = NOW(), reject_comment = '', note = EXCLUDED.note`;
    count += c.length;
  }
  return count;
}

/** 初品測定の承認/差し戻し（管理者のみが呼ぶ）。 */
export async function updateFirstArticleStatus(
  companyId: string,
  measuredOn: string,
  hinmokuCD: string,
  kakunoCD: string,
  patch:
    | { status: "approved"; approvedBy: string }
    | { status: "rejected"; approvedBy: string; rejectComment: string }
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  if (patch.status === "approved") {
    await sql`
      UPDATE scrap_first_articles SET status = 'approved',
        approved_by = ${patch.approvedBy}, approved_at = NOW(), reject_comment = ''
      WHERE company_id = ${companyId} AND measured_on = ${measuredOn}
        AND hinmoku_cd = ${hinmokuCD} AND kakuno_cd = ${kakunoCD}`;
  } else {
    await sql`
      UPDATE scrap_first_articles SET status = 'rejected',
        approved_by = ${patch.approvedBy}, approved_at = NOW(),
        reject_comment = ${patch.rejectComment}
      WHERE company_id = ${companyId} AND measured_on = ${measuredOn}
        AND hinmoku_cd = ${hinmokuCD} AND kakuno_cd = ${kakunoCD}`;
  }
}

/**
 * 申請中（pending）の初品測定の件数。ポータルの承認待ちバッジ用。
 * factory 指定でその工場の品目のみ（品目マスターの工場で判定。一覧の絞り込みと同じ扱い）。
 */
export async function countPendingFirstArticles(
  companyId: string,
  factory: string | null = null
): Promise<number> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM scrap_first_articles f
    WHERE f.company_id = ${companyId} AND f.status = 'pending'
      AND (${factory}::text IS NULL OR EXISTS (
        SELECT 1 FROM scrap_items i
        WHERE i.company_id = f.company_id
          AND i.kanri_zuban = f.hinmoku_cd AND i.kakuno_cd = f.kakuno_cd
          AND (i.factory = ${factory} OR i.factory = '')))`;
  return Number(rows[0]?.n ?? 0);
}

/** 締め済みで未承認（status='closed'）の袋の件数。ポータルの承認待ちバッジ用。 */
export async function countPendingBags(
  companyId: string,
  factory: string | null = null
): Promise<number> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM scrap_bags
    WHERE company_id = ${companyId} AND status = 'closed'
      AND (${factory}::text IS NULL OR factory = ${factory})`;
  return Number(rows[0]?.n ?? 0);
}

export async function deleteFirstArticle(
  companyId: string,
  measuredOn: string,
  hinmokuCD: string,
  kakunoCD: string
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    DELETE FROM scrap_first_articles
    WHERE company_id = ${companyId} AND measured_on = ${measuredOn}
      AND hinmoku_cd = ${hinmokuCD} AND kakuno_cd = ${kakunoCD}`;
}

// ===== ④ McFrame取込 =====

/** McFrame取込の1行。品目は「品目CD × 格納場所CD」の組で特定する。 */
export interface McframeQtyRow {
  ym: string;
  hinmokuCD: string;
  kakunoCD: string;
  qty: number;
}
export interface McframeDayRow {
  qdate: string;
  hinmokuCD: string;
  kakunoCD: string;
  qty: number;
}

/** 年月×品目CD×格納場所CD で upsert（再取込は上書き）。取込件数を返す。 */
export async function upsertMcframeQty(
  companyId: string,
  rows: McframeQtyRow[]
): Promise<number> {
  await ensureSchema();
  const sql = getSql();
  // 1行ずつ往復すると数千件の取込がサーバーレスのタイムアウトに掛かるため、
  // 重複（年月×品目CD×格納場所CD）を畳んだうえで unnest による複数行INSERTにまとめる。
  const uniq = new Map<string, McframeQtyRow>();
  for (const r of rows) uniq.set(`${r.ym}\t${r.hinmokuCD}\t${r.kakunoCD}`, r);
  const list = [...uniq.values()];
  const chunkSize = 500;
  let count = 0;
  for (let i = 0; i < list.length; i += chunkSize) {
    const c = list.slice(i, i + chunkSize);
    await sql`
      INSERT INTO scrap_mcframe_qty (company_id, ym, hinmoku_cd, kakuno_cd, qty)
      SELECT ${companyId}, * FROM unnest(
        ${c.map((x) => x.ym)}::text[],
        ${c.map((x) => x.hinmokuCD)}::text[],
        ${c.map((x) => x.kakunoCD)}::text[],
        ${c.map((x) => x.qty)}::numeric[]
      )
      ON CONFLICT (company_id, ym, hinmoku_cd, kakuno_cd) DO UPDATE SET
        qty = EXCLUDED.qty, updated_at = NOW()`;
    count += c.length;
  }
  return count;
}

/** 日付×品目CD×格納場所CD で upsert（再取込は上書き）。取込件数を返す。 */
export async function upsertMcframeDays(
  companyId: string,
  rows: McframeDayRow[]
): Promise<number> {
  await ensureSchema();
  const sql = getSql();
  const uniq = new Map<string, McframeDayRow>();
  for (const r of rows) uniq.set(`${r.qdate}\t${r.hinmokuCD}\t${r.kakunoCD}`, r);
  const list = [...uniq.values()];
  const chunkSize = 500;
  let count = 0;
  for (let i = 0; i < list.length; i += chunkSize) {
    const c = list.slice(i, i + chunkSize);
    await sql`
      INSERT INTO scrap_mcframe_days (company_id, qdate, hinmoku_cd, kakuno_cd, qty)
      SELECT ${companyId}, * FROM unnest(
        ${c.map((x) => x.qdate)}::date[],
        ${c.map((x) => x.hinmokuCD)}::text[],
        ${c.map((x) => x.kakunoCD)}::text[],
        ${c.map((x) => x.qty)}::numeric[]
      )
      ON CONFLICT (company_id, qdate, hinmoku_cd, kakuno_cd) DO UPDATE SET
        qty = EXCLUDED.qty, updated_at = NOW()`;
    count += c.length;
  }
  return count;
}

/** 対象月に日別の加工数が入っているか（月次集計で日別を優先するかの判定）。 */
/**
 * 対象月の加工数が「日別」「月次取込（過去データ移行）」のどちらで入っているか。
 * 併存する月は日別だけを使う（二重計上を避けるため）ので、画面でその旨を出すのに使う。
 */
export async function mcframeSources(
  companyId: string,
  ym: string
): Promise<{ days: number; months: number }> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT
      (SELECT COUNT(*)::int FROM scrap_mcframe_days
        WHERE company_id = ${companyId} AND to_char(qdate, 'YYYY-MM') = ${ym}) AS days,
      (SELECT COUNT(*)::int FROM scrap_mcframe_qty
        WHERE company_id = ${companyId} AND ym = ${ym}) AS months`;
  return { days: Number(rows[0]?.days ?? 0), months: Number(rows[0]?.months ?? 0) };
}

export async function hasMcframeDays(companyId: string, ym: string): Promise<boolean> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT 1 FROM scrap_mcframe_days
    WHERE company_id = ${companyId} AND to_char(qdate, 'YYYY-MM') = ${ym} LIMIT 1`;
  return rows.length > 0;
}

// ===== ⑤ 月次入力 =====

function mapMonthly(r: any): MonthlyInput {
  return {
    ym: r.ym,
    factory: r.factory ?? "",
    zaikoDojo: numOrNull(r.zaiko_dojo),
    zaikoDokan: numOrNull(r.zaiko_dokan),
    zaikoSonota: numOrNull(r.zaiko_sonota),
    konyuDojo: numOrNull(r.konyu_dojo),
    konyuDokan: numOrNull(r.konyu_dokan),
    konyuSonota: numOrNull(r.konyu_sonota),
    baikyaku: numOrNull(r.baikyaku),
  };
}

/** 月次入力の一覧（年×工場）。 */
export async function listMonthlyInputs(
  companyId: string,
  year: number,
  factory: string
): Promise<MonthlyInput[]> {
  await ensureSchema();
  const sql = getSql();
  const prefix = `${year}-%`;
  const rows = await sql`
    SELECT * FROM scrap_monthly_inputs
    WHERE company_id = ${companyId} AND ym LIKE ${prefix} AND factory = ${factory}
    ORDER BY ym`;
  return rows.map(mapMonthly);
}

/** 月次入力に存在する工場の一覧（工場切替の選択肢用）。 */
export async function listMonthlyFactories(companyId: string): Promise<string[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT DISTINCT factory FROM scrap_monthly_inputs
    WHERE company_id = ${companyId} ORDER BY factory`;
  return rows.map((r: any) => String(r.factory));
}

/**
 * 対象月の月次入力。factory 指定でその工場、null で全社（全工場の合算）。
 * 合算では各値を SUM する（全行 NULL の列は NULL のまま）。
 */
export async function getMonthlyInput(
  companyId: string,
  ym: string,
  factory: string | null
): Promise<MonthlyInput | null> {
  await ensureSchema();
  const sql = getSql();
  if (factory !== null) {
    const rows = await sql`
      SELECT * FROM scrap_monthly_inputs
      WHERE company_id = ${companyId} AND ym = ${ym} AND factory = ${factory} LIMIT 1`;
    return rows[0] ? mapMonthly(rows[0]) : null;
  }
  const rows = await sql`
    SELECT ${ym} AS ym, '' AS factory,
      SUM(zaiko_dojo) AS zaiko_dojo, SUM(zaiko_dokan) AS zaiko_dokan, SUM(zaiko_sonota) AS zaiko_sonota,
      SUM(konyu_dojo) AS konyu_dojo, SUM(konyu_dokan) AS konyu_dokan, SUM(konyu_sonota) AS konyu_sonota,
      SUM(baikyaku) AS baikyaku, COUNT(*) AS cnt
    FROM scrap_monthly_inputs
    WHERE company_id = ${companyId} AND ym = ${ym}`;
  const r = rows[0];
  if (!r || Number(r.cnt) === 0) return null;
  return mapMonthly(r);
}

export async function saveMonthlyInput(companyId: string, m: MonthlyInput): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO scrap_monthly_inputs (
      company_id, ym, factory, zaiko_dojo, zaiko_dokan, zaiko_sonota,
      konyu_dojo, konyu_dokan, konyu_sonota, baikyaku
    ) VALUES (
      ${companyId}, ${m.ym}, ${m.factory}, ${m.zaikoDojo}, ${m.zaikoDokan}, ${m.zaikoSonota},
      ${m.konyuDojo}, ${m.konyuDokan}, ${m.konyuSonota}, ${m.baikyaku}
    )
    ON CONFLICT (company_id, ym, factory) DO UPDATE SET
      zaiko_dojo = EXCLUDED.zaiko_dojo,
      zaiko_dokan = EXCLUDED.zaiko_dokan,
      zaiko_sonota = EXCLUDED.zaiko_sonota,
      konyu_dojo = EXCLUDED.konyu_dojo,
      konyu_dokan = EXCLUDED.konyu_dokan,
      konyu_sonota = EXCLUDED.konyu_sonota,
      baikyaku = EXCLUDED.baikyaku,
      updated_at = NOW()`;
}

// ===== 調達入力（日次）と在庫補正 =====

export interface ProcureDay {
  pdate: string; // YYYY-MM-DD
  factory: string;
  konyuDojo: number | null;
  konyuDokan: number | null;
  konyuSonota: number | null;
  baikyaku: number | null;
  note: string;
  recordedBy: string;
}

export interface InventoryAdjustment {
  id: string;
  adate: string;
  factory: string;
  kubun: string;
  amount: number;
  reason: string;
  recordedBy: string;
}

function mapProcure(r: any): ProcureDay {
  return {
    pdate: dateStr(r.pdate),
    factory: r.factory,
    konyuDojo: numOrNull(r.konyu_dojo),
    konyuDokan: numOrNull(r.konyu_dokan),
    konyuSonota: numOrNull(r.konyu_sonota),
    baikyaku: numOrNull(r.baikyaku),
    note: r.note ?? "",
    recordedBy: r.recorded_by ?? "",
  };
}

/** 対象月×工場の日次調達データ。 */
export async function listProcureDays(
  companyId: string,
  ym: string,
  factory: string
): Promise<ProcureDay[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM scrap_procure_days
    WHERE company_id = ${companyId} AND factory = ${factory}
      AND to_char(pdate, 'YYYY-MM') = ${ym}
    ORDER BY pdate`;
  return rows.map(mapProcure);
}

/** 日次調達の upsert（日付×工場）。recordedBy はログインユーザー。件数を返す。 */
export async function upsertProcureDays(
  companyId: string,
  rows: Omit<ProcureDay, "recordedBy">[],
  recordedBy: string
): Promise<number> {
  await ensureSchema();
  const sql = getSql();
  let count = 0;
  for (const r of rows) {
    await sql`
      INSERT INTO scrap_procure_days (
        company_id, pdate, factory, konyu_dojo, konyu_dokan, konyu_sonota, baikyaku, note, recorded_by
      ) VALUES (
        ${companyId}, ${r.pdate}, ${r.factory}, ${r.konyuDojo}, ${r.konyuDokan},
        ${r.konyuSonota}, ${r.baikyaku}, ${r.note}, ${recordedBy}
      )
      ON CONFLICT (company_id, pdate, factory) DO UPDATE SET
        konyu_dojo = EXCLUDED.konyu_dojo,
        konyu_dokan = EXCLUDED.konyu_dokan,
        konyu_sonota = EXCLUDED.konyu_sonota,
        baikyaku = EXCLUDED.baikyaku,
        note = EXCLUDED.note,
        recorded_by = EXCLUDED.recorded_by,
        updated_at = NOW()`;
    count++;
  }
  return count;
}

export async function deleteProcureDay(
  companyId: string,
  pdate: string,
  factory: string
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    DELETE FROM scrap_procure_days
    WHERE company_id = ${companyId} AND pdate = ${pdate} AND factory = ${factory}`;
}

/** 対象月の日次調達の月間集計。factory null で全社。cnt=日次行数（0なら未使用）。 */
export async function monthlyProcureSums(
  companyId: string,
  ym: string,
  factory: string | null
): Promise<{
  cnt: number;
  konyuDojo: number;
  konyuDokan: number;
  konyuSonota: number;
  baikyaku: number | null;
}> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT COUNT(*)::int AS cnt,
      COALESCE(SUM(konyu_dojo), 0) AS k_dojo,
      COALESCE(SUM(konyu_dokan), 0) AS k_dokan,
      COALESCE(SUM(konyu_sonota), 0) AS k_sonota,
      SUM(baikyaku) AS baikyaku
    FROM scrap_procure_days
    WHERE company_id = ${companyId}
      AND to_char(pdate, 'YYYY-MM') = ${ym}
      AND (${factory}::text IS NULL OR factory = ${factory})`;
  const r = rows[0] ?? {};
  return {
    cnt: Number(r.cnt) || 0,
    konyuDojo: num(r.k_dojo),
    konyuDokan: num(r.k_dokan),
    konyuSonota: num(r.k_sonota),
    baikyaku: numOrNull(r.baikyaku),
  };
}

/** 在庫補正の一覧（対象月×工場。factory null で全社）。 */
export async function listAdjustments(
  companyId: string,
  ym: string,
  factory: string | null
): Promise<InventoryAdjustment[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT * FROM scrap_inventory_adjustments
    WHERE company_id = ${companyId}
      AND to_char(adate, 'YYYY-MM') = ${ym}
      AND (${factory}::text IS NULL OR factory = ${factory})
    ORDER BY adate, created_at`;
  return rows.map((r: any) => ({
    id: r.id,
    adate: dateStr(r.adate),
    factory: r.factory,
    kubun: r.kubun,
    amount: num(r.amount),
    reason: r.reason,
    recordedBy: r.recorded_by ?? "",
  }));
}

export async function addAdjustment(
  companyId: string,
  adj: Omit<InventoryAdjustment, "id">
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO scrap_inventory_adjustments (company_id, adate, factory, kubun, amount, reason, recorded_by)
    VALUES (${companyId}, ${adj.adate}, ${adj.factory}, ${adj.kubun}, ${adj.amount}, ${adj.reason}, ${adj.recordedBy})`;
}

export async function deleteAdjustment(companyId: string, id: string): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`DELETE FROM scrap_inventory_adjustments WHERE company_id = ${companyId} AND id = ${id}`;
}

/** 対象月の在庫補正の区分別合計。factory null で全社。 */
export async function monthlyAdjSums(
  companyId: string,
  ym: string,
  factory: string | null
): Promise<{ 銅条: number; 銅管: number; その他: number }> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT
      COALESCE(SUM(amount) FILTER (WHERE kubun = '銅条'), 0) AS a_dojo,
      COALESCE(SUM(amount) FILTER (WHERE kubun = '銅管'), 0) AS a_dokan,
      COALESCE(SUM(amount) FILTER (WHERE kubun NOT IN ('銅条', '銅管')), 0) AS a_sonota
    FROM scrap_inventory_adjustments
    WHERE company_id = ${companyId}
      AND to_char(adate, 'YYYY-MM') = ${ym}
      AND (${factory}::text IS NULL OR factory = ${factory})`;
  const r = rows[0] ?? {};
  return { 銅条: num(r.a_dojo), 銅管: num(r.a_dokan), その他: num(r.a_sonota) };
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
  // ポータル未配信の工場でも、実データがあれば切替先に出す
  // （過去データを取り込んだだけの工場や、重量計を登録しただけの工場が
  //   選べなくなるのを防ぐ）。
  const used = await sql`
    SELECT DISTINCT factory FROM (
      SELECT factory FROM scrap_daily_records WHERE company_id = ${companyId}
      UNION ALL SELECT factory FROM scrap_monthly_inputs WHERE company_id = ${companyId}
      UNION ALL SELECT factory FROM scrap_procure_days WHERE company_id = ${companyId}
      UNION ALL SELECT factory FROM scrap_items WHERE company_id = ${companyId}
      UNION ALL SELECT factory FROM scrap_scales WHERE company_id = ${companyId}
      UNION ALL SELECT factory FROM scrap_bags WHERE company_id = ${companyId}
    ) t WHERE factory <> '' ORDER BY factory`;
  for (const u of used) {
    const name = String(u.factory);
    if (!names.includes(name)) names.push(name);
  }
  return names;
}
