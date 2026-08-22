-- ============================================================================
-- 元に戻す（テーブルを public に戻す）
--
-- Supabase ダッシュボード → SQL Editor に貼って Run。
--
-- 使うのは「移行後にアプリが動かず、原因の切り分けに時間がかかる」ときだけ。
-- Vercel の DATABASE_URL も postgres ロールの値に戻すこと（順序はどちらでもよい）。
-- データはコピーせず付け替えるだけなので、往復しても中身は変わらない。
--
-- スキーマとロールは残す（残しても害はない）。完全に消すなら、実行後に:
--   DROP SCHEMA scrap;   -- 空になっていること
--   DROP ROLE app_scrap;
-- ============================================================================
DO $rollback$
DECLARE r record; moved int := 0;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'scrap' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE scrap.%I OWNER TO %I', r.relname, current_user);
    EXECUTE format('ALTER TABLE scrap.%I SET SCHEMA public', r.relname);
    moved := moved + 1;
  END LOOP;
  RAISE NOTICE 'public に戻したテーブル: % 件', moved;
END
$rollback$;
