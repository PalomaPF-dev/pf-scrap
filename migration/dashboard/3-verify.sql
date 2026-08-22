-- ============================================================================
-- 手順3: 移行後の確認
--
-- Supabase ダッシュボード → SQL Editor に貼って Run。読み取りのみ。
--
-- 見るところ（すべて OK になること）:
--   A.テーブル数        17
--   B.所有者            17（全て app_scrap）
--   C.public の残り     0
--   D.search_path       scrap
--   E.件数              手順1の '3.件数' と同じ値（detail が public → scrap）
-- ============================================================================
SELECT 'A.scrap のテーブル数' AS check, count(*)::text AS value, '' AS detail,
       CASE WHEN count(*) = 17 THEN 'OK' ELSE '★ 17 のはず' END AS judgement
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'scrap' AND c.relkind = 'r'

UNION ALL
SELECT 'B.所有者が app_scrap', count(*)::text, '',
       CASE WHEN count(*) = 17 THEN 'OK' ELSE '★ 17 のはず' END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'scrap' AND c.relkind = 'r'
   AND pg_get_userbyid(c.relowner) = 'app_scrap'

UNION ALL
SELECT 'C.public に残った pf-scrap の表', count(*)::text, '',
       CASE WHEN count(*) = 0 THEN 'OK' ELSE '★ 0 のはず' END
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r'
   AND c.relname IN (
     'companies','users','password_reset_tokens','pf_scrap_migrations',
     'portal_factories','portal_workplaces',
     'scrap_items','scrap_kinds','scrap_scales',
     'scrap_daily_records','scrap_daily_entries','scrap_first_articles',
     'scrap_mcframe_qty','scrap_mcframe_days','scrap_monthly_inputs',
     'scrap_procure_days','scrap_inventory_adjustments')

UNION ALL
SELECT 'D.既定 search_path', array_to_string(rolconfig, ','), '',
       CASE WHEN rolconfig @> ARRAY['search_path=scrap'] THEN 'OK'
            ELSE '★ search_path=scrap のはず' END
  FROM pg_roles WHERE rolname = 'app_scrap'

UNION ALL
SELECT 'E.件数', c.relname,
       n.nspname,
       (xpath('/row/n/text()',
              query_to_xml(format('SELECT count(*) AS n FROM %I.%I', n.nspname, c.relname),
                           false, true, '')))[1]::text
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r' AND n.nspname IN ('public','scrap')
   AND c.relname IN ('companies','users','scrap_items','scrap_daily_records',
                     'scrap_daily_entries','scrap_monthly_inputs','scrap_procure_days')
 ORDER BY 1, 2;
