#!/usr/bin/env bash
# ============================================================================
# app_scrap ロールで「実際に接続して」search_path と権限を検証する。
#
# なぜ SQL ファイルではなくこれが要るか:
#   ALTER ROLE ... SET search_path はログイン時に適用されるパラメータで、
#   psql の SET ROLE では引き継がれない。アプリと同じ「そのロールで接続する」
#   形でしか確認できない。プーラ経由で既定 search_path が届かない事故を、
#   Vercel に入れる前にここで捕まえる。
#
# 使い方（Vercel に設定するのと同じURIを渡すこと）:
#   ./migration/03-connection-test.sh \
#     'postgresql://app_scrap.<project_ref>:<PW>@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres'
# ============================================================================
set -uo pipefail
URI="${1:?第1引数に接続URIを指定してください}"

pass=0; fail=0
check() { # check <説明> <実際> <期待>
  if [ "$2" = "$3" ]; then echo "  OK   $1: $2"; pass=$((pass+1))
  else echo "  NG   $1: 実際=[$2] 期待=[$3]"; fail=$((fail+1)); fi
}

echo "=== 接続テスト: scrap ==="

echo
echo "--- 1. 接続できること / 接続ロール ---"
check "current_user" "$(psql "$URI" -Atc 'SELECT current_user' 2>&1)" "app_scrap"

echo
echo "--- 2. search_path が自スキーマになっていること（最重要）---"
check "current_schema()" "$(psql "$URI" -Atc 'SELECT current_schema()' 2>&1)" "scrap"
check "search_path"     "$(psql "$URI" -Atc 'SHOW search_path' 2>&1)"        "scrap"

echo
echo "--- 3. スキーマ修飾なしで自分のテーブルが見えること ---"
# アプリのSQLは全て修飾なし。ここが通れば無改修で動く。
check "users が引ける"       "$(psql "$URI" -Atc 'SELECT count(*) >= 0 FROM users' 2>&1)"       "t"
check "scrap_items が引ける" "$(psql "$URI" -Atc 'SELECT count(*) >= 0 FROM scrap_items' 2>&1)" "t"
check "scrap_kinds が引ける" "$(psql "$URI" -Atc 'SELECT count(*) >= 0 FROM scrap_kinds' 2>&1)" "t"

echo
echo "--- 4. DDL が流せること（アプリは起動のたびに ensureSchema を実行する）---"
# psql は文ごとにコマンドタグを返すので、エラーが無いことで判定する
ddl="$(psql "$URI" -Atc 'CREATE TABLE IF NOT EXISTS _conn_test_tmp (id int); DROP TABLE _conn_test_tmp;' 2>&1)"
case "$ddl" in
  *ERROR*|*error*|*"permission denied"*)
    echo "  NG   CREATE/DROP TABLE: $ddl"; fail=$((fail+1));;
  *)
    echo "  OK   CREATE/DROP TABLE"; pass=$((pass+1));;
esac

echo
echo "--- 5. 他アプリのスキーマが見えないこと（分離の確認）---"
for other in jinji setsubi operation; do
  out="$(psql "$URI" -Atc "SELECT 1 FROM $other.users LIMIT 1" 2>&1)"
  case "$out" in
    *"permission denied"*|*"does not exist"*) echo "  OK   $other は参照できない"; pass=$((pass+1));;
    *) echo "  NG   $other が見えてしまう: $out"; fail=$((fail+1));;
  esac
done

echo
echo "=== 合計: OK=$pass NG=$fail ==="
[ "$fail" -eq 0 ] || exit 1
