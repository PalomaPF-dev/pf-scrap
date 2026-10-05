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
  type Shipment,
  shipmentGap,
  shipmentGapLarge,
  shipmentPair,
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
  type Shipment as _Shipment,
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
type Shipment = _Shipment;

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
      auto_added = false,
      updated_at = NOW()
    RETURNING id`;
  await dropAutoAddedDuplicates(companyId);
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
        auto_added = false,
        updated_at = NOW()`;
    count += c.length;
  }
  await dropAutoAddedDuplicates(companyId);
  return count;
}

/**
 * 本物の品目マスター行が入った品目について、McFrame実績から自動登録した仮行を消す。
 * 仮行（重量0）が残ると、完成重量(理論)を子図番順の先頭から取る集計で 0 を拾ってしまう。
 */
async function dropAutoAddedDuplicates(companyId: string): Promise<void> {
  const sql = getSql();
  await sql`
    DELETE FROM scrap_items a
    WHERE a.company_id = ${companyId} AND a.auto_added = true
      AND EXISTS (
        SELECT 1 FROM scrap_items b
        WHERE b.company_id = a.company_id AND b.auto_added = false
          AND b.kanri_zuban = a.kanri_zuban AND b.kakuno_cd = a.kakuno_cd)`;
}

/**
 * McFrameの製造実績に出てくる品目のうち、品目マスターに無いものを登録する。
 * McFrameが正なので取り込むが、実績出力には構成重量・完成重量(理論)が無いので重量は0のまま。
 * 既にある品目（本物・仮を問わず）は触らない。登録した品目CDの一覧を返す。
 */
export async function addMissingItemsFromMcframe(
  companyId: string,
  items: {
    hinmokuCD: string;
    kakunoCD: string;
    hinmei: string;
    kakunoMei: string;
    seizoBashoCD: string;
    seizoBashoMei: string;
  }[],
  factoryOptions: string[]
): Promise<{ hinmokuCD: string; kakunoCD: string; hinmei: string }[]> {
  await ensureSchema();
  const sql = getSql();
  const uniq = new Map<string, (typeof items)[number]>();
  for (const it of items) {
    if (!it.hinmokuCD || !it.kakunoCD) continue;
    uniq.set(`${it.hinmokuCD}\t${it.kakunoCD}`, it);
  }
  if (uniq.size === 0) return [];
  const list = [...uniq.values()];
  const known = await sql`
    SELECT DISTINCT kanri_zuban, kakuno_cd FROM scrap_items
    WHERE company_id = ${companyId}
      AND kanri_zuban = ANY(${list.map((x) => x.hinmokuCD)}::text[])`;
  const have = new Set(known.map((r: any) => `${r.kanri_zuban}\t${r.kakuno_cd}`));
  const missing = list.filter((x) => !have.has(`${x.hinmokuCD}\t${x.kakunoCD}`));
  if (missing.length === 0) return [];
  // 工場は場所名から推定する（「直方内胴組立」→「直方」）。分からなければ空（全工場から見える）
  const guessFactory = (it: (typeof items)[number]) => {
    const hay = `${it.kakunoMei} ${it.seizoBashoMei}`;
    // 「直方工場」のように工場名に接尾辞が付いていても拾えるようにする
    const hit = factoryOptions
      .filter((f) => f && (hay.includes(f) || hay.includes(f.replace(/(工場|製造所)$/, ""))))
      .sort((a, b) => b.length - a.length);
    return hit[0] ?? "";
  };
  const chunkSize = 200;
  for (let i = 0; i < missing.length; i += chunkSize) {
    const c = missing.slice(i, i + chunkSize);
    await sql`
      INSERT INTO scrap_items (
        company_id, kanri_zuban, hinmei, kubun, ko_zuban, tani,
        kosei_juryo, kansei_juryo, seizo_basho_cd, seizo_basho_mei,
        kakuno_cd, kakuno_mei, factory, auto_added
      )
      SELECT ${companyId}, t.z, t.n, 'その他', '', 'K', 0, 0, t.sc, t.sm, t.kc, t.km, t.f, true
      FROM unnest(
        ${c.map((x) => x.hinmokuCD)}::text[], ${c.map((x) => x.hinmei)}::text[],
        ${c.map((x) => x.seizoBashoCD)}::text[], ${c.map((x) => x.seizoBashoMei)}::text[],
        ${c.map((x) => x.kakunoCD)}::text[], ${c.map((x) => x.kakunoMei)}::text[],
        ${c.map((x) => guessFactory(x))}::text[]
      ) AS t(z, n, sc, sm, kc, km, f)
      ON CONFLICT (company_id, kanri_zuban, kakuno_cd, ko_zuban) DO NOTHING`;
  }
  return missing.map((x) => ({
    hinmokuCD: x.hinmokuCD,
    kakunoCD: x.kakunoCD,
    hinmei: x.hinmei,
  }));
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
      originFactory: e.origin_factory ?? "",
      shipmentId: e.shipment_id ?? null,
      polyTare: numOrNull(e.poly_tare),
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
           busho, kikai, zairyo, kotei, origin_factory, shipment_id, poly_tare
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
        bag_id, kirokusha, ijo, busho, kikai, zairyo, kotei, sort,
        origin_factory, shipment_id, poly_tare
      )
      VALUES (
        ${companyId}, ${recordId}, ${e.jikoku}, ${e.hinshu}, ${e.scaleId}, ${e.scaleName},
        ${e.grossWeight}, ${e.tareWeight}, ${e.weight}, ${e.cumBefore}, ${e.cumAfter},
        ${e.cumBeforeReason ?? ""}, ${e.cumAfterReason ?? ""},
        ${e.cumBeforeReadId ?? null}, ${e.cumAfterReadId ?? null},
        ${e.bagId ?? null}, ${e.kirokusha}, ${e.ijo},
        ${e.busho ?? ""}, ${e.kikai ?? ""}, ${e.zairyo ?? ""}, ${e.kotei ?? ""}, ${i},
        ${e.originFactory ?? ""}, ${e.shipmentId ?? null}, ${e.polyTare ?? null}
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
  /** どの職場のスクラップか */
  workplace: string;
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
           e.kirokusha, e.ijo,
           -- 他工場から届いたプラ箱は職場の代わりに「送った工場 プラ箱 番号」
           CASE WHEN e.shipment_id IS NOT NULL
             THEN COALESCE((SELECT 'プラ箱 ' || sh.box_no FROM scrap_shipments sh
                            WHERE sh.id = e.shipment_id), 'プラ箱')
             ELSE e.busho END AS busho
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
    workplace: r.busho ?? "",
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
/**
 * 日次記録の月合計。
 *
 * 工場間でプラ箱を送る運用（本社工場 → 大口工場など）があるため、2つの数え方を持つ。
 * - total / byKind … 発生元の工場で数える（理論スクラップとの照合用）。
 *     他工場から届いたプラ箱は送った工場の分。月は出荷日で数える（生産した月に合わせる）。
 * - processed … その工場のスクラップ箱で量った分（売却との突合用。売却は処理した工場で行う）。
 * - incoming … processed のうち、他工場から届いた分
 * - outgoing … total のうち、他工場で量った分（送った側から見た「送って処理された量」）
 * factory が null（全社合算）のときは incoming/outgoing は 0。
 */
export async function dailyMonthTotals(
  companyId: string,
  ym: string,
  factory: string | null = null
): Promise<{
  total: number;
  byKind: Record<string, number>;
  days: number;
  processed: number;
  incoming: number;
  outgoing: number;
}> {
  await ensureSchema();
  const sql = getSql();
  const [totals, kinds, days] = await Promise.all([
    sql`
      SELECT
        COALESCE(SUM(e.weight) FILTER (
          WHERE to_char(COALESCE(s.ship_date, r.record_date), 'YYYY-MM') = ${ym}
            AND (${factory}::text IS NULL OR COALESCE(NULLIF(e.origin_factory, ''), r.factory) = ${factory})
        ), 0) AS total,
        COALESCE(SUM(e.weight) FILTER (
          WHERE to_char(r.record_date, 'YYYY-MM') = ${ym}
            AND (${factory}::text IS NULL OR r.factory = ${factory})
        ), 0) AS processed,
        COALESCE(SUM(e.weight) FILTER (
          WHERE ${factory}::text IS NOT NULL AND to_char(r.record_date, 'YYYY-MM') = ${ym}
            AND r.factory = ${factory} AND e.origin_factory <> '' AND e.origin_factory <> r.factory
        ), 0) AS incoming,
        COALESCE(SUM(e.weight) FILTER (
          WHERE ${factory}::text IS NOT NULL
            AND to_char(COALESCE(s.ship_date, r.record_date), 'YYYY-MM') = ${ym}
            AND e.origin_factory = ${factory} AND r.factory <> ${factory}
        ), 0) AS outgoing
      FROM scrap_daily_entries e
      JOIN scrap_daily_records r ON r.id = e.record_id
      LEFT JOIN scrap_shipments s ON s.id = e.shipment_id
      WHERE r.company_id = ${companyId}
        AND (to_char(r.record_date, 'YYYY-MM') = ${ym} OR to_char(s.ship_date, 'YYYY-MM') = ${ym})`,
    sql`
      SELECT e.hinshu, SUM(e.weight) AS w
      FROM scrap_daily_entries e
      JOIN scrap_daily_records r ON r.id = e.record_id
      LEFT JOIN scrap_shipments s ON s.id = e.shipment_id
      WHERE r.company_id = ${companyId}
        AND to_char(COALESCE(s.ship_date, r.record_date), 'YYYY-MM') = ${ym}
        AND (${factory}::text IS NULL OR COALESCE(NULLIF(e.origin_factory, ''), r.factory) = ${factory})
      GROUP BY e.hinshu`,
    sql`
      SELECT COUNT(*)::int AS days FROM scrap_daily_records r
      WHERE r.company_id = ${companyId}
        AND to_char(r.record_date, 'YYYY-MM') = ${ym}
        AND (${factory}::text IS NULL OR r.factory = ${factory})`,
  ]);
  const byKind: Record<string, number> = {};
  for (const k of kinds) byKind[String((k as any).hinshu)] = num((k as any).w);
  const t = totals[0] ?? {};
  return {
    total: num((t as any).total),
    byKind,
    days: Number(days[0]?.days) || 0,
    processed: num((t as any).processed),
    incoming: num((t as any).incoming),
    outgoing: num((t as any).outgoing),
  };
}

// ===== ③ 初品重量測定 =====

export async function listFirstArticles(
  companyId: string,
  limit = 200,
  /**
   * 指定すると、その工場の測定記録だけを返す。登録時に選んでいた工場か、品目マスターの工場で判定。
   * 承認待ち（pending）は件数の上限に関係なく先頭に並べる（古い記録に押し出されて承認できなくならないように）。
   */
  factory: string | null = null
): Promise<FirstArticle[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT f.measured_on, f.hinmoku_cd, f.kakuno_cd, f.weight, f.sokuteisha,
      f.status, f.approved_by, f.reject_comment, f.note, f.factory,
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
      AND (${factory}::text IS NULL
        -- 登録時に選んでいた工場。品目マスターの工場名と違っても、登録した工場の履歴には必ず出す
        OR f.factory = ${factory}
        -- 品目マスターの工場（工場未設定の品目はどの工場にも出す）
        OR EXISTS (
          SELECT 1 FROM scrap_items i
          WHERE i.company_id = f.company_id
            AND i.kanri_zuban = f.hinmoku_cd AND i.kakuno_cd = f.kakuno_cd
            AND (i.factory = ${factory} OR i.factory = ''))
        -- 登録工場が分からず品目マスターにも無い記録は、どの工場でも見せる（どこにも出ないと承認できない）
        OR (f.factory = '' AND NOT EXISTS (
          SELECT 1 FROM scrap_items i
          WHERE i.company_id = f.company_id
            AND i.kanri_zuban = f.hinmoku_cd AND i.kakuno_cd = f.kakuno_cd)))
    ORDER BY (f.status = 'pending') DESC, f.measured_on DESC, f.hinmoku_cd, f.kakuno_cd
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
    factory: r.factory ?? "",
    hinmei: r.hinmei ?? null,
    kanseiJuryo: numOrNull(r.kansei_juryo),
  }));
}

/**
 * 選択中の工場の測定履歴に出ない記録の件数（全体・うち承認待ち）。
 * 一覧は件数に上限があるので、一覧どうしの引き算ではなくここで数える。
 */
export async function countOtherFirstArticles(
  companyId: string,
  factory: string
): Promise<{ total: number; pending: number }> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE f.status = 'pending')::int AS pending
    FROM scrap_first_articles f
    WHERE f.company_id = ${companyId}
      AND NOT (f.factory = ${factory}
        OR EXISTS (
          SELECT 1 FROM scrap_items i
          WHERE i.company_id = f.company_id
            AND i.kanri_zuban = f.hinmoku_cd AND i.kakuno_cd = f.kakuno_cd
            AND (i.factory = ${factory} OR i.factory = ''))
        OR (f.factory = '' AND NOT EXISTS (
          SELECT 1 FROM scrap_items i
          WHERE i.company_id = f.company_id
            AND i.kanri_zuban = f.hinmoku_cd AND i.kakuno_cd = f.kakuno_cd)))`;
  return { total: Number(rows[0]?.total ?? 0), pending: Number(rows[0]?.pending ?? 0) };
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
    /** 登録したときに画面で選んでいた工場（測定履歴の表示先） */
    factory: string;
  }
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await sql`
    INSERT INTO scrap_first_articles
      (company_id, measured_on, hinmoku_cd, kakuno_cd, weight, sokuteisha, status, factory)
    VALUES (${companyId}, ${fa.measuredOn}, ${fa.hinmokuCD}, ${fa.kakunoCD},
            ${fa.weight}, ${fa.sokuteisha}, 'pending', ${fa.factory})
    ON CONFLICT (company_id, measured_on, hinmoku_cd, kakuno_cd) DO UPDATE SET
      weight = EXCLUDED.weight, sokuteisha = EXCLUDED.sokuteisha,
      status = 'pending', approved_by = '', approved_at = NULL, reject_comment = '',
      factory = CASE WHEN EXCLUDED.factory <> '' THEN EXCLUDED.factory ELSE scrap_first_articles.factory END`;
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

/**
 * 品質チェックシート取込の一括登録。シートはG長確認済みの記録なので、取り込んだ管理者の
 * 承認として登録する（status='approved'）。同じ測定日×品目があれば上書き。登録件数を返す。
 */
export async function bulkImportFirstArticles(
  companyId: string,
  rows: {
    measuredOn: string;
    hinmokuCD: string;
    /** 品目マスターに無い図番は ''（格納場所が分からないまま登録する） */
    kakunoCD: string;
    weight: number;
    sokuteisha: string;
    /** 取り込んだときに選んでいた工場（一覧の工場列・所属工場の絞り込みに使う） */
    factory: string;
    /** 由来メモ（マスター未登録の品名など）。空なら従来どおり */
    note: string;
  }[],
  approvedBy: string
): Promise<number> {
  await ensureSchema();
  const sql = getSql();
  let n = 0;
  for (const r of rows) {
    await sql`
      INSERT INTO scrap_first_articles
        (company_id, measured_on, hinmoku_cd, kakuno_cd, weight, sokuteisha,
         status, approved_by, approved_at, factory, note)
      VALUES (${companyId}, ${r.measuredOn}, ${r.hinmokuCD}, ${r.kakunoCD},
              ${r.weight}, ${r.sokuteisha}, 'approved', ${approvedBy}, NOW(), ${r.factory}, ${r.note})
      ON CONFLICT (company_id, measured_on, hinmoku_cd, kakuno_cd) DO UPDATE SET
        weight = EXCLUDED.weight, sokuteisha = EXCLUDED.sokuteisha,
        status = 'approved', approved_by = EXCLUDED.approved_by,
        approved_at = NOW(), reject_comment = '',
        factory = CASE WHEN EXCLUDED.factory <> '' THEN EXCLUDED.factory ELSE scrap_first_articles.factory END,
        note = EXCLUDED.note`;
    n++;
  }
  return n;
}

/**
 * 初品測定をまとめて削除する（一覧画面の削除。管理者のみが呼ぶ）。
 * factory を渡すと、その工場のもの（登録時の工場、または品目マスターの工場が一致）だけ消す。
 * 工場が分からない記録は所属工場の人には消させない（取り違え防止）。消した件数を返す。
 */
export async function deleteFirstArticles(
  companyId: string,
  keys: { measuredOn: string; hinmokuCD: string; kakunoCD: string }[],
  factory: string | null
): Promise<number> {
  if (keys.length === 0) return 0;
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    DELETE FROM scrap_first_articles f
    WHERE f.company_id = ${companyId}
      AND (f.measured_on, f.hinmoku_cd, f.kakuno_cd) IN (
        SELECT d, h, k FROM unnest(
          ${keys.map((x) => x.measuredOn)}::date[],
          ${keys.map((x) => x.hinmokuCD)}::text[],
          ${keys.map((x) => x.kakunoCD)}::text[]) AS t(d, h, k))
      AND (${factory}::text IS NULL
        OR f.factory = ${factory}
        OR EXISTS (
          SELECT 1 FROM scrap_items i
          WHERE i.company_id = f.company_id
            AND i.kanri_zuban = f.hinmoku_cd AND i.kakuno_cd = f.kakuno_cd
            AND i.factory = ${factory}))
    RETURNING 1`;
  return rows.length;
}

/**
 * 図番（品目CD、無ければ子図番）から品目を引く。品質チェックシート取込用。
 * 工場を指定すればその工場（と工場未設定）の品目だけ。品目CD×格納場所CDで1件に畳む。
 */
export async function findItemsByZuban(
  companyId: string,
  zubans: string[],
  factory: string | null
): Promise<ScrapItem[]> {
  await ensureSchema();
  const sql = getSql();
  if (zubans.length === 0) return [];
  const rows = await sql`
    SELECT DISTINCT ON (kanri_zuban, kakuno_cd, ko_zuban) * FROM scrap_items
    WHERE company_id = ${companyId}
      AND (kanri_zuban = ANY(${zubans}::text[]) OR ko_zuban = ANY(${zubans}::text[]))
      AND (${factory}::text IS NULL OR factory = ${factory} OR factory = '')
    ORDER BY kanri_zuban, kakuno_cd, ko_zuban`;
  return rows.map(mapItem);
}

// ===== 初品測定の一覧（月・工場・品目・状態で絞り込み。一覧画面と CSV 出力で共用） =====

export interface FirstArticleListRow extends FirstArticle {
  /** 品目マスターの工場（登録時の工場が空のときの表示用） */
  itemFactory: string;
}

export interface FirstArticleFilter {
  /** 'YYYY-MM'。null なら全期間 */
  ym?: string | null;
  /** 工場。null なら全工場。判定は listFirstArticles と同じ（登録時の工場 or 品目マスターの工場） */
  factory?: string | null;
  /** 品目CD・格納場所CD・品名・子図番・測定者の部分一致 */
  q?: string;
  status?: FaStatus | null;
  limit?: number;
}

export async function listFirstArticlesFiltered(
  companyId: string,
  f: FirstArticleFilter = {}
): Promise<FirstArticleListRow[]> {
  await ensureSchema();
  const sql = getSql();
  const ym = f.ym ?? null;
  const factory = f.factory ?? null;
  const q = (f.q ?? "").trim();
  const like = `%${q}%`;
  const status = f.status ?? null;
  const limit = Math.min(Math.max(f.limit ?? 1000, 1), 5000);
  const rows = await sql`
    SELECT f.measured_on, f.hinmoku_cd, f.kakuno_cd, f.weight, f.sokuteisha,
      f.status, f.approved_by, f.reject_comment, f.note, f.factory,
      i.hinmei, i.kansei_juryo, i.factory AS item_factory
    FROM scrap_first_articles f
    LEFT JOIN LATERAL (
      SELECT hinmei, kansei_juryo, factory FROM scrap_items i
      WHERE i.company_id = f.company_id
        AND i.kanri_zuban = f.hinmoku_cd AND i.kakuno_cd = f.kakuno_cd
      ORDER BY i.ko_zuban LIMIT 1) i ON true
    WHERE f.company_id = ${companyId}
      AND (${ym}::text IS NULL OR to_char(f.measured_on, 'YYYY-MM') = ${ym})
      AND (${status}::text IS NULL OR f.status = ${status})
      AND (${factory}::text IS NULL
        OR f.factory = ${factory}
        OR EXISTS (
          SELECT 1 FROM scrap_items i2
          WHERE i2.company_id = f.company_id
            AND i2.kanri_zuban = f.hinmoku_cd AND i2.kakuno_cd = f.kakuno_cd
            AND (i2.factory = ${factory} OR i2.factory = ''))
        OR (f.factory = '' AND NOT EXISTS (
          SELECT 1 FROM scrap_items i3
          WHERE i3.company_id = f.company_id
            AND i3.kanri_zuban = f.hinmoku_cd AND i3.kakuno_cd = f.kakuno_cd)))
      AND (${q} = ''
        OR f.hinmoku_cd ILIKE ${like} OR f.kakuno_cd ILIKE ${like} OR f.sokuteisha ILIKE ${like}
        OR EXISTS (
          SELECT 1 FROM scrap_items i4
          WHERE i4.company_id = f.company_id
            AND i4.kanri_zuban = f.hinmoku_cd AND i4.kakuno_cd = f.kakuno_cd
            AND (i4.hinmei ILIKE ${like} OR i4.ko_zuban ILIKE ${like} OR i4.ko_hinmei ILIKE ${like})))
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
    factory: r.factory ?? "",
    hinmei: r.hinmei ?? null,
    kanseiJuryo: numOrNull(r.kansei_juryo),
    itemFactory: r.item_factory ?? "",
  }));
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
 * factory 指定でその工場の分のみ（登録時の工場か品目マスターの工場で判定。一覧の絞り込みと同じ扱い）。
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
      AND (${factory}::text IS NULL
        -- 登録時に選んでいた工場。品目マスターの工場名と違っても、登録した工場の履歴には必ず出す
        OR f.factory = ${factory}
        -- 品目マスターの工場（工場未設定の品目はどの工場にも出す）
        OR EXISTS (
          SELECT 1 FROM scrap_items i
          WHERE i.company_id = f.company_id
            AND i.kanri_zuban = f.hinmoku_cd AND i.kakuno_cd = f.kakuno_cd
            AND (i.factory = ${factory} OR i.factory = ''))
        -- 登録工場が分からず品目マスターにも無い記録は、どの工場でも見せる（どこにも出ないと承認できない）
        OR (f.factory = '' AND NOT EXISTS (
          SELECT 1 FROM scrap_items i
          WHERE i.company_id = f.company_id
            AND i.kanri_zuban = f.hinmoku_cd AND i.kakuno_cd = f.kakuno_cd)))`;
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

/**
 * ポータルからの工場・職場マスタを upsert（配信は upsert のみ。自動削除はしない）。
 * 使う/使わないはこのアプリ側の設定なので、配信では変えない。
 */
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
    // 使う/使わない（active）は配信で上書きしない。設定画面で「使わない」にした工場が
    // 次の配信で候補に戻ってきてしまうため。初めて届く工場は、同じ名前の工場が
    // すでにあればその設定を引き継ぐ（手で追加した後に配信が始まった場合など）。
    await sql`
      INSERT INTO portal_factories (company_id, code, name, sort, active, source)
      VALUES (
        ${companyId}, ${x.code}, ${x.name}, ${x.sort},
        COALESCE(
          (SELECT bool_and(active) FROM portal_factories
            WHERE company_id = ${companyId} AND name = ${x.name}),
          true
        ),
        'portal'
      )
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

/**
 * 記録の中に工場名として出てくる名前（重複なし）。
 * 工場名は各テーブルに文字列で入っているので、ここで拾い集める。
 */
async function listFactoryNamesInData(companyId: string): Promise<Map<string, number>> {
  const sql = getSql();
  const rows = await sql`
    SELECT factory, COUNT(*)::int AS n FROM (
      SELECT factory FROM scrap_daily_records WHERE company_id = ${companyId}
      UNION ALL SELECT factory FROM scrap_monthly_inputs WHERE company_id = ${companyId}
      UNION ALL SELECT factory FROM scrap_procure_days WHERE company_id = ${companyId}
      UNION ALL SELECT factory FROM scrap_items WHERE company_id = ${companyId}
      UNION ALL SELECT factory FROM scrap_scales WHERE company_id = ${companyId}
      UNION ALL SELECT factory FROM scrap_bags WHERE company_id = ${companyId}
      UNION ALL SELECT factory FROM scrap_bag_starts WHERE company_id = ${companyId}
      UNION ALL SELECT factory FROM scrap_inventory_adjustments WHERE company_id = ${companyId}
      UNION ALL SELECT factory FROM users WHERE company_id = ${companyId} AND factory IS NOT NULL
    ) t WHERE factory <> '' GROUP BY factory ORDER BY factory`;
  return new Map(rows.map((r: any) => [String(r.factory), Number(r.n) || 0]));
}

/**
 * 工場の入力候補。
 *   1. 工場マスタ（ポータル配信・手動追加）のうち「使う」になっているもの
 *   2. マスタに無いが記録に出てくる工場名（過去データを取り込んだだけの工場など）
 * マスタで「使わない」にした工場は、記録があっても候補に出さない。
 */
export async function listFactoryOptions(companyId: string): Promise<string[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT name, sort, active FROM portal_factories WHERE company_id = ${companyId}
    ORDER BY sort ASC, name ASC`;
  const known = new Set(rows.map((r: any) => String(r.name)));
  const names: string[] = [];
  for (const r of rows) {
    const name = String(r.name);
    if (r.active !== false && !names.includes(name)) names.push(name);
  }
  // ポータル未配信の工場でも、実データがあれば切替先に出す
  // （過去データを取り込んだだけの工場や、重量計を登録しただけの工場が
  //   選べなくなるのを防ぐ）。マスタにある（使わないにした）ものは出さない。
  for (const name of (await listFactoryNamesInData(companyId)).keys()) {
    if (!known.has(name) && !names.includes(name)) names.push(name);
  }
  return names;
}

// ===== 工場・職場マスタの管理（設定画面） =====

export type MasterSource = "portal" | "manual" | "data";

export interface WorkplaceMaster {
  code: string;
  name: string;
  sort: number;
  active: boolean;
  source: MasterSource;
}

export interface FactoryMaster {
  /** マスタ未登録（記録にだけ出てくる）工場は null */
  code: string | null;
  name: string;
  sort: number;
  active: boolean;
  source: MasterSource;
  /** この工場名を使っている記録の件数。1件でもあれば削除はできない */
  usage: number;
  workplaces: WorkplaceMaster[];
}

const asSource = (v: unknown): MasterSource =>
  v === "manual" || v === "data" ? v : "portal";

/** 設定画面用。マスタの全工場（使わないものも含む）＋記録にだけ出てくる工場。 */
export async function listFactoryMasters(companyId: string): Promise<FactoryMaster[]> {
  await ensureSchema();
  const sql = getSql();
  const [factories, workplaces, usage] = await Promise.all([
    sql`SELECT code, name, sort, active, source FROM portal_factories
        WHERE company_id = ${companyId} ORDER BY sort ASC, name ASC`,
    sql`SELECT code, name, factory_code, sort, active, source FROM portal_workplaces
        WHERE company_id = ${companyId} ORDER BY sort ASC, name ASC`,
    listFactoryNamesInData(companyId),
  ]);
  const byFactory = new Map<string, WorkplaceMaster[]>();
  for (const w of workplaces) {
    const list = byFactory.get(String(w.factory_code)) ?? [];
    list.push({
      code: String(w.code),
      name: String(w.name),
      sort: Number(w.sort) || 0,
      active: w.active !== false,
      source: asSource(w.source),
    });
    byFactory.set(String(w.factory_code), list);
  }
  const out: FactoryMaster[] = factories.map((f: any) => ({
    code: String(f.code),
    name: String(f.name),
    sort: Number(f.sort) || 0,
    active: f.active !== false,
    source: asSource(f.source),
    usage: usage.get(String(f.name)) ?? 0,
    workplaces: byFactory.get(String(f.code)) ?? [],
  }));
  const known = new Set(out.map((f) => f.name));
  for (const [name, n] of usage) {
    if (known.has(name)) continue;
    out.push({ code: null, name, sort: 9999, active: true, source: "data", usage: n, workplaces: [] });
  }
  return out;
}

/**
 * 日次記録で選べる職場（その工場の「使う」職場）。
 * 投入の記録には職場名を文字列で残す（明細の busho 列）。
 */
export async function listWorkplaceOptions(companyId: string, factory: string): Promise<string[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT w.name, w.sort FROM portal_workplaces w
    JOIN portal_factories f ON f.company_id = w.company_id AND f.code = w.factory_code
    WHERE w.company_id = ${companyId} AND f.name = ${factory} AND w.active = true
    ORDER BY w.sort ASC, w.name ASC`;
  const out: string[] = [];
  for (const r of rows) {
    const n = String(r.name);
    if (!out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * 記録に出てくる職場（部署）で、まだ職場マスタに無いもの。工場ごとに件数つきで返す。
 * 紙の記録票（Excel）から取り込んだ行は「部署」欄に職場が入っているので、
 * 設定画面で「そのまま職場として登録」できるようにするために使う。
 */
export async function listWorkplaceSuggestions(
  companyId: string
): Promise<Record<string, { name: string; count: number }[]>> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT r.factory, e.busho AS name, COUNT(*)::int AS n
    FROM scrap_daily_entries e
    JOIN scrap_daily_records r ON r.id = e.record_id
    WHERE r.company_id = ${companyId} AND e.busho <> ''
      AND NOT EXISTS (
        SELECT 1 FROM portal_workplaces w
        JOIN portal_factories f ON f.company_id = w.company_id AND f.code = w.factory_code
        WHERE w.company_id = r.company_id AND f.name = r.factory AND w.name = e.busho
      )
    GROUP BY r.factory, e.busho
    ORDER BY r.factory, n DESC, e.busho`;
  const out: Record<string, { name: string; count: number }[]> = {};
  for (const r of rows) {
    const f = String(r.factory);
    (out[f] ??= []).push({ name: String(r.name), count: Number(r.n) || 0 });
  }
  return out;
}

/** 月間の職場別集計（職場＝明細の busho。未入力は空文字）。 */
export interface WorkplaceAggRow {
  factory: string;
  workplace: string;
  /** 種類名 → 合計kg */
  byKind: Record<string, number>;
  total: number;
  count: number;
}

export async function listWorkplaceAgg(
  companyId: string,
  ym: string,
  factory: string | null
): Promise<WorkplaceAggRow[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT r.factory,
      -- 他工場から届いたプラ箱は「送った工場（プラ箱）」を1つの職場のように数える
      CASE WHEN e.origin_factory <> '' AND e.origin_factory <> r.factory
        THEN e.origin_factory || '（プラ箱）' ELSE e.busho END AS workplace,
      e.hinshu, SUM(e.weight) AS w, COUNT(*)::int AS n
    FROM scrap_daily_entries e
    JOIN scrap_daily_records r ON r.id = e.record_id
    WHERE r.company_id = ${companyId}
      AND to_char(r.record_date, 'YYYY-MM') = ${ym}
      AND (${factory}::text IS NULL OR r.factory = ${factory})
    GROUP BY 1, 2, e.hinshu
    ORDER BY 1, 2`;
  const map = new Map<string, WorkplaceAggRow>();
  for (const r of rows) {
    const key = `${r.factory}\u0000${r.workplace}`;
    const row =
      map.get(key) ??
      { factory: String(r.factory), workplace: String(r.workplace ?? ""), byKind: {}, total: 0, count: 0 };
    const w = num(r.w);
    row.byKind[String(r.hinshu)] = (row.byKind[String(r.hinshu)] ?? 0) + w;
    row.total += w;
    row.count += Number(r.n) || 0;
    map.set(key, row);
  }
  // 職場が入っているものを先に、未入力（空）は各工場の最後に並べる
  return [...map.values()].sort(
    (a, b) =>
      a.factory.localeCompare(b.factory) ||
      Number(a.workplace === "") - Number(b.workplace === "") ||
      a.workplace.localeCompare(b.workplace)
  );
}

/** 手動で追加するマスタのコード。ポータルのコードと重ならないよう接頭辞を付ける。 */
function manualCode(): string {
  return `m-${crypto.randomUUID().replace(/-/g, "").slice(0, 10)}`;
}

/**
 * 工場名からマスタの行を引く。記録にだけ出てくる工場は、ここで行を作る
 * （使う/使わない・職場を持たせるには行が要る）。
 */
async function ensureFactoryRow(
  companyId: string,
  name: string
): Promise<{ code: string; source: MasterSource; active: boolean }> {
  const sql = getSql();
  const rows = await sql`
    SELECT code, source, active FROM portal_factories
    WHERE company_id = ${companyId} AND name = ${name}
    ORDER BY (source = 'portal') DESC LIMIT 1`;
  if (rows[0]) {
    return { code: String(rows[0].code), source: asSource(rows[0].source), active: rows[0].active !== false };
  }
  const code = manualCode();
  await sql`
    INSERT INTO portal_factories (company_id, code, name, sort, active, source)
    VALUES (${companyId}, ${code}, ${name},
            (SELECT COALESCE(MAX(sort), 0) + 1 FROM portal_factories WHERE company_id = ${companyId}),
            true, 'data')`;
  return { code, source: "data", active: true };
}

/** 工場を追加する。同じ名前が「使わない」で残っていれば、使うに戻す。 */
export async function addFactory(companyId: string, name: string): Promise<"added" | "restored" | "exists"> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT code, active FROM portal_factories WHERE company_id = ${companyId} AND name = ${name}`;
  if (rows.length > 0) {
    if (rows.some((r: any) => r.active !== false)) return "exists";
    await sql`UPDATE portal_factories SET active = true WHERE company_id = ${companyId} AND name = ${name}`;
    return "restored";
  }
  await sql`
    INSERT INTO portal_factories (company_id, code, name, sort, active, source)
    VALUES (${companyId}, ${manualCode()}, ${name},
            (SELECT COALESCE(MAX(sort), 0) + 1 FROM portal_factories WHERE company_id = ${companyId}),
            true, 'manual')`;
  return "added";
}

/** 工場を使う/使わないにする（名前で指定。記録にだけ出てくる工場もここで行を作る）。 */
export async function setFactoryActive(companyId: string, name: string, active: boolean): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  await ensureFactoryRow(companyId, name);
  await sql`UPDATE portal_factories SET active = ${active} WHERE company_id = ${companyId} AND name = ${name}`;
}

/**
 * 工場を削除する。消せるのは「手で追加した・記録で使われていない」工場だけ。
 * ポータル配信の工場は消しても次の配信で戻るので、使わないにしてもらう。
 */
export async function deleteFactory(
  companyId: string,
  name: string
): Promise<"deleted" | "portal" | "used" | "missing"> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT code, source FROM portal_factories WHERE company_id = ${companyId} AND name = ${name}`;
  if (rows.length === 0) return "missing";
  if (rows.some((r: any) => asSource(r.source) === "portal")) return "portal";
  const usage = (await listFactoryNamesInData(companyId)).get(name) ?? 0;
  if (usage > 0) return "used";
  for (const r of rows) {
    await sql`DELETE FROM portal_workplaces WHERE company_id = ${companyId} AND factory_code = ${r.code}`;
  }
  await sql`DELETE FROM portal_factories WHERE company_id = ${companyId} AND name = ${name}`;
  return "deleted";
}

/** 職場を追加する（工場の下に置く）。同じ名前が「使わない」で残っていれば戻す。 */
export async function addWorkplace(
  companyId: string,
  factoryName: string,
  name: string
): Promise<"added" | "restored" | "exists"> {
  await ensureSchema();
  const sql = getSql();
  const f = await ensureFactoryRow(companyId, factoryName);
  const rows = await sql`
    SELECT code, active FROM portal_workplaces
    WHERE company_id = ${companyId} AND factory_code = ${f.code} AND name = ${name}`;
  if (rows.length > 0) {
    if (rows.some((r: any) => r.active !== false)) return "exists";
    await sql`
      UPDATE portal_workplaces SET active = true
      WHERE company_id = ${companyId} AND factory_code = ${f.code} AND name = ${name}`;
    return "restored";
  }
  await sql`
    INSERT INTO portal_workplaces (company_id, code, name, factory_code, sort, active, source)
    VALUES (${companyId}, ${manualCode()}, ${name}, ${f.code},
            (SELECT COALESCE(MAX(sort), 0) + 1 FROM portal_workplaces
              WHERE company_id = ${companyId} AND factory_code = ${f.code}),
            true, 'manual')`;
  return "added";
}

export async function setWorkplaceActive(companyId: string, code: string, active: boolean): Promise<boolean> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    UPDATE portal_workplaces SET active = ${active}
    WHERE company_id = ${companyId} AND code = ${code} RETURNING code`;
  return rows.length > 0;
}

/** 職場を削除する。ポータル配信の職場は次の配信で戻るので、使わないにしてもらう。 */
export async function deleteWorkplace(
  companyId: string,
  code: string
): Promise<"deleted" | "portal" | "missing"> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT source FROM portal_workplaces WHERE company_id = ${companyId} AND code = ${code}`;
  if (rows.length === 0) return "missing";
  if (asSource(rows[0].source) === "portal") return "portal";
  await sql`DELETE FROM portal_workplaces WHERE company_id = ${companyId} AND code = ${code}`;
  return "deleted";
}

// ===== 工場間のプラ箱送付 =====

/** どの工場がどこへスクラップを送るか。送らない工場は含まない。 */
export async function listShipRoutes(
  companyId: string
): Promise<{ fromFactory: string; toFactory: string }[]> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    SELECT from_factory, to_factory FROM scrap_ship_routes
    WHERE company_id = ${companyId} ORDER BY from_factory`;
  return rows.map((r: any) => ({ fromFactory: String(r.from_factory), toFactory: String(r.to_factory) }));
}

/** 送り先を設定する。toFactory が空なら「自工場で処理」に戻す。 */
export async function setShipRoute(
  companyId: string,
  fromFactory: string,
  toFactory: string
): Promise<void> {
  await ensureSchema();
  const sql = getSql();
  if (!toFactory) {
    await sql`DELETE FROM scrap_ship_routes WHERE company_id = ${companyId} AND from_factory = ${fromFactory}`;
    return;
  }
  await sql`
    INSERT INTO scrap_ship_routes (company_id, from_factory, to_factory)
    VALUES (${companyId}, ${fromFactory}, ${toFactory})
    ON CONFLICT (company_id, from_factory) DO UPDATE SET to_factory = EXCLUDED.to_factory, updated_at = NOW()`;
}

function mapShipment(r: any): Shipment {
  return {
    id: String(r.id),
    boxNo: String(r.box_no),
    fromFactory: String(r.from_factory),
    toFactory: String(r.to_factory),
    shipDate: dateStr(r.ship_date),
    hinshu: String(r.hinshu),
    weight: num(r.weight),
    grossWeight: numOrNull(r.gross_weight),
    tareWeight: numOrNull(r.tare_weight),
    shippedBy: r.shipped_by ?? "",
    note: r.note ?? "",
    received:
      r.recv_date !== null && r.recv_date !== undefined
        ? {
            date: dateStr(r.recv_date),
            weight: num(r.recv_weight),
            polyTare: numOrNull(r.recv_poly_tare),
            scaleName: r.recv_scale ?? "",
            kirokusha: r.recv_by ?? "",
          }
        : null,
  };
}

/** プラ箱を、受け入れ側の処理記録（日次記録の明細）と一緒に引く。 */
async function queryShipments(
  companyId: string,
  q: {
    id?: string | null;
    /** 送った側か受け入れた側がこの工場 */
    factory?: string | null;
    /** 受け入れ側がこの工場 */
    toFactory?: string | null;
    /** 出荷か処理がこの月のもの（未処理は月に関係なく含める） */
    ym?: string | null;
    pendingOnly?: boolean;
  }
): Promise<Shipment[]> {
  await ensureSchema();
  const sql = getSql();
  const id = q.id ?? null;
  const factory = q.factory ?? null;
  const toFactory = q.toFactory ?? null;
  const ym = q.ym ?? null;
  const pendingOnly = Boolean(q.pendingOnly);
  const rows = await sql`
    SELECT s.id, s.box_no, s.from_factory, s.to_factory, s.ship_date, s.hinshu, s.weight,
      s.gross_weight, s.tare_weight, s.shipped_by, s.note,
      r.record_date AS recv_date, e.weight AS recv_weight, e.poly_tare AS recv_poly_tare,
      e.scale_name AS recv_scale,
      e.kirokusha AS recv_by
    FROM scrap_shipments s
    LEFT JOIN scrap_daily_entries e ON e.shipment_id = s.id
    LEFT JOIN scrap_daily_records r ON r.id = e.record_id
    WHERE s.company_id = ${companyId}
      AND (${id}::uuid IS NULL OR s.id = ${id}::uuid)
      AND (${factory}::text IS NULL OR s.from_factory = ${factory} OR s.to_factory = ${factory})
      AND (${toFactory}::text IS NULL OR s.to_factory = ${toFactory})
      AND (${pendingOnly}::boolean = false OR e.id IS NULL)
      AND (${ym}::text IS NULL
        OR to_char(s.ship_date, 'YYYY-MM') = ${ym}
        OR to_char(r.record_date, 'YYYY-MM') = ${ym}
        OR e.id IS NULL)
    ORDER BY (e.id IS NULL) DESC, s.ship_date DESC, s.box_no DESC
    LIMIT 2000`;
  return rows.map(mapShipment);
}

export async function getShipment(companyId: string, id: string): Promise<Shipment | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  return (await queryShipments(companyId, { id }))[0] ?? null;
}

/**
 * プラ箱の一覧。factory を送った側か受け入れた側に持つもの（null＝全工場）。
 * 未処理のものは月に関係なく必ず含め、先頭に並べる（処理し忘れを見落とさないため）。
 */
export async function listShipments(
  companyId: string,
  opts: { factory: string | null; ym: string }
): Promise<Shipment[]> {
  return queryShipments(companyId, { factory: opts.factory, ym: opts.ym });
}

/** 受け入れ側でまだ処理していないプラ箱（日次記録で選ぶ候補）。古い順。 */
export async function listPendingShipments(companyId: string, toFactory: string): Promise<Shipment[]> {
  const list = await queryShipments(companyId, { toFactory, pendingOnly: true });
  return list.reverse();
}

/**
 * プラ箱を出荷として登録し、箱に書く番号を振る（送った工場-月日-連番）。
 * 番号は消した箱の番号を使い回さないよう、その日の最大の連番の次にする。
 */
export async function createShipment(
  companyId: string,
  x: {
    fromFactory: string;
    toFactory: string;
    shipDate: string;
    hinshu: string;
    /** プラ箱ごと量った重さ（出荷重量） */
    grossWeight: number;
    /** 送る側で量ったプラ箱の重さ。いまの運用では量らない（null） */
    tareWeight: number | null;
    shippedBy: string;
    note: string;
  }
): Promise<Shipment> {
  await ensureSchema();
  const sql = getSql();
  const prefix = `${x.fromFactory}-${x.shipDate.slice(5, 7)}${x.shipDate.slice(8, 10)}-`;
  // 出荷重量はプラ箱込み。送る側でプラ箱を量ったとき（試行版）だけスクラップ重量にする
  const weight =
    x.tareWeight !== null
      ? Math.round((x.grossWeight - x.tareWeight) * 1000) / 1000
      : Math.round(x.grossWeight * 1000) / 1000;
  for (let attempt = 0; attempt < 5; attempt++) {
    const rows = await sql`
      SELECT box_no FROM scrap_shipments
      WHERE company_id = ${companyId} AND from_factory = ${x.fromFactory} AND ship_date = ${x.shipDate}`;
    let max = 0;
    for (const r of rows) {
      const no = String(r.box_no);
      if (!no.startsWith(prefix)) continue;
      const n = Number(no.slice(prefix.length));
      if (Number.isInteger(n) && n > max) max = n;
    }
    const boxNo = `${prefix}${String(max + 1).padStart(2, "0")}`;
    const inserted = await sql`
      INSERT INTO scrap_shipments
        (company_id, box_no, from_factory, to_factory, ship_date, hinshu, weight,
         gross_weight, tare_weight, shipped_by, note)
      VALUES (${companyId}, ${boxNo}, ${x.fromFactory}, ${x.toFactory}, ${x.shipDate},
              ${x.hinshu}, ${weight}, ${x.grossWeight}, ${x.tareWeight}, ${x.shippedBy}, ${x.note})
      ON CONFLICT (company_id, box_no) DO NOTHING
      RETURNING id`;
    if (inserted.length > 0) {
      const sh = await getShipment(companyId, String(inserted[0].id));
      if (sh) return sh;
    }
  }
  throw new Error("プラ箱の番号を振れませんでした。もう一度お試しください。");
}

/**
 * 未処理のプラ箱の重量・種類・メモを直す（処理済みは直せない）。
 * 総重量とプラ箱の重さがあればスクラップ重量はそこから出し直す。
 */
export async function updateShipment(
  companyId: string,
  id: string,
  patch: {
    hinshu: string;
    grossWeight: number | null;
    tareWeight: number | null;
    /** 総重量が無い（導入直後の登録分）ときだけ使うスクラップ重量 */
    weight: number;
    note: string;
  }
): Promise<boolean> {
  await ensureSchema();
  const sql = getSql();
  const weight =
    patch.grossWeight !== null && patch.tareWeight !== null
      ? Math.round((patch.grossWeight - patch.tareWeight) * 1000) / 1000
      : patch.weight;
  const rows = await sql`
    UPDATE scrap_shipments s SET hinshu = ${patch.hinshu}, weight = ${weight},
      gross_weight = ${patch.grossWeight}, tare_weight = ${patch.tareWeight}, note = ${patch.note}
    WHERE s.company_id = ${companyId} AND s.id = ${id}
      AND NOT EXISTS (SELECT 1 FROM scrap_daily_entries e WHERE e.shipment_id = s.id)
    RETURNING s.id`;
  return rows.length > 0;
}

/** 未処理のプラ箱を取り消す（処理済みは消せない）。 */
export async function deleteShipment(companyId: string, id: string): Promise<boolean> {
  await ensureSchema();
  const sql = getSql();
  const rows = await sql`
    DELETE FROM scrap_shipments s
    WHERE s.company_id = ${companyId} AND s.id = ${id}
      AND NOT EXISTS (SELECT 1 FROM scrap_daily_entries e WHERE e.shipment_id = s.id)
    RETURNING s.id`;
  return rows.length > 0;
}

/** 指定したプラ箱のうち、別の日次記録（exceptRecordId 以外）で処理済みのもの。 */
export async function shipmentsUsedElsewhere(
  companyId: string,
  ids: string[],
  exceptRecordId: string | null
): Promise<Set<string>> {
  await ensureSchema();
  const sql = getSql();
  if (ids.length === 0) return new Set();
  const rows = await sql`
    SELECT shipment_id FROM scrap_daily_entries
    WHERE company_id = ${companyId} AND shipment_id = ANY(${ids}::uuid[])
      AND (${exceptRecordId}::uuid IS NULL OR record_id <> ${exceptRecordId}::uuid)`;
  return new Set(rows.map((r: any) => String(r.shipment_id)));
}
