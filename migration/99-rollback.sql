-- ============================================================================
-- pf-scrap の app_scrap 移行を元に戻す（テーブルを public に戻す）
--
-- 実行者: postgres ロール / Session pooler（5432）
--   psql "postgresql://postgres.<ref>:<PW>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres" \
--        -v ON_ERROR_STOP=1 -f migration/99-rollback.sql
--
-- 使うのは「移行後にアプリが動かず、原因の切り分けに時間がかかる」ときだけ。
-- Vercel の DATABASE_URL も postgres ロールの値に戻すこと（順序はどちらでもよい）。
-- データはコピーせず付け替えるだけなので、往復しても中身は変わらない。
-- ============================================================================
BEGIN;

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'scrap' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE scrap.%I OWNER TO postgres', r.relname);
    EXECUTE format('ALTER TABLE scrap.%I SET SCHEMA public', r.relname);
  END LOOP;
END $$;

COMMIT;

-- スキーマとロールは残しても害はない。完全に消すなら次を実行する。
--   DROP SCHEMA scrap;            -- 空になっていること
--   DROP ROLE app_scrap;

\echo ''
\echo '=== public に戻ったテーブル ==='
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1;
