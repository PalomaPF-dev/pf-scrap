-- ============================================================================
-- 手順2: ロール作成とテーブル移動
--
-- Supabase ダッシュボード → SQL Editor に貼って Run。
--
-- 【実行前にやること】
--   下の pw の '<<ここにパスワード>>' を、生成したパスワードに置き換える。
--   生成（Mac のターミナルでそのまま動きます。何も入れなくて構いません）:
--     LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32; echo
--
--   ダッシュボードの Database → Roles で app_scrap を先に作ってある場合は、
--   pw はそのままで構いません（既にあるロールのパスワードは変更しません）。
--
-- 【実行後にやること】
--   SQL Editor の履歴（スニペット）を削除してください。パスワードが残ります。
--
-- DO ブロック全体が1つのトランザクションです。途中で失敗したら、
-- ロールもスキーマもテーブルも、1つも変わっていません。
-- ============================================================================
DO $migrate$
DECLARE
  pw       text := '<<ここにパスワード>>';
  t        text;
  r        record;
  moved    int := 0;
  targets  text[] := ARRAY[
    'companies','users','password_reset_tokens','pf_scrap_migrations',
    'portal_factories','portal_workplaces',
    'scrap_items','scrap_kinds','scrap_scales',
    'scrap_daily_records','scrap_daily_entries','scrap_first_articles',
    'scrap_mcframe_qty','scrap_mcframe_days','scrap_monthly_inputs',
    'scrap_procure_days','scrap_inventory_adjustments'
  ];
BEGIN
  -- 1. ログインロール（既にあれば作らない。パスワードも変更しない）
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_scrap') THEN
    RAISE NOTICE 'app_scrap は既にあります。作成をとばします。';
  ELSE
    IF pw !~ '^[A-Za-z0-9]{16,}$' THEN
      RAISE EXCEPTION 'app_scrap のパスワードを pw の行に入れてください（英数字16文字以上）。'
                      ' Database > Roles で先に作成済みの場合は、この行はそのままで構いません。';
    END IF;
    EXECUTE format('CREATE ROLE app_scrap LOGIN PASSWORD %L', pw);
  END IF;

  -- CREATE SCHEMA ... AUTHORIZATION のためにメンバーシップを得る
  EXECUTE format('GRANT app_scrap TO %I', current_user);

  -- 2. スキーマ（所有者＝アプリロール）
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'scrap') THEN
    CREATE SCHEMA scrap AUTHORIZATION app_scrap;
  END IF;
  ALTER SCHEMA scrap OWNER TO app_scrap;

  -- 3. 既定 search_path（自スキーマのみ。public は含めない）
  ALTER ROLE app_scrap SET search_path = scrap;

  -- 4. public にある pf-scrap のテーブルを scrap へ移す
  --    対象は「アプリが CREATE TABLE している17表」だけ。
  --    public に他アプリの残骨があっても巻き込まない。
  FOREACH t IN ARRAY targets LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA scrap', t);
      moved := moved + 1;
    END IF;
  END LOOP;

  -- 5. 所有者を app_scrap にする
  --    アプリは起動のたびに CREATE TABLE IF NOT EXISTS / ALTER TABLE を流す
  --    （src/lib/schema.ts の ensureSchema）。所有者でないと弾かれる。
  --    ALTER TABLE ... OWNER TO は、そのテーブルが所有するシーケンスの
  --    所有者も一緒に変える（シーケンス単独では変更できない）。
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'scrap' AND c.relkind = 'r'
  LOOP
    EXECUTE format('ALTER TABLE scrap.%I OWNER TO app_scrap', r.relname);
  END LOOP;

  RAISE NOTICE '移動したテーブル: % 件', moved;
END
$migrate$;
