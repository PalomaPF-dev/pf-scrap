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

- `postgres` ロールで **Session pooler（ポート5432）** に接続できる psql
  （`CREATE ROLE` はトランザクションプーラでは正しく動きません）
- `app_scrap` 用のパスワード（英数字32文字。URIに入れるとき percent-encoding が不要）

```bash
LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32; echo
```

> **接続情報はこのリポジトリにも、チャットにも貼らないでください。**
> パスワードを差し込んだファイルは `migration/*.local.sql` に置きます
> （`.gitignore` 済み）。

## 手順

### 1. 現状調査（読み取りのみ・何も変わりません）

```bash
export ADMIN_URI='postgresql://postgres.<project_ref>:<PW>@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres'
psql "$ADMIN_URI" -f migration/01-survey.sql
```

確認すること:

- 「★ scrap 以外（要確認）」の行が無いこと。
  あれば、それは他アプリの残骨なので**移動対象から外す**判断が必要です
  （`02-migrate.sql` の `targets` を編集）。
- 「3. 実データの件数」を控える。移行後に突き合わせます。

### 2. ロール作成とテーブル移動

```bash
cp migration/02-migrate.sql migration/migrate.local.sql
# migrate.local.sql の <PASSWORD_SCRAP> を生成したパスワードに置換
psql "$ADMIN_URI" -v ON_ERROR_STOP=1 -f migration/migrate.local.sql
```

確認すること:

- `scrap` スキーマに **17テーブル**、所有者が全て `app_scrap`
- 件数が手順1と一致
- `public` に pf-scrap のテーブルが残っていない
- `rolconfig` が `{search_path=scrap}`

### 3. 接続テスト（Vercelに入れる前に）

```bash
./migration/03-connection-test.sh \
  'postgresql://app_scrap.<project_ref>:<PW>@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres'
```

**全項目 OK になってから次へ進みます。**
ここで `search_path` を確認するのは、プーラ経由だとロール既定の
`search_path` が届かない事故があるためです。

### 4. Vercel の環境変数を差し替え

| 変数 | 値 | Environment |
|---|---|---|
| `DATABASE_URL` | `postgresql://app_scrap.<project_ref>:<PW>@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres` | Production |

- **アプリ実行時は 6543（Transaction pooler）**。5432 は管理作業用です。
- ホストは `db.<ref>.supabase.co` を使わないこと（IPv6のみで Vercel から届きません）。
- 環境変数は実行時にも参照されるため、**保存した時点で反映されます**
  （効かなければ再デプロイ）。

### 5. 動作確認

- ポータルからログインできること
- 日次記録・品目マスターが表示されること
- ポータル管理画面から「名簿を全員分 再連携」を実行（`/api/provision` が通ること）

## 元に戻す場合

```bash
psql "$ADMIN_URI" -v ON_ERROR_STOP=1 -f migration/99-rollback.sql
# Vercel の DATABASE_URL も postgres ロールの値に戻す
```

テーブルを `public` に戻すだけです。データはコピーしていないので、
往復しても中身は変わりません。

## 検証状況

この手順は**ローカルのPostgreSQLで実際に通してあります**。

- `01` → `02` → `03` → アプリ起動 → 一気通貫テスト（API 18/18・UI 82/82）→ `99` 復旧
- `01-survey.sql` が `password_reset_tokens`（招待リンク・パスワード再設定用）の
  移動漏れを検出したため、対象を17テーブルに修正済み
