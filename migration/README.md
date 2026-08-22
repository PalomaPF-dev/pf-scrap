# pf-scrap を `app_scrap` 専用ロールへ移す手順

## なぜやるか

他のPFアプリは「アプリごとに1スキーマ＋1ログインロール」で分離されています
（pf-portal の `docs/db-migration-plan.md`）。pf-scrap はその移行より後に
作ったため、この設計から漏れて **`postgres` ロールで `public` に**テーブルを
作ってきました。計画書のチェック項目にも反しています。

> 接続に `postgres` ロールを使っていない … `postgres` は管理作業専用とし、
> アプリからは絶対に使わない

2026-08-22 08:12(JST) に `postgres` の認証が通らなくなり pf-scrap だけが
停止したのも、これが理由です（他アプリは自分のロールなので無傷でした）。

## 他アプリの移行との違い

他アプリは Neon から dump/restore で移しましたが、**pf-scrap のデータは
既に同じDBの `public` にあります**。よってコピーはせず、
`ALTER TABLE ... SET SCHEMA` で付け替えるだけです。
データは1行も動かないので速く、取りこぼしもありません。

## 事前に用意するもの

- **psql**（PostgreSQL クライアント）
  - macOS: `brew install libpq && brew link --force libpq`
  - Windows(WSL/Ubuntu): `sudo apt install postgresql-client`
- **Supabase の `postgres` ロールのパスワード**
  （Supabase ダッシュボード → Project Settings → Database）

`app_scrap` のパスワードは実行時に自動生成します。用意する必要はありません。

> **接続情報はこのリポジトリにも、チャットにも貼らないでください。**
> 実行はすべて手元の端末で完結します。パスワードはファイルに書き込まないため、
> 置換したファイルを消し忘れてコミットする事故は起こりません。

## 手順

```bash
./migration/run.sh
```

聞かれるのは Supabase の `postgres` パスワードだけです（画面に表示されません）。
あとは通しで進みます。

| | 内容 | 変更 |
|---|---|---|
| 0 | 接続確認 | なし |
| 1 | 現状調査（`01-survey.sql`） | なし（SELECT のみ） |
| 2 | 確認プロンプト → ロール作成・テーブル移動（`02-migrate.sql`） | **あり** |
| 3 | `app_scrap` で実接続してテスト（`03-connection-test.sh`） | なし |
| 4 | Vercel に設定する `DATABASE_URL` を表示 | なし |

### 途中で手が止まる場所

**手順1のあと、続けるか聞かれます。** 次を確認してから `y` を入力してください。

- 「★ scrap 以外（要確認）」の行が無いこと
  あればそれは他アプリの残骨です。`02-migrate.sql` の `targets` から外す
  判断が要るので、いったん `N` で止めてください。
- 「3. 実データの件数」を控えること。手順2の出力と突き合わせます
  （`schema` 列が `public` → `scrap` に変わり、件数は同じになるのが正常）。

**手順4で表示される URI を Vercel に登録します。**

| 変数 | Environment |
|---|---|
| `DATABASE_URL` | Production |

- 値は秘密です。貼り終えたらターミナルを `clear` してください。
- 環境変数は実行時に参照されるため、保存した時点で反映されます（効かなければ再デプロイ）。

### 失敗したとき

手順2はトランザクションなので、**失敗していれば1つも変わっていません。**
手順3で落ちた場合は Vercel に設定せず、そのままご連絡ください
（この時点ではまだ本番は旧接続のままです）。

## 確認すること

- ポータルからログインできること
- 日次記録・品目マスターが表示されること
- ポータル管理画面から「名簿を全員分 再連携」を実行すること
  （障害中に失敗した30件の連携をやり直します。**所属工場はSSOでは同期できない**ため、
  ここを流さないと工場の絞り込みが効きません）

## 元に戻す場合

```bash
read -rs -p "postgres のパスワード: " PGPASSWORD; export PGPASSWORD; echo
psql -h aws-0-ap-northeast-1.pooler.supabase.com -p 5432 \
     -U postgres.<project_ref> -d postgres \
     -v ON_ERROR_STOP=1 -f migration/99-rollback.sql
# Vercel の DATABASE_URL も postgres ロールの値に戻す
```

テーブルを `public` に戻すだけです。データはコピーしていないので、
往復しても中身は変わりません。

## 検証状況

この手順は**ローカルのPostgreSQLで実際に通してあります**（接続先だけ差し替えた
`run.sh` を使用）。

- `run.sh` を通しで実行 → 17テーブルを移動、所有者は全て `app_scrap`、
  件数は移行前と一致、`public` は空、`rolconfig = {search_path=scrap}`、
  接続テスト OK=10 / NG=0
- 移行後のDBにアプリを接続 → api 18/18・ui 88/88・JSエラーなし
- **空スキーマからの起動も確認**。`scrap` スキーマだけ作った状態でアプリを
  起動し、`ensureSchema` が17テーブルを作り、全て `app_scrap` 所有になること
  （所有者を移していないと、ここで DDL が弾かれる）
- 2回目の実行（`app_scrap` が既にある状態）→ トランザクションが巻き戻り、
  DBは変わらないまま終了することを確認
- `99-rollback.sql` → 17テーブルが `public` に戻ることを確認

### `01-survey.sql` が見つけたもの

コードを読んで作った移動対象リストには `password_reset_tokens`（招待リンク・
パスワード再設定用）が抜けていました。調査スクリプトが「public にあるのに
移動対象に入っていない」と表示したため、対象を16→17テーブルに修正しています。
