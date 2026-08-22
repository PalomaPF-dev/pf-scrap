#!/usr/bin/env bash
# ============================================================================
# pf-scrap を app_scrap 専用ロールへ移す — 対話式ランナー
#
#   ./migration/run.sh
#
# 聞くのは Supabase の postgres パスワードだけ。あとは
#   手順1 調査 → 手順2 移行 → 手順3 接続テスト → 設定するURIの表示
# まで通しでやる。app_scrap のパスワードはこの場で生成し、ファイルには
# 一切書かない（置換したファイルを消し忘れてコミットする事故を防ぐ）。
#
# 途中で失敗したら、そこで止まる。手順2はトランザクションなので、
# 失敗した場合は何も変わっていない。
# ============================================================================
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

RED=$'\033[31m'; GRN=$'\033[32m'; YLW=$'\033[33m'; BLD=$'\033[1m'; RST=$'\033[0m'
say()  { printf '%s\n' "$*"; }
head2() { printf '\n%s%s%s\n' "$BLD" "$*" "$RST"; }
die()  { printf '\n%s!! %s%s\n' "$RED" "$*" "$RST" >&2; exit 1; }

command -v psql >/dev/null 2>&1 || die "psql が見つかりません。PostgreSQL クライアントを入れてください。
  macOS: brew install libpq && brew link --force libpq
  Windows(WSL/Ubuntu): sudo apt install postgresql-client"

head2 "pf-scrap を app_scrap 専用ロールへ移します"
say "この端末から Supabase に接続します。入力したパスワードは画面に出ず、"
say "ファイルにも残りません。"

# ---- 接続先 -----------------------------------------------------------------
DEFAULT_REF="asustezkyqzuetrxwijp"
DEFAULT_HOST="aws-0-ap-northeast-1.pooler.supabase.com"

read -r -p "Supabase の project ref [$DEFAULT_REF]: " REF
REF="${REF:-$DEFAULT_REF}"
read -r -p "プーラのホスト名 [$DEFAULT_HOST]: " HOST
HOST="${HOST:-$DEFAULT_HOST}"

# 管理作業は Session pooler(5432)。CREATE ROLE は Transaction pooler では通らない。
read -r -s -p "postgres ロールのパスワード（表示されません）: " PGPW; echo
[ -n "$PGPW" ] || die "パスワードが空です。"

export PGPASSWORD="$PGPW"
ADMIN=(-h "$HOST" -p 5432 -U "postgres.$REF" -d postgres)

head2 "0. 接続確認"
who="$(psql "${ADMIN[@]}" -Atc 'SELECT current_user' 2>&1)"
[ "$who" = "postgres" ] || die "postgres として接続できませんでした: $who"
say "${GRN}OK${RST} postgres で接続できました（$HOST:5432）"

# ---- 手順1: 調査 ------------------------------------------------------------
head2 "1. 現状調査（読み取りのみ。何も変わりません）"
psql "${ADMIN[@]}" -v ON_ERROR_STOP=1 -f migration/01-survey.sql || die "調査に失敗しました。"

cat <<'NOTE'

上の出力を確認してください:
  - 「★ scrap 以外（要確認）」の行が無いこと
      あれば他アプリの残骨です。02-migrate.sql の targets を直してから続けます。
  - 「3. 実データの件数」を控えること（移行後に突き合わせます）
NOTE
read -r -p "続けますか？ [y/N]: " ans
case "$ans" in y|Y|yes|YES) ;; *) say "中止しました。何も変更していません。"; exit 0;; esac

# ---- 手順2: 移行 ------------------------------------------------------------
head2 "2. ロール作成とテーブル移動"
APPPW="$(LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32)"
[ "${#APPPW}" -eq 32 ] || die "パスワードの生成に失敗しました。"

if ! psql "${ADMIN[@]}" -v ON_ERROR_STOP=1 -v pw="$APPPW" -f migration/02-migrate.sql; then
  say ""
  say "${YLW}移行はトランザクションなので、失敗していれば何も変わっていません。${RST}"
  say "app_scrap が既にある場合は、作り直すか 99-rollback.sql で戻してから再実行してください。"
  die "移行に失敗しました。"
fi

# ---- 手順3: 接続テスト ------------------------------------------------------
# アプリ実行時は Transaction pooler(6543)。生成パスワードは英数字のみなので
# URI に percent-encoding は要らない。
APP_URI="postgresql://app_scrap.$REF:$APPPW@$HOST:6543/postgres"

head2 "3. app_scrap で実際に接続してテスト"
if ! ./migration/03-connection-test.sh "$APP_URI"; then
  say ""
  say "${YLW}Vercel には設定しないでください。${RST}"
  say "戻す場合: PGPASSWORD=... psql ... -f migration/99-rollback.sql"
  die "接続テストに失敗しました。"
fi

# ---- 手順4: 設定するURI -----------------------------------------------------
head2 "4. Vercel に設定する DATABASE_URL"
cat <<NOTE

  プロジェクト : pf-scrap
  変数名       : DATABASE_URL
  Environment  : Production
  値           :

$APP_URI

  ${YLW}この値は秘密です。${RST}Vercel に貼ったら、この画面はクリアしてください（clear）。
  チャットやチケットには貼らないでください。

  保存すると実行時に反映されます（効かなければ再デプロイ）。
NOTE

head2 "5. 保存したあとの確認"
cat <<'NOTE'
  - ポータルからログインできること
  - 日次記録・品目マスターが表示されること
  - ポータル管理画面から「名簿を全員分 再連携」を実行すること
      （障害中に失敗した30件の連携をやり直します。所属工場もここで入ります）
NOTE

say ""
say "${GRN}移行のDB側は完了しました。${RST}"
