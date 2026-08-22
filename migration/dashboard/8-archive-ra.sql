-- ============================================================================
-- 使っていない ra_* を public から archive スキーマへ退避する
--
-- Supabase ダッシュボード → SQL Editor に貼って Run。
--
-- DROP ではなく退避にしている理由:
--   DROP TABLE は取り消せない。退避なら public からは消えて目的を達しつつ、
--   必要になれば 8b-restore-ra.sql で元に戻せる。しばらく様子を見て、
--   何も起きなければ最後に archive スキーマごと消せばよい:
--     DROP SCHEMA archive CASCADE;   -- ★ここまで来ると戻せない
--
-- pf-scrap の移行とは独立した作業。移行の前提条件ではない。
--
-- 対象は下の6表だけを名指しする（LIKE 'ra_%' のような書き方はしない。
-- 将来 ra で始まる別の表ができたときに巻き込まないため）。
-- 索引・制約・外部キーは表と一緒に移動する。ra_* 同士の外部キーも保たれる。
-- ============================================================================
DO $archive$
DECLARE
  t       text;
  moved   int := 0;
  targets text[] := ARRAY[
    'ra_answers','ra_assessment_documents','ra_assessments',
    'ra_components','ra_reports','ra_workplaces'
  ];
BEGIN
  -- public.ra_* を public の外から参照している外部キーが無いことを確かめる。
  -- あれば、そのアプリが現役ということなので退避しない。
  --
  -- 参照先（tn）も public に限定するのが要点。名前だけで判定すると、
  -- 他スキーマの中で完結している同名表の外部キーまで拾ってしまう。
  -- 実際に本番では sds スキーマが同名の ra_* 一式を持っていて、
  -- sds.ra_answers → sds.ra_assessments が誤検知された。
  IF EXISTS (
    SELECT 1
      FROM pg_constraint con
      JOIN pg_class src ON src.oid = con.conrelid
      JOIN pg_class tgt ON tgt.oid = con.confrelid
      JOIN pg_namespace sn ON sn.oid = src.relnamespace
      JOIN pg_namespace tn ON tn.oid = tgt.relnamespace
     WHERE con.contype = 'f'
       AND tn.nspname = 'public'
       AND sn.nspname <> 'public'
       AND tgt.relname = ANY(targets)
  ) THEN
    RAISE EXCEPTION 'public.ra_* を public の外から参照している表があります。退避を中止しました。';
  END IF;

  -- 空でない表があれば止める（使っていないという前提そのものの確認）
  FOREACH t IN ARRAY targets LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = t
    ) THEN
      IF (xpath('/row/n/text()',
                query_to_xml(format('SELECT count(*) AS n FROM public.%I', t),
                             false, true, '')))[1]::text::bigint > 0 THEN
        RAISE EXCEPTION 'public.% に行があります。退避を中止しました。', t;
      END IF;
    END IF;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'archive') THEN
    CREATE SCHEMA archive;
  END IF;

  FOREACH t IN ARRAY targets LOOP
    IF EXISTS (
      SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname = t
    ) THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA archive', t);
      moved := moved + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '退避したテーブル: % 件', moved;
END
$archive$;

-- 確認: archive に移った表と、残っている行数（データは消えていない）
SELECT n.nspname AS schema,
       c.relname AS table_name,
       (xpath('/row/n/text()',
              query_to_xml(format('SELECT count(*) AS n FROM %I.%I', n.nspname, c.relname),
                           false, true, '')))[1]::text AS rows
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE c.relkind = 'r' AND c.relname LIKE 'ra\_%'
 ORDER BY 1, 2;
