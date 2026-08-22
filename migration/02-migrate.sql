-- ============================================================================
-- pf-scrap を app_scrap 専用ロールへ移す — 手順2: ロール作成とテーブル移動
--
-- 実行者: postgres ロール
-- 接続先: Supavisor の【Session pooler（ポート5432）】
--         ※ Transaction pooler(6543) では CREATE ROLE が正しく動かない
--
-- 通常は migration/run.sh から呼ばれる。単体で流すときは、app_scrap の
-- パスワードを psql 変数 pw で渡す（ファイルには一切書かない）:
--
--   PGPASSWORD='<postgresのPW>' psql \
--     -h aws-0-ap-northeast-1.pooler.supabase.com -p 5432 \
--     -U postgres.<project_ref> -d postgres \
--     -v ON_ERROR_STOP=1 -v pw="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)" \
--     -f migration/02-migrate.sql
--
-- パスワードをファイルに書き込む手順にしていないのは、置換したファイルを
-- 消し忘れてコミットする事故を、そもそも起こせないようにするため。
--
-- 方針（他アプリの migration/01-roles-and-schemas.sql と同じ設計）:
--   - アプリごとに 1スキーマ + 1ログインロール
--   - ロールの既定 search_path を自スキーマだけにする（public は含めない）
--   - スキーマの所有者をアプリロールにする
--     → アプリが起動時に流す CREATE TABLE / ALTER TABLE が自スキーマに効く
--
-- 他アプリとの違い:
--   他アプリは Neon から dump/restore で移したが、pf-scrap のデータは
--   既に同じDBの public にある。よってコピーせず ALTER TABLE ... SET SCHEMA
--   で「付け替える」だけ。データは1行も動かないので速く、取りこぼしもない。
--   索引・制約・所有シーケンスはテーブルと一緒に移動する。
-- ============================================================================

-- パスワード未指定のまま流すと、空パスワードのロールができてしまう。先に止める。
\if :{?pw}
\else
\echo '!! app_scrap のパスワードが指定されていません。migration/run.sh を使ってください。'
\quit 1
\endif

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. ログインロール
-- ----------------------------------------------------------------------------
CREATE ROLE app_scrap LOGIN PASSWORD :'pw';
-- CREATE SCHEMA ... AUTHORIZATION のためにメンバーシップを得る（PG15 以前で必要）
GRANT app_scrap TO CURRENT_USER;

-- ----------------------------------------------------------------------------
-- 2. スキーマ（所有者＝アプリロール）
-- ----------------------------------------------------------------------------
CREATE SCHEMA scrap AUTHORIZATION app_scrap;

-- ----------------------------------------------------------------------------
-- 3. 既定 search_path（自スキーマのみ。public は含めない）
-- ----------------------------------------------------------------------------
ALTER ROLE app_scrap SET search_path = scrap;

-- ----------------------------------------------------------------------------
-- 4. public にある pf-scrap のテーブルを scrap へ移す
-- ----------------------------------------------------------------------------
-- 対象は「アプリが CREATE TABLE している17表」だけに限定する。
-- public に他アプリの残骨があっても巻き込まない（手順1で確認済みのはず）。
DO $$
DECLARE
  t text;
  moved int := 0;
  targets text[] := ARRAY[
    'companies','users','password_reset_tokens','pf_scrap_migrations',
    'portal_factories','portal_workplaces',
    'scrap_items','scrap_kinds','scrap_scales',
    'scrap_daily_records','scrap_daily_entries','scrap_first_articles',
    'scrap_mcframe_qty','scrap_mcframe_days','scrap_monthly_inputs',
    'scrap_procure_days','scrap_inventory_adjustments'
  ];
BEGIN
  FOREACH t IN ARRAY targets LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA scrap', t);
      moved := moved + 1;
    ELSE
      RAISE NOTICE 'public に無いため移動しません: %', t;
    END IF;
  END LOOP;
  RAISE NOTICE '移動したテーブル: % 件', moved;
END $$;

-- ----------------------------------------------------------------------------
-- 5. 所有者を app_scrap にする
-- ----------------------------------------------------------------------------
-- アプリは起動のたびに ALTER TABLE ... ADD COLUMN IF NOT EXISTS などの
-- DDL を流す（src/lib/schema.ts の ensureSchema）。所有者でないと弾かれる。
-- ALTER TABLE ... OWNER TO は、そのテーブルが所有するシーケンスの所有者も
-- 一緒に変える（シーケンス単独では変更できないため、この順序が必要）。
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'scrap' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE scrap.%I OWNER TO app_scrap', r.relname);
  END LOOP;
END $$;

-- 念のため（スキーマ所有者は CREATE SCHEMA ... AUTHORIZATION で既に app_scrap）
ALTER SCHEMA scrap OWNER TO app_scrap;

COMMIT;

-- ----------------------------------------------------------------------------
-- 6. 確認
-- ----------------------------------------------------------------------------
\echo ''
\echo '=== scrap スキーマのテーブル（17件 + 所有者が app_scrap）==='
SELECT c.relname AS table_name, pg_get_userbyid(c.relowner) AS owner
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'scrap' AND c.relkind = 'r'
 ORDER BY 1;

\echo ''
\echo '=== 件数（手順1の「3. 実データの件数」と一致すること）==='
SELECT n.nspname AS schema, c.relname AS t,
       (xpath('/row/n/text()',
              query_to_xml(format('SELECT count(*) AS n FROM %I.%I', n.nspname, c.relname),
                           false, true, '')))[1]::text::bigint AS count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r'
   AND n.nspname IN ('public', 'scrap')
   AND c.relname IN ('companies','users','scrap_items','scrap_daily_records',
                     'scrap_daily_entries','scrap_monthly_inputs','scrap_procure_days')
 ORDER BY 1, 2;

\echo ''
\echo '=== public に残ったテーブル（pf-scrap のものが無いこと）==='
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1;

\echo ''
\echo '=== ロールの既定 search_path ==='
SELECT rolname, rolconfig FROM pg_roles WHERE rolname = 'app_scrap';
