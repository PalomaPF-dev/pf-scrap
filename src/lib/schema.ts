import { getSql } from "./neon";
import { ensureAuthSchema } from "./authDb";

/* eslint-disable @typescript-eslint/no-explicit-any */

/**
 * DDL を実行するが、「既に存在する」系のエラーは無視する。
 * Postgres の CREATE INDEX/TABLE IF NOT EXISTS は同時実行に対して安全ではなく、
 * 複数リクエストが初回に同時に走ると pg_class のユニーク制約違反(23505/42P07/42710)で
 * 失敗しうる。冪等な初期化として、これらは握り潰す。
 */
async function safeDdl(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (e: any) {
    const code = e?.code ?? e?.sourceError?.code;
    // 42P07: duplicate_table, 42710: duplicate_object, 23505: unique_violation(pg_catalog)
    if (code === "42P07" || code === "42710" || code === "23505") return;
    throw e;
  }
}

let schemaReady: Promise<void> | null = null;

/**
 * スクラップ重量管理のドメインテーブルを冪等に作成。
 * - scrap_items           … 品目マスター（KEY=管理図番+製造場所CD、子図番、構成/完成重量）
 * - scrap_daily_records   … 日次記録票（日付×工場で1枚）
 * - scrap_daily_entries   … 日中記録の明細（発生のたびに1行）
 * - scrap_first_articles  … 初品の実測完成品重量
 * - scrap_mcframe_qty     … McFrame取込の完成品数量（年月×KEY）
 * - scrap_monthly_inputs  … 月初在庫・購入重量・スクラップ売却数量（年月で1行）
 * - portal_factories / portal_workplaces … ポータル配信の工場・職場マスタ（入力候補）
 *
 * 認証テーブル（companies/users）も同時に用意する。
 * 同一プロセス内の同時呼び出しは1回の実行に集約（共有プロミス）。失敗時は次回再試行できるよう解除。
 */
export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = buildSchema().catch((e) => {
      schemaReady = null;
      throw e;
    });
  }
  return schemaReady;
}

async function buildSchema(): Promise<void> {
  const sql = getSql();

  await ensureAuthSchema();

  // デモ会社の識別フラグ・利用権（entitlement）判定用カラム（PFシリーズ共通）。冪等追加。
  await safeDdl(() => sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false`);
  await safeDdl(() => sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_pro BOOLEAN NOT NULL DEFAULT false`);
  await safeDdl(() => sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ`);

  // ② 品目マスター。KEY = 管理図番 + 製造場所CD（McFrameの設定）。
  // 1つのKEY（完成品）に複数の子図番（材料）が付き得るため、KEY×子図番で一意。
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS scrap_items (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id      UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      kanri_zuban     TEXT NOT NULL,
      hinmei          TEXT NOT NULL DEFAULT '',
      key             TEXT NOT NULL,
      kubun           TEXT NOT NULL DEFAULT 'その他',
      oya_zuban       TEXT NOT NULL DEFAULT '',
      oya_hinmei      TEXT NOT NULL DEFAULT '',
      ko_zuban        TEXT NOT NULL DEFAULT '',
      ko_hinmei       TEXT NOT NULL DEFAULT '',
      tani            TEXT NOT NULL DEFAULT 'K',
      kosei_juryo     NUMERIC NOT NULL DEFAULT 0,
      kansei_juryo    NUMERIC NOT NULL DEFAULT 0,
      seizo_basho_cd  TEXT NOT NULL DEFAULT '',
      seizo_basho_mei TEXT NOT NULL DEFAULT '',
      factory         TEXT NOT NULL DEFAULT '',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (company_id, key, ko_zuban)
    )`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS scrap_items_company_idx ON scrap_items(company_id)`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS scrap_items_ko_zuban_idx ON scrap_items(company_id, ko_zuban)`);

  // 重量計（スクラップ箱）マスター。箱には 上銅 / 銅ダライ の2種類があり、
  // それぞれ重量計の上に常設されている。重量計にQRコードを貼り、日次記録では
  // QR読み取りで投入先の箱を選択する。qr_code がQRに入れる値。
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS scrap_scales (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      qr_code    TEXT NOT NULL,
      name       TEXT NOT NULL,
      kind       TEXT NOT NULL DEFAULT '上銅',
      factory    TEXT NOT NULL DEFAULT '',
      sort       INTEGER NOT NULL DEFAULT 0,
      active     BOOLEAN NOT NULL DEFAULT true,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (company_id, qr_code)
    )`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS scrap_scales_company_idx ON scrap_scales(company_id)`);
  // 設備番号（重量計そのものの管理番号）。一覧・ラベルに出して現物と突き合わせる。
  await safeDdl(() => sql`ALTER TABLE scrap_scales ADD COLUMN IF NOT EXISTS equip_no TEXT NOT NULL DEFAULT ''`);

  // ① 日次記録票（日付×工場で1枚）。
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS scrap_daily_records (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id        UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      record_date       DATE NOT NULL,
      factory           TEXT NOT NULL,
      sekininsha        TEXT NOT NULL DEFAULT '',
      zenjitsu_ok       BOOLEAN NOT NULL DEFAULT false,
      hako_zanryo       NUMERIC NOT NULL DEFAULT 0,
      kaishu_sokuteichi NUMERIC,
      tonyu_kanryo      BOOLEAN NOT NULL DEFAULT false,
      shonin            TEXT NOT NULL DEFAULT '',
      biko              TEXT NOT NULL DEFAULT '',
      updated_by        TEXT NOT NULL DEFAULT '',
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (company_id, record_date, factory)
    )`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS scrap_daily_records_date_idx ON scrap_daily_records(company_id, record_date)`);
  // 承認ワークフロー。draft(下書き) → pending(申請中) → approved(承認済み) / rejected(差し戻し)。
  // 記録者が「管理者へ申請」すると pending になり、管理者が承認/差し戻しする。
  await safeDdl(() => sql`ALTER TABLE scrap_daily_records ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'draft'`);
  await safeDdl(() => sql`ALTER TABLE scrap_daily_records ADD COLUMN IF NOT EXISTS applied_by TEXT NOT NULL DEFAULT ''`);
  await safeDdl(() => sql`ALTER TABLE scrap_daily_records ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ`);
  await safeDdl(() => sql`ALTER TABLE scrap_daily_records ADD COLUMN IF NOT EXISTS approved_by TEXT NOT NULL DEFAULT ''`);
  await safeDdl(() => sql`ALTER TABLE scrap_daily_records ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`);
  await safeDdl(() => sql`ALTER TABLE scrap_daily_records ADD COLUMN IF NOT EXISTS reject_comment TEXT NOT NULL DEFAULT ''`);

  // ① 日中記録の明細（スクラップ発生のたびに1行）。
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS scrap_daily_entries (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      record_id  UUID NOT NULL REFERENCES scrap_daily_records(id) ON DELETE CASCADE,
      jikoku     TEXT NOT NULL DEFAULT '',
      busho      TEXT NOT NULL DEFAULT '',
      kikai      TEXT NOT NULL DEFAULT '',
      hinshu     TEXT NOT NULL DEFAULT '銅条',
      kotei      TEXT NOT NULL DEFAULT '',
      weight     NUMERIC NOT NULL DEFAULT 0,
      kirokusha  TEXT NOT NULL DEFAULT '',
      ijo        TEXT NOT NULL DEFAULT '',
      sort       INTEGER NOT NULL DEFAULT 0
    )`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS scrap_daily_entries_record_idx ON scrap_daily_entries(record_id)`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS scrap_daily_entries_company_idx ON scrap_daily_entries(company_id)`);
  // 計量方式の改修（2026-08）: 重量計（スクラップ箱）をQRで選択し、
  //   スクラップ重量 = 投入前重量(箱含む) − 箱重量(空き箱)
  // を自動計算する。スクラップ箱は常時重量計の上にあるため、累積表示値
  // （投入前 cum_before / 投入後 cum_after）も記録し、差分との整合を確認する。
  // hinshu 列には箱の種類（上銅/銅ダライ）を入れる。busho/kikai/kotei は旧様式の名残（新規入力では未使用）。
  await safeDdl(() => sql`ALTER TABLE scrap_daily_entries ADD COLUMN IF NOT EXISTS scale_id UUID`);
  await safeDdl(() => sql`ALTER TABLE scrap_daily_entries ADD COLUMN IF NOT EXISTS scale_name TEXT NOT NULL DEFAULT ''`);
  await safeDdl(() => sql`ALTER TABLE scrap_daily_entries ADD COLUMN IF NOT EXISTS gross_weight NUMERIC`);
  await safeDdl(() => sql`ALTER TABLE scrap_daily_entries ADD COLUMN IF NOT EXISTS tare_weight NUMERIC`);
  await safeDdl(() => sql`ALTER TABLE scrap_daily_entries ADD COLUMN IF NOT EXISTS cum_before NUMERIC`);
  await safeDdl(() => sql`ALTER TABLE scrap_daily_entries ADD COLUMN IF NOT EXISTS cum_after NUMERIC`);

  // ③ 初品の実測完成品重量（測定日×KEYで1件。再測定は上書き）。
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS scrap_first_articles (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      measured_on DATE NOT NULL,
      item_key    TEXT NOT NULL,
      weight      NUMERIC NOT NULL,
      sokuteisha  TEXT NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (company_id, measured_on, item_key)
    )`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS scrap_first_articles_key_idx ON scrap_first_articles(company_id, item_key, measured_on)`);
  // 初品測定の承認ワークフロー（2026-08）: 登録と同時に管理者へ申請（pending）し、
  // 承認（approved）された測定値だけを完成重量の計算に採用する。
  await safeDdl(() => sql`ALTER TABLE scrap_first_articles ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending'`);
  await safeDdl(() => sql`ALTER TABLE scrap_first_articles ADD COLUMN IF NOT EXISTS approved_by TEXT NOT NULL DEFAULT ''`);
  await safeDdl(() => sql`ALTER TABLE scrap_first_articles ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`);
  await safeDdl(() => sql`ALTER TABLE scrap_first_articles ADD COLUMN IF NOT EXISTS reject_comment TEXT NOT NULL DEFAULT ''`);
  // ワークフロー導入前の既存測定値は承認済みとして扱う（計算結果を変えない）
  {
    const applied = await sql`SELECT 1 FROM pf_scrap_migrations WHERE key = 'fa_status_backfill_v1' LIMIT 1`.catch(() => []);
    if (!Array.isArray(applied) || applied.length === 0) {
      await safeDdl(() => sql`CREATE TABLE IF NOT EXISTS pf_scrap_migrations (key TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
      const done = await sql`SELECT 1 FROM pf_scrap_migrations WHERE key = 'fa_status_backfill_v1' LIMIT 1`;
      if (done.length === 0) {
        await sql`UPDATE scrap_first_articles SET status = 'approved' WHERE status = 'pending' AND created_at < NOW() - interval '1 minute'`;
        await sql`INSERT INTO pf_scrap_migrations (key) VALUES ('fa_status_backfill_v1') ON CONFLICT DO NOTHING`;
      }
    }
  }

  // ④ McFrame取込の完成品数量（年月×KEYで1件。再取込は上書き）。ym は 'YYYY-MM'。
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS scrap_mcframe_qty (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      ym         TEXT NOT NULL,
      item_key   TEXT NOT NULL,
      qty        NUMERIC NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (company_id, ym, item_key)
    )`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS scrap_mcframe_qty_ym_idx ON scrap_mcframe_qty(company_id, ym)`);

  // ④' McFrame取込の完成品数量（日付×KEY）。
  // 日別の加工数があれば、その日の完成品重量 = Σ(加工数 × 単品完成重量) を日単位で出せる。
  // 月次集計は、その月に日別データがあれば日別の合計を優先する（過去データは月次のみ）。
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS scrap_mcframe_days (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      qdate      DATE NOT NULL,
      item_key   TEXT NOT NULL,
      qty        NUMERIC NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (company_id, qdate, item_key)
    )`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS scrap_mcframe_days_date_idx ON scrap_mcframe_days(company_id, qdate)`);

  // ⑤ 月次入力（年月×工場で1行）。区分別の月初在庫・購入重量と、スクラップ売却数量。
  // 工場別シート（大口/直方）の運用に合わせて工場単位で持ち、照合は全社合算/工場別を切り替える。
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS scrap_monthly_inputs (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      ym           TEXT NOT NULL,
      zaiko_dojo   NUMERIC,
      zaiko_dokan  NUMERIC,
      zaiko_sonota NUMERIC,
      konyu_dojo   NUMERIC,
      konyu_dokan  NUMERIC,
      konyu_sonota NUMERIC,
      baikyaku     NUMERIC,
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (company_id, ym)
    )`);
  // 工場別化（2026-08）: factory 列を追加し、一意制約を (company_id, ym, factory) へ移行。
  // 既存行は factory=''（全社扱い）として残る。
  await safeDdl(() => sql`ALTER TABLE scrap_monthly_inputs ADD COLUMN IF NOT EXISTS factory TEXT NOT NULL DEFAULT ''`);
  await safeDdl(() => sql`ALTER TABLE scrap_monthly_inputs DROP CONSTRAINT IF EXISTS scrap_monthly_inputs_company_id_ym_key`);
  await safeDdl(() => sql`CREATE UNIQUE INDEX IF NOT EXISTS scrap_monthly_inputs_ym_factory_idx ON scrap_monthly_inputs(company_id, ym, factory)`);

  // 調達入力（日次）: 調達担当者が毎日、入荷（購入実績）とスクラップ売却数を入力する。
  // 月次照合の購入重量・売却数量は、この日次データの月間集計を優先して使う
  // （日次データが無い月は scrap_monthly_inputs の値 = 過去データ取込分を使う）。
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS scrap_procure_days (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      pdate        DATE NOT NULL,
      factory      TEXT NOT NULL,
      konyu_dojo   NUMERIC,
      konyu_dokan  NUMERIC,
      konyu_sonota NUMERIC,
      baikyaku     NUMERIC,
      note         TEXT NOT NULL DEFAULT '',
      recorded_by  TEXT NOT NULL DEFAULT '',
      updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (company_id, pdate, factory)
    )`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS scrap_procure_days_ym_idx ON scrap_procure_days(company_id, factory, pdate)`);

  // 棚卸等の在庫補正。理論在庫（前日在庫+購入−使用の積み上げ）と実棚のズレを
  // 理由付きで記録し、月次照合の在庫チェーンに反映する。
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS scrap_inventory_adjustments (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      adate       DATE NOT NULL,
      factory     TEXT NOT NULL,
      kubun       TEXT NOT NULL DEFAULT '銅条',
      amount      NUMERIC NOT NULL,
      reason      TEXT NOT NULL,
      recorded_by TEXT NOT NULL DEFAULT '',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await safeDdl(() => sql`CREATE INDEX IF NOT EXISTS scrap_inventory_adjustments_idx ON scrap_inventory_adjustments(company_id, factory, adate)`);

  // ポータル配信の工場・職場マスタ（/api/portal-masters）。code で突合して upsert する。
  // このアプリでは日次記録・品目の「工場」の入力候補に使う（記録の値は文字列のまま）。
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS portal_factories (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      code       TEXT NOT NULL,
      name       TEXT NOT NULL,
      sort       INTEGER NOT NULL DEFAULT 0,
      UNIQUE (company_id, code)
    )`);
  await safeDdl(() => sql`
    CREATE TABLE IF NOT EXISTS portal_workplaces (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id   UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      code         TEXT NOT NULL,
      name         TEXT NOT NULL,
      factory_code TEXT NOT NULL,
      sort         INTEGER NOT NULL DEFAULT 0,
      UNIQUE (company_id, code)
    )`);
}
