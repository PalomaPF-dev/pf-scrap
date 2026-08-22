-- ============================================================================
-- pf-scrap を app_scrap 専用ロールへ移す — 手順1: 現状調査（読み取りのみ）
--
-- 実行者: postgres ロール
-- 接続先: Supavisor の【Session pooler（ポート5432）】
--   psql "postgresql://postgres.<project_ref>:<PW>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres" \
--        -f migration/01-survey.sql
--
-- このファイルは SELECT しかしない。実行しても何も変わらない。
-- 出力を確認してから 02 に進むこと。パスワードは出力に含まれない。
--
-- なぜ調査が要るか:
--   pf-scrap は他アプリの移行より後に作られたため、専用スキーマを持たず
--   postgres ロールで public にテーブルを作ってきた。public に他の残骨
--   （旧共有DBの名残など）が混ざっていないかを、動かす前に目で確認する。
--   とくに users / companies は名前が一般的なので必ず確認する。
-- ============================================================================

\echo '=== 1. public にあるテーブル（所有者・概算行数）==='
SELECT c.relname AS table_name,
       pg_get_userbyid(c.relowner) AS owner,
       c.reltuples::bigint AS approx_rows,
       CASE WHEN c.relname IN (
         'companies','users','password_reset_tokens','pf_scrap_migrations',
         'portal_factories','portal_workplaces',
         'scrap_items','scrap_kinds','scrap_scales',
         'scrap_daily_records','scrap_daily_entries','scrap_first_articles',
         'scrap_mcframe_qty','scrap_mcframe_days','scrap_monthly_inputs',
         'scrap_procure_days','scrap_inventory_adjustments'
       ) THEN 'scrap が使う' ELSE '★ scrap 以外（要確認）' END AS judgement
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r'
 ORDER BY judgement DESC, c.relname;

\echo ''
\echo '=== 2. scrap が使うテーブルのうち public に無いもの（未作成なら空でよい）==='
SELECT t.name AS missing_in_public
  FROM unnest(ARRAY[
         'companies','users','password_reset_tokens','pf_scrap_migrations',
         'portal_factories','portal_workplaces',
         'scrap_items','scrap_kinds','scrap_scales',
         'scrap_daily_records','scrap_daily_entries','scrap_first_articles',
         'scrap_mcframe_qty','scrap_mcframe_days','scrap_monthly_inputs',
         'scrap_procure_days','scrap_inventory_adjustments'
       ]) AS t(name)
 WHERE NOT EXISTS (
   SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = t.name)
 ORDER BY 1;

\echo ''
\echo '=== 3. 実データの件数（移行の前後で突き合わせる）==='
SELECT 'companies' AS t, count(*) FROM public.companies
UNION ALL SELECT 'users', count(*) FROM public.users
UNION ALL SELECT 'scrap_items', count(*) FROM public.scrap_items
UNION ALL SELECT 'scrap_daily_records', count(*) FROM public.scrap_daily_records
UNION ALL SELECT 'scrap_daily_entries', count(*) FROM public.scrap_daily_entries
UNION ALL SELECT 'scrap_monthly_inputs', count(*) FROM public.scrap_monthly_inputs
UNION ALL SELECT 'scrap_procure_days', count(*) FROM public.scrap_procure_days
ORDER BY 1;

\echo ''
\echo '=== 4. app_scrap ロール / scrap スキーマの有無（無いのが正常。再実行時は有る）==='
SELECT rolname FROM pg_roles WHERE rolname = 'app_scrap';
SELECT nspname, pg_get_userbyid(nspowner) AS owner
  FROM pg_namespace WHERE nspname = 'scrap';

\echo ''
\echo '=== 5. 他アプリのスキーマ（この一覧に scrap が無いことを確認）==='
SELECT nspname AS schema, pg_get_userbyid(nspowner) AS owner
  FROM pg_namespace
 WHERE nspname NOT LIKE 'pg\_%'
   AND nspname NOT IN ('information_schema','public','extensions','graphql',
                       'graphql_public','net','pgbouncer','realtime','storage',
                       'supabase_functions','vault','auth','cron')
 ORDER BY 1;
