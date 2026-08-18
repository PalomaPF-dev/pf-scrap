import { getSql } from "./neon";
import { ensureSchema } from "./schema";

/* eslint-disable @typescript-eslint/no-explicit-any */

// 型・定数はクライアント/サーバー共用の scrapTypes.ts に分離（ここから再エクスポート）
export {
  KUBUN_LIST,
  SCALE_KIND_LIST,
  DAILY_STATUS_LABEL,
  FA_STATUS_LABEL,
  type FaStatus,
  type FirstArticle,
  type Kubun,
  type ScaleKind,
  type DailyStatus,
  type ScrapItem,
  type DailyEntry,
  type DailyRecord,
  type Scale,
} from "./scrapTypes";
import {
  type FirstArticle as _FirstArticle,
  type FaStatus as _FaStatus,
  type ScrapItem as _ScrapItem,
  type DailyRecord as _DailyRecord,
  type DailyStatus as _DailyStatus,
  type Scale as _Scale,
} from "./scrapTypes";
type ScrapItem = _ScrapItem;
type FirstArticle = _FirstArticle;
type FaStatus = _FaStatus;
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
  // 子図番・親図番・管理図番・KEY・品名で検索（子図番での呼び出しが主用途）
  const rows = await sql`
    SELECT *, COUNT(*) OVER() AS total FROM scrap_items
    WHERE company_id = ${companyId}
      AND (${q} = '' OR ko_zuban ILIKE ${like} OR oya_zuban ILIKE ${like}
           OR kanri_zuban ILIKE ${like} OR key ILIKE ${like}
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
    SELECT seizo_basho_mei AS name, COUNT(DISTINCT key) AS cnt
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
  for (const it of items) uniq.set(`${it.key}\t${it.koZuban}`, it);
  const list = [...uniq.values()];
  let count = 0;
  for (let i = 0; i < list.length; i += chunkSize) {
    const c = list.slice(i, i + chunkSize);
    await sql`
      INSERT INTO scrap_items (
        company_id, kanri_zuban, hinmei, key, kubun, oya_zuban, oya_hinmei,
        ko_zuban, ko_hinmei, tani, kosei_juryo, kansei_juryo,
        seizo_basho_cd, seizo_basho_mei, factory
      )
      SELECT ${companyId}, * FROM unnest(
        ${c.map((x) => x.kanriZuban)}::text[], ${c.map((x) => x.hinmei)}::text[],
        ${c.map((x) => x.key)}::text[], ${c.map((x) => x.kubun)}::text[],
        ${c.map((x) => x.oyaZuban)}::text[], ${c.map((x) => x.oyaHinmei)}::text[],
        ${c.map((x) => x.koZuban)}::text[], ${c.map((x) => x.koHinmei)}::text[],
        ${c.map((x) => x.tani)}::text[], ${c.map((x) => x.koseiJuryo)}::numeric[],
        ${c.map((x) => x.kanseiJuryo)}::numeric[], ${c.map((x) => x.seizoBashoCD)}::text[],
        ${c.map((x) => x.seizoBashoMei)}::text[], ${c.map((x) => x.factory)}::text[]
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
        factory = ${s.factory}, sort = ${s.sort}, active = ${s.active}
      WHERE company_id = ${companyId} AND id = ${s.id}`;
    return s.id;
  }
  const rows = await sql`
    INSERT INTO scrap_scales (company_id, qr_code, equip_no, name, kind, factory, sort, active)
    VALUES (${companyId}, ${s.qrCode}, ${s.equipNo}, ${s.name}, ${s.kind}, ${s.factory}, ${s.sort}, ${s.active})
    ON CONFLICT (company_id, qr_code) DO UPDATE SET
      equip_no = EXCLUDED.equip_no, name = EXCLUDED.name, kind = EXCLUDED.kind,
      factory = EXCLUDED.factory, sort = EXCLUDED.sort, active = EXCLUDED.active
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
      kirokusha: e.kirokusha,
      ijo: e.ijo,
    })),
  };
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
           weight, cum_before, cum_after, kirokusha, ijo
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
      INSERT INTO scrap_daily_entries (
        company_id, record_id, jikoku, hinshu, scale_id, scale_name,
        gross_weight, tare_weight, weight, cum_before, cum_after, kirokusha, ijo, sort
      )
      VALUES (
        ${companyId}, ${recordId}, ${e.jikoku}, ${e.hinshu}, ${e.scaleId}, ${e.scaleName},
        ${e.grossWeight}, ${e.tareWeight}, ${e.weight}, ${e.cumBefore}, ${e.cumAfter},
        ${e.kirokusha}, ${e.ijo}, ${i}
      )`;
  }
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
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM scrap_daily_records
    WHERE company_id = ${companyId} AND status = 'pending'
      AND (${factory}::text IS NULL OR factory = ${factory})`;
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
  /** 箱の種類（上銅/銅ダライ）別の合計。それ以外（旧様式の記録）は「その他」 */
  byKind: { 上銅: number; 銅ダライ: number; その他: number };
  ijoCount: number;
}

/** 月間の日次記録集計（1日1工場1行、箱の種類別合計つき）。 */
export async function listDailyAgg(
  companyId: string,
  ym: string,
  factory: string | null
): Promise<DailyAggRow[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT r.record_date, r.factory, r.sekininsha, r.shonin, r.status, r.applied_by, r.approved_by,
      r.kaishu_sokuteichi,
      COALESCE(SUM(e.weight), 0) AS total,
      COALESCE(SUM(e.weight) FILTER (WHERE e.hinshu = '上銅'), 0) AS w_jodo,
      COALESCE(SUM(e.weight) FILTER (WHERE e.hinshu = '銅ダライ'), 0) AS w_darai,
      COALESCE(SUM(e.weight) FILTER (WHERE e.hinshu NOT IN ('上銅', '銅ダライ')), 0) AS w_sonota,
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
    status: (r.status ?? "draft") as DailyStatus,
    appliedBy: r.applied_by ?? "",
    approvedBy: r.approved_by ?? "",
    kaishuSokuteichi: numOrNull(r.kaishu_sokuteichi),
    total: num(r.total),
    byKind: { 上銅: num(r.w_jodo), 銅ダライ: num(r.w_darai), その他: num(r.w_sonota) },
    ijoCount: Number(r.ijo_count) || 0,
  }));
}

/** 月間の日次記録合計（箱の種類別）。⑥の突合に使う。factory 指定で自工場のみ。 */
export async function dailyMonthTotals(
  companyId: string,
  ym: string,
  factory: string | null = null
): Promise<{ total: number; byKind: { 上銅: number; 銅ダライ: number; その他: number }; days: number }> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT
      COALESCE(SUM(e.weight), 0) AS total,
      COALESCE(SUM(e.weight) FILTER (WHERE e.hinshu = '上銅'), 0) AS w_jodo,
      COALESCE(SUM(e.weight) FILTER (WHERE e.hinshu = '銅ダライ'), 0) AS w_darai,
      COALESCE(SUM(e.weight) FILTER (WHERE e.hinshu NOT IN ('上銅', '銅ダライ')), 0) AS w_sonota,
      COUNT(DISTINCT r.id) AS days
    FROM scrap_daily_records r
    LEFT JOIN scrap_daily_entries e ON e.record_id = r.id
    WHERE r.company_id = ${companyId}
      AND to_char(r.record_date, 'YYYY-MM') = ${ym}
      AND (${factory}::text IS NULL OR r.factory = ${factory})`;
  const r = rows[0] ?? {};
  return {
    total: num(r.total),
    byKind: { 上銅: num(r.w_jodo), 銅ダライ: num(r.w_darai), その他: num(r.w_sonota) },
    days: Number(r.days) || 0,
  };
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
    SELECT f.measured_on, f.item_key, f.weight, f.sokuteisha,
      f.status, f.approved_by, f.reject_comment,
      (SELECT hinmei FROM scrap_items i
        WHERE i.company_id = f.company_id AND i.key = f.item_key
        ORDER BY i.ko_zuban LIMIT 1) AS hinmei,
      (SELECT kansei_juryo FROM scrap_items i
        WHERE i.company_id = f.company_id AND i.key = f.item_key
        ORDER BY i.ko_zuban LIMIT 1) AS kansei_juryo
    FROM scrap_first_articles f
    WHERE f.company_id = ${companyId}
      AND (${factory}::text IS NULL OR EXISTS (
        SELECT 1 FROM scrap_items i
        WHERE i.company_id = f.company_id AND i.key = f.item_key
          AND (i.factory = ${factory} OR i.factory = '')))
    ORDER BY f.measured_on DESC, f.item_key
    LIMIT ${limit}`;
  return rows.map((r: any) => ({
    measuredOn: dateStr(r.measured_on),
    itemKey: r.item_key,
    weight: num(r.weight),
    sokuteisha: r.sokuteisha,
    status: (r.status ?? "approved") as FaStatus,
    approvedBy: r.approved_by ?? "",
    rejectComment: r.reject_comment ?? "",
    hinmei: r.hinmei ?? null,
    kanseiJuryo: numOrNull(r.kansei_juryo),
  }));
}

/** 登録＝管理者への申請（status='pending'）。再登録は再申請扱い。 */
export async function upsertFirstArticle(
  companyId: string,
  fa: { measuredOn: string; itemKey: string; weight: number; sokuteisha: string }
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO scrap_first_articles (company_id, measured_on, item_key, weight, sokuteisha, status)
    VALUES (${companyId}, ${fa.measuredOn}, ${fa.itemKey}, ${fa.weight}, ${fa.sokuteisha}, 'pending')
    ON CONFLICT (company_id, measured_on, item_key) DO UPDATE SET
      weight = EXCLUDED.weight, sokuteisha = EXCLUDED.sokuteisha,
      status = 'pending', approved_by = '', approved_at = NULL, reject_comment = ''`;
}

/** 初品測定の承認/差し戻し（管理者のみが呼ぶ）。 */
export async function updateFirstArticleStatus(
  companyId: string,
  measuredOn: string,
  itemKey: string,
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
      WHERE company_id = ${companyId} AND measured_on = ${measuredOn} AND item_key = ${itemKey}`;
  } else {
    await sql`
      UPDATE scrap_first_articles SET status = 'rejected',
        approved_by = ${patch.approvedBy}, approved_at = NOW(),
        reject_comment = ${patch.rejectComment}
      WHERE company_id = ${companyId} AND measured_on = ${measuredOn} AND item_key = ${itemKey}`;
  }
}

/** 申請中（pending）の初品測定の件数。ポータルの承認待ちバッジ用。 */
export async function countPendingFirstArticles(companyId: string): Promise<number> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT COUNT(*)::int AS n FROM scrap_first_articles
    WHERE company_id = ${companyId} AND status = 'pending'`;
  return Number(rows[0]?.n ?? 0);
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
  // 1行ずつ往復すると数千件の取込がサーバーレスのタイムアウトに掛かるため、
  // 重複（年月×KEY）を畳んだうえで unnest による複数行INSERTにまとめる。
  const uniq = new Map<string, { ym: string; itemKey: string; qty: number }>();
  for (const r of rows) uniq.set(`${r.ym}\t${r.itemKey}`, r);
  const list = [...uniq.values()];
  const chunkSize = 500;
  let count = 0;
  for (let i = 0; i < list.length; i += chunkSize) {
    const c = list.slice(i, i + chunkSize);
    await sql`
      INSERT INTO scrap_mcframe_qty (company_id, ym, item_key, qty)
      SELECT ${companyId}, * FROM unnest(
        ${c.map((x) => x.ym)}::text[],
        ${c.map((x) => x.itemKey)}::text[],
        ${c.map((x) => x.qty)}::numeric[]
      )
      ON CONFLICT (company_id, ym, item_key) DO UPDATE SET
        qty = EXCLUDED.qty, updated_at = NOW()`;
    count += c.length;
  }
  return count;
}

/** 日付×KEY で upsert（再取込は上書き）。取込件数を返す。 */
export async function upsertMcframeDays(
  companyId: string,
  rows: { qdate: string; itemKey: string; qty: number }[]
): Promise<number> {
  await ensureSchema();
  const sql = getSql();
  const uniq = new Map<string, { qdate: string; itemKey: string; qty: number }>();
  for (const r of rows) uniq.set(`${r.qdate}\t${r.itemKey}`, r);
  const list = [...uniq.values()];
  const chunkSize = 500;
  let count = 0;
  for (let i = 0; i < list.length; i += chunkSize) {
    const c = list.slice(i, i + chunkSize);
    await sql`
      INSERT INTO scrap_mcframe_days (company_id, qdate, item_key, qty)
      SELECT ${companyId}, * FROM unnest(
        ${c.map((x) => x.qdate)}::date[],
        ${c.map((x) => x.itemKey)}::text[],
        ${c.map((x) => x.qty)}::numeric[]
      )
      ON CONFLICT (company_id, qdate, item_key) DO UPDATE SET
        qty = EXCLUDED.qty, updated_at = NOW()`;
    count += c.length;
  }
  return count;
}

/** 対象月に日別の加工数が入っているか（月次集計で日別を優先するかの判定）。 */
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
  // （過去データを取り込んだだけの工場が選べなくなるのを防ぐ）。
  const used = await sql`
    SELECT DISTINCT factory FROM (
      SELECT factory FROM scrap_daily_records WHERE company_id = ${companyId}
      UNION ALL SELECT factory FROM scrap_monthly_inputs WHERE company_id = ${companyId}
      UNION ALL SELECT factory FROM scrap_procure_days WHERE company_id = ${companyId}
      UNION ALL SELECT factory FROM scrap_items WHERE company_id = ${companyId}
    ) t WHERE factory <> '' ORDER BY factory`;
  for (const u of used) {
    const name = String(u.factory);
    if (!names.includes(name)) names.push(name);
  }
  return names;
}
