-- ============================================================================
-- 退避した ra_* を public に戻す（8-archive-ra.sql の取り消し）
--
-- Supabase ダッシュボード → SQL Editor に貼って Run。
-- archive スキーマを DROP する前なら、いつでもこれで戻せる。
-- ============================================================================
DO $restore$
DECLARE r record; moved int := 0;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'archive' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE archive.%I SET SCHEMA public', r.relname);
    moved := moved + 1;
  END LOOP;
  RAISE NOTICE 'public に戻したテーブル: % 件', moved;
END
$restore$;

SELECT n.nspname AS schema, c.relname AS table_name
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r' AND c.relname LIKE 'ra\_%'
 ORDER BY 1, 2;
