# PFスクラップ管理

工場のスクラップ重量を日次で記録し、品目マスター・初品実測重量・McFrameの完成品数量・月次在庫入力と組み合わせて、**理論スクラップとスクラップ売却数量のズレ**を管理する業務アプリ（Palomaシリーズ）。

- **日次記録** — 紙のスクラップ日次記録票と同じ構成（朝礼確認 / 日中記録 / 終礼集計 / 備考）。当日合計・差異率は自動計算、月間集計・CSV出力つき
- **品目マスター** — KEY = 管理図番 + 製造場所CD（McFrameの設定）を自動生成。子図番での検索呼び出し、CSV一括取込/出力
- **初品重量測定** — 毎日生産した初品の単品完成品重量を登録。完成重量の計算には対象月末以前の最新実測値を使用（未測定はマスター理論値）
- **McFrame取込** — 完成品数量（加工数）のCSV取込。品目別に完成重量・使用量・理論スクラップを算出
- **月次入力** — 区分別（銅条/銅管/その他）の月初在庫・購入重量と、スクラップ売却数量
- **照合ダッシュボード** — ⑥売却×日次記録、⑦理論スクラップ×売却/日次記録の突合と年間推移。差異5%超はハイライト

## 技術構成

- Next.js (App Router) + Tailwind CSS 4 + `@paloma-pf/ui`（共通シェル） — 他のPalomaシリーズと同一パターン
- Supabase Postgres（`DATABASE_URL` + `DB_DRIVER=pg`）/ next-auth（JWT・12時間・アプリ固有Cookie名 `scrap.session-token`）
- ログインはポータル（portal.paloma-pf.com）のSSO一括ログインに一本化。パスワードログインは統一管理者（admin）のみ（SSO障害時の復旧用）
- 無操作の自動ログアウト（`@paloma-pf/ui` の useIdleLogout）→ ポータルの一括ログアウトへ

## 権限（ポータル連携）

| 役割 | できること |
| --- | --- |
| 一般（member） | 照合ダッシュボード閲覧・日次記録・初品重量測定・CSV出力 |
| 管理者（admin） | 上記 + 品目マスター編集/取込・McFrame取込・月次入力・日次記録の削除 |

- ポータルの名簿連携（`/api/provision`）でアカウントが発行され、役割・所属もポータル側の設定に追従する
- **所属工場（users.factory）が設定されたユーザーは自工場の日次記録のみ**（管理者も同じ）。工場未設定（本部スタッフ・ポータル管理者）は全工場閲覧可
- 退職・名簿からの削除はポータルから失効（disabled）が届き、残っているセッションでも入れなくなる

## ポータル連携API（PFシリーズ共通の契約）

| エンドポイント | 用途 |
| --- | --- |
| `GET /api/sso?token=…` | ポータルからのSSOログイン（`PF_PROVISION_KEY` によるHMAC署名・60秒有効。app キーは `scrap`） |
| `GET /api/logout?token=…` | ポータルの一括ログアウト（front-channel logout） |
| `POST /api/provision` | アカウント一括発行・更新・失効（共有キー認証） |
| `POST /api/portal-masters` | 工場・職場マスタの配信（日次記録の工場の入力候補に使用） |
| `GET /api/entitlement` | 利用権の確認（社内運用 `ON_PREMISE=1` では常に有効） |
| `GET /api/health` | 死活監視（DB接続まで確認） |

> ポータル側の登録（pf-portal）: `lib/appUrls.js` に `scrap`、`api/user.js` の `SSO_APP_KEYS`、`lib/provision.js` の `PROVISION_APP_KEYS`、`lib/masterSync.js` の `MASTER_SYNC_APP_KEYS`、ポータル画面のアプリタイルへの追加が必要です。

## 計算式（月次集計Excelの式を踏襲）

- **使用量(在庫法)** = 月初在庫 + 購入重量 − 翌月月初在庫
- **使用量(構成法)** = Σ(加工数 × 構成重量) ※翌月在庫が未入力の場合のフォールバック（画面にバッジ表示）
- **完成重量** = Σ(加工数 × 単品完成重量) ※初品実測値（対象月末以前の最新）を優先、未測定はマスター理論値
- **理論スクラップ** = 使用量 − 完成重量
- **⑥ 差異** = スクラップ売却数量 − 日次記録スクラップ合計
- **⑦ 売量vs理論** = スクラップ売却数量 − 理論スクラップ

> 前提: 使用量(構成法)は「加工数 × 構成重量」の合計で計算しています（構成数の乗算は行いません）。運用と合わない場合は `src/lib/calc.ts` の `monthlyItemRows` を調整してください。

## CSV取込フォーマット

**品目マスター**（管理者）: 1行目に見出しがあれば列順は自由（管理図番, 品名, KEY, 区分, 親図番, 親品名, 子図番, 子品名, 単位, 構成重量, 完成重量(理論), 製造場所CD, 製造場所名, 工場）。KEY 未指定時は自動生成。

**McFrame 完成品数量**（管理者）: `KEY,年月,加工数` または `管理図番,製造場所CD,年月,加工数`（1行目ヘッダー可）。年月は `2026-08` / `2026/08` / `202608` / 日付に対応。同じ年月×KEYは上書き。

文字コードは UTF-8 / Shift_JIS を自動判定。CSV出力は UTF-8 BOM 付き（Excelでそのまま開ける）。

## 開発

```bash
npm install
npm run dev   # http://localhost:5188
```

### 環境変数（.env.local）

| 変数 | 用途 |
| --- | --- |
| `DATABASE_URL` | Supabase Postgres（スクラップ専用DB）。**Session pooler** の接続文字列を使う |
| `DB_DRIVER` | `pg`（Supabase では明示推奨。未指定でもホスト名から自動判定される） |
| `NEXTAUTH_SECRET` / `NEXTAUTH_URL` | next-auth |
| `PF_PROVISION_KEY` | ポータル連携の共有キー（pf-portal と同じ値） |
| `PF_ADMIN_BOOTSTRAP_HASH` | 統一管理者（admin）ブートストラップ用 bcrypt ハッシュ（任意） |
| `ON_PREMISE` | `1` で社内運用（課金ゲートなし） |

### Supabase の接続について

- Supabase → Project → **Connect** → **Session pooler**（`...pooler.supabase.com:5432`）の接続文字列を使います。Vercel のサーバーレスから直接接続（`db.<ref>.supabase.co`）は接続枠を使い切りやすいため使いません。
- 接続文字列の末尾に `?sslmode=require` を付けます（pg が接続文字列から解釈します）。
- DB アダプタ（`src/lib/neon.ts`）はシリーズ共通で、Neon(HTTP) と 汎用 Postgres(node-postgres) を切り替えます。Supabase では後者が使われ、プーラの接続枠を分け合うため 1 インスタンスあたり最大 3 接続に抑えています。
- テーブルは初回アクセス時に自動作成されます（冪等な `CREATE TABLE IF NOT EXISTS`）。マイグレーションの手動実行は不要です。

## 記録保管期間

日次記録3年 / 月次集計5年（各画面のCSV出力を月次で保管してください）。
