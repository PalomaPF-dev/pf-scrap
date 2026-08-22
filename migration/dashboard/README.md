# psql を入れずに移行する（Supabase ダッシュボード版）

`migration/run.sh` は psql（PostgreSQL クライアント）が要ります。
Homebrew を入れたくない場合は、**Supabase ダッシュボードの SQL Editor** で
同じことができます。インストールは何も要りません。

親フォルダの `run.sh` と結果は同じです。どちらか一方だけをやってください。

## 手順

Supabase ダッシュボード → 左メニュー **SQL Editor** → `New query` に貼って `Run`。

| | 貼るファイル | DBの変更 |
|---|---|---|
| 1 | `1-survey.sql` | なし（SELECT のみ） |
| 2 | `2-migrate.sql` | **あり** |
| 3 | `3-verify.sql` | なし |

### 1. 現状調査

`1-survey.sql` をそのまま貼って Run。結果は1つの表に出ます。

- `judgement` が **`★ scrap 以外（要確認）`** の行が無いこと
  あればそれは他アプリの残骨です。移動対象から外す判断が要るので、
  そのまま止めてご連絡ください。
- `section = '3.件数'` の値を控えること。手順3と突き合わせます。

### 2. ロール作成とテーブル移動

**貼る前に**、Mac のターミナルでパスワードを作ります
（Homebrew も psql も要りません。標準のコマンドだけです）:

```bash
LC_ALL=C tr -dc 'A-Za-z0-9' </dev/urandom | head -c 32; echo
```

`2-migrate.sql` の **22行目** を、出てきた32文字に書き換えます:

```sql
  pw       text := '<<ここにパスワード>>';
```

そのうえで全体を SQL Editor に貼って Run。

- 全体が1つのトランザクションです。**失敗したら1つも変わっていません。**
- `移動したテーブル: 17 件` と出れば成功です。
- 実行後、**SQL Editor の履歴（スニペット）を削除してください。**
  パスワードが残ります。

> Database → Roles で `app_scrap` を先に作ってある場合は、22行目はそのままで
> 構いません。既にあるロールのパスワードは変更しません。

### 3. 確認

`3-verify.sql` を貼って Run。A〜D がすべて `OK`、E の件数が手順1と同じ
（`detail` が `public` → `scrap` に変わる）ことを確認します。

### 4. Vercel の環境変数

| 変数 | 値 | Environment |
|---|---|---|
| `DATABASE_URL` | `postgresql://app_scrap.<project_ref>:<パスワード>@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres` | Production |

- `<project_ref>` は Supabase の Project Settings に出ている英数字の ID です。
- **ポート 6543**（Transaction pooler）。アプリ実行時はこちらです。
- ホストに `db.<ref>.supabase.co` は使えません（IPv6のみで Vercel から届きません）。
- 保存した時点で反映されます（効かなければ再デプロイ）。

## 元に戻す場合

`9-rollback.sql` を SQL Editor で Run し、Vercel の `DATABASE_URL` も
`postgres` ロールの値に戻します。テーブルを `public` に戻すだけで、
データはコピーしていないので往復しても中身は変わりません。

## run.sh 版との違い

`run.sh` は `app_scrap` で**実際に接続して** `search_path` が届くかを
確かめますが（`03-connection-test.sh`）、ダッシュボードは `postgres` として
接続するため、この確認だけができません。

代わりに、Vercel の `DATABASE_URL` を保存したあと、本番の応答と Vercel の
実行ログで確認します。`search_path` が届いていない場合は
`relation "users" does not exist` が出るので、すぐ分かります。
その場合は `9-rollback.sql` で戻せます。

## 検証状況

このダッシュボード版も、ローカルのPostgreSQLで実際に通してあります。

- `1-survey.sql` → `2-migrate.sql` → `3-verify.sql` で
  17テーブル移動・所有者は全て `app_scrap`・件数一致・`public` は空・
  `search_path=scrap`（A〜D すべて OK）
- 移行後のDBにアプリを接続 → ui 88/88・JSエラーなし
- パスワードを書き換えずに実行 → その場で停止し、DBは変わらない
- `9-rollback.sql` → 17テーブルが `public` に戻る
- 2回目の実行 → ロール作成をとばして通る（何度流しても壊れない）
