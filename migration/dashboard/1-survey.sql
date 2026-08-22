-- ============================================================================
-- 手順1: 現状調査（読み取りのみ。実行しても何も変わりません）
--
-- Supabase ダッシュボード → SQL Editor に貼って Run。
-- 1本のクエリにまとめてあるので、結果は1つの表にまとめて出ます。
--
-- 見るところ:
--   section = '1.public のテーブル' に judgement='★ scrap 以外（要確認）' が
--     無いこと。あれば他アプリの残骨なので、移動対象から外す判断が要ります。
--   section = '3.件数' を控えること。手順3の出力と突き合わせます
--     （detail が public → scrap に変わり、件数は同じになるのが正常）。
-- ============================================================================
WITH targets(name) AS (
  SELECT unnest(ARRAY[
    'companies','users','password_reset_tokens','pf_scrap_migrations',
    'portal_factories','portal_workplaces',
    'scrap_items','scrap_kinds','scrap_scales',
    'scrap_daily_records','scrap_daily_entries','scrap_first_articles',
    'scrap_mcframe_qty','scrap_mcframe_days','scrap_monthly_inputs',
    'scrap_procure_days','scrap_inventory_adjustments'])
)
SELECT '1.public のテーブル' AS section,
       c.relname            AS name,
       pg_get_userbyid(c.relowner) AS detail,
       CASE WHEN c.relname IN (SELECT name FROM targets)
            THEN 'scrap が使う' ELSE '★ scrap 以外（要確認）' END AS judgement
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r'

UNION ALL
SELECT '2.移動対象なのに public に無い', t.name, '', '未作成なら空でよい'
  FROM targets t
 WHERE NOT EXISTS (
   SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = t.name)

UNION ALL
-- 実在する表だけを数える（移行後に流し直しても落ちない）
SELECT '3.件数', c.relname, n.nspname,
       (xpath('/row/n/text()',
              query_to_xml(format('SELECT count(*) AS n FROM %I.%I', n.nspname, c.relname),
                           false, true, '')))[1]::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r' AND n.nspname IN ('public','scrap')
   AND c.relname IN ('companies','users','scrap_items','scrap_daily_records',
                     'scrap_daily_entries','scrap_monthly_inputs','scrap_procure_days')

UNION ALL
SELECT '4.app_scrap ロール', rolname, '', '無いのが正常（再実行時は有る）'
  FROM pg_roles WHERE rolname = 'app_scrap'

UNION ALL
SELECT '4.scrap スキーマ', nspname, pg_get_userbyid(nspowner), '無いのが正常（再実行時は有る）'
  FROM pg_namespace WHERE nspname = 'scrap'

UNION ALL
SELECT '5.他アプリのスキーマ', nspname, pg_get_userbyid(nspowner), 'この一覧に scrap が無いこと'
  FROM pg_namespace
 WHERE nspname NOT LIKE 'pg\_%'
   AND nspname NOT IN ('information_schema','public','extensions','graphql',
                       'graphql_public','net','pgbouncer','realtime','storage',
                       'supabase_functions','vault','auth','cron')
 ORDER BY 1, 2;
