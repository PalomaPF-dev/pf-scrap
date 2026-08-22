-- ============================================================================
-- 手順1b: 共用テーブルの調査（読み取りのみ）
--
-- 1-survey.sql で public に他アプリの表（ra_* / sds_*）が見つかったとき、
-- users / companies を pf-scrap 以外も使っていないかを確かめる。
--
-- pf-scrap は users / companies を「修飾なし」で使う数少ないアプリで、
-- 他アプリは sds_users のように接頭辞つきの自前テーブルを持つ。
-- もし他アプリが public.users を共用していると、scrap へ移した瞬間に
-- そのアプリが relation "users" does not exist で落ちる。
--
-- 見るところ:
--   A  users/companies を参照する外部キーが、scrap_* と portal_* だけであること
--      （ra_* や sds_* が出たら共用。移行方法を変える必要がある）
--   B  public.users の列が pf-scrap の定義（src/lib/authDb.ts）と一致すること
--      知らない列があれば、他アプリが足したもの＝共用の可能性
--   C  ra_* / sds_* / users / companies が他スキーマにもあるか
--      あれば public 側は移行済みアプリの残骨で、放置してよい
--   D  public の表の利用状況（rows と scan）。ra_* に行があれば現役の可能性
-- ============================================================================
SELECT 'A.users/companies を参照する外部キー' AS section,
       src.relname AS name,
       tgt.relname AS detail,
       con.conname AS extra
  FROM pg_constraint con
  JOIN pg_class src ON src.oid = con.conrelid
  JOIN pg_class tgt ON tgt.oid = con.confrelid
  JOIN pg_namespace sn ON sn.oid = src.relnamespace
  JOIN pg_namespace tn ON tn.oid = tgt.relnamespace
 WHERE con.contype = 'f'
   AND tn.nspname = 'public'
   AND tgt.relname IN ('users','companies')

UNION ALL
SELECT 'B.public.users の列', a.attname, format_type(a.atttypid, a.atttypmod), ''
  FROM pg_attribute a
 WHERE a.attrelid = 'public.users'::regclass AND a.attnum > 0 AND NOT a.attisdropped

UNION ALL
SELECT 'C.同名の表が他スキーマにもあるか', c.relname, n.nspname, ''
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r'
   AND n.nspname NOT IN ('public','information_schema','pg_catalog','pg_toast')
   AND (c.relname LIKE 'ra\_%' OR c.relname LIKE 'sds\_%'
        OR c.relname IN ('users','companies'))

UNION ALL
SELECT 'D.public の表の利用状況', relname,
       'rows=' || n_live_tup, 'scan=' || (coalesce(seq_scan,0) + coalesce(idx_scan,0))
  FROM pg_stat_user_tables WHERE schemaname = 'public'

UNION ALL
SELECT 'E.public.companies の中身', name, id::text, ''
  FROM public.companies
 ORDER BY 1, 2;
