import crypto from "crypto";
import bcrypt from "bcryptjs";
import { getSql } from "./neon";
import { formatAffiliation } from "@paloma-pf/ui";

/**
 * ユーザーの役割（ポータルの3段階のうちアプリ側は2種）。
 * admin=管理者（マスタ設定・月次入力・取込が可能）、member=一般（日次記録・初品測定・閲覧）。
 * worker は旧データに残る値で、一般として扱う。
 */
export type UserRole = "admin" | "member" | "worker";

export const USER_ROLE_LABEL: Record<UserRole, string> = {
  admin: "管理者",
  member: "一般",
  worker: "一般",
};

/** 認証用テーブル（companies/users）を冪等に作成。空DBでも自動初期化されるようにする。 */
export async function ensureAuthSchema(): Promise<void> {
  const sql = getSql();
  await sql`
    CREATE TABLE IF NOT EXISTS companies (
      id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name       TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  // デモ会社フラグ。SSO・authorize が companies.is_demo を参照するため、
  // ドメインスキーマ（schema.ts）より先に呼ばれてもここで列を保証する。
  await sql`ALTER TABLE companies ADD COLUMN IF NOT EXISTS is_demo BOOLEAN NOT NULL DEFAULT false`;
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_id    UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      email         TEXT UNIQUE,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
  await sql`CREATE INDEX IF NOT EXISTS users_company_id_idx ON users(company_id)`;
  // 役割。既定は member（管理者はポータルのプロビジョニングで明示的に付与）。
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT`;
  await sql`UPDATE users SET role = 'member' WHERE role IS NULL`;
  // 招待（アカウント発行）モデル用の列。pending=true は発行済み・パスワード未設定。
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS pending BOOLEAN NOT NULL DEFAULT false`;
  // 失効フラグ。ポータルで退職・削除された人を止める（/api/provision の disabled で届く）。
  // JWT は取り消せないので、手元に残った cookie はリクエストごとにこの列で弾く。
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT false`;
  // 所属工場（表示制限用）。NULL=全工場閲覧可。記録・品目の工場名との文字列一致で照合する。
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS factory TEXT`;
  // 社員番号ログイン（login_id）。email は任意（社内は未登録の社員が多い）。
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS login_id TEXT`;
  // 指定承認者（ポータルの上司設定）。このアプリでは承認フローに使わないが連携値は保持する。
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS approver_login_id TEXT`;
  // ポータルの所属（表示専用）。サイドバーの「所属／氏名」に出す。
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS portal_department TEXT`;
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS portal_workplace TEXT`;
  await sql`CREATE UNIQUE INDEX IF NOT EXISTS users_login_id_idx ON users(login_id)`;
  await sql`ALTER TABLE users ALTER COLUMN email DROP NOT NULL`;
  // 統一管理者（login_id='admin'）のブートストラップ
  await ensureAdminBootstrap();
}

/** 実運用の会社名（統一管理者・プロビジョニングの発行先）。PFシリーズ共通の固定値。 */
export const BOOTSTRAP_COMPANY_NAME = "株式会社パロマ";

/**
 * 実運用の会社「株式会社パロマ」を名前で get-or-create して id を返す。
 * 既存があれば必ず再利用する（同名が複数あっても最古の1社に寄せる）。
 */
async function getOrCreateBootstrapCompany(sql: ReturnType<typeof getSql>): Promise<string> {
  const companies = await sql`
    SELECT id FROM companies WHERE name = ${BOOTSTRAP_COMPANY_NAME}
    ORDER BY created_at ASC LIMIT 1`;
  const existing = companies[0]?.id as string | undefined;
  if (existing) return existing;
  const created = await sql`
    INSERT INTO companies (name) VALUES (${BOOTSTRAP_COMPANY_NAME}) RETURNING id`;
  return created[0].id as string;
}

/**
 * 統一管理者ブートストラップ（冪等）。
 * login_id='admin' のユーザーが居ない場合のみ、環境変数 PF_ADMIN_BOOTSTRAP_HASH
 * （bcrypt ハッシュ）が設定されていれば「株式会社パロマ」（無ければ作成）＋
 * 管理者ユーザー（login_id='admin'）を作成する。env が無ければ何もしない。
 */
async function ensureAdminBootstrap(): Promise<void> {
  const hash = (process.env.PF_ADMIN_BOOTSTRAP_HASH ?? "").trim();
  if (!hash) return;
  const sql = getSql();
  const admin = await sql`SELECT 1 FROM users WHERE login_id = 'admin' LIMIT 1`;
  if (admin.length > 0) return;
  const companyId = await getOrCreateBootstrapCompany(sql);
  // email 重複などの競合時は何もしない（冪等・安全側）
  await sql`
    INSERT INTO users (company_id, login_id, email, name, password_hash, role, pending)
    VALUES (${companyId}, 'admin', ${null}, ${"管理者"}, ${hash}, 'admin', false)
    ON CONFLICT DO NOTHING`;
}

/**
 * 会社名で会社を取得し、無ければ作成して ID を返す（get-or-create）。
 * 統一管理者ブートストラップと同じ方法（最古の同名会社を採用）。ポータル一括発行(provision)用。
 */
export async function getOrCreateCompanyByName(name: string): Promise<string> {
  const sql = getSql();
  const rows = await sql`
    SELECT id FROM companies WHERE name = ${name}
    ORDER BY created_at ASC LIMIT 1`;
  const existing = rows[0]?.id as string | undefined;
  if (existing) return existing;
  const created = await sql`INSERT INTO companies (name) VALUES (${name}) RETURNING id`;
  return created[0].id as string;
}

/**
 * 招待ユーザーを作成（pending=true）。ログインできないランダムなハッシュを設定し、
 * パスワードは招待リンク（/password-reset/confirm）から本人が設定する。作成したIDを返す。
 */
export async function createInvitedUser(
  companyId: string,
  loginId: string,
  name: string,
  role: UserRole,
  email: string | null = null,
  factory: string | null = null,
  approverLoginId: string | null = null
): Promise<string> {
  const sql = getSql();
  // ランダムな使えないパスワード（パスワード設定完了までログイン不可。SSO は可）
  const passwordHash = await bcrypt.hash(crypto.randomBytes(24).toString("hex"), 12);
  const rows = await sql`
    INSERT INTO users (company_id, login_id, email, name, password_hash, role, pending, factory, approver_login_id)
    VALUES (${companyId}, ${loginId}, ${email}, ${name}, ${passwordHash}, ${role}, true, ${factory}, ${approverLoginId})
    RETURNING id
  `;
  return rows[0].id as string;
}

/**
 * 会社内の特定ユーザーの役割と所属工場を返す（存在しなければ role=null）。
 * 所属工場による表示制限の判定に使う。列未作成の古いDBでは ensureAuthSchema で
 * 列を用意してから再取得する（デプロイ直後の互換）。
 */
export async function getUserRoleFactory(
  companyId: string,
  userId: string
): Promise<{ role: UserRole | null; factory: string | null; workplace: string | null }> {
  const sql = getSql();
  const query = () => sql`
    SELECT role, factory, portal_workplace FROM users
    WHERE company_id = ${companyId} AND id = ${userId} LIMIT 1`;
  let rows;
  try {
    rows = await query();
  } catch {
    await ensureAuthSchema();
    rows = await query();
  }
  if (!rows[0]) return { role: null, factory: null, workplace: null };
  const r = rows[0] as { role: string | null; factory: string | null; portal_workplace: string | null };
  return {
    role: (r.role ?? "admin") as UserRole,
    factory: r.factory ?? null,
    workplace: r.portal_workplace ?? null,
  };
}

/**
 * サイドバーに出す所属の表示文字列。ポータルから連携された部署名・職場名を並べる
 * （工場所属なら「工場名 職場名」、それ以外は部署名）。未連携・取得不可は null。
 */
export async function getUserAffiliation(userId: string): Promise<string | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT portal_department, portal_workplace FROM users WHERE id = ${userId} LIMIT 1`;
  if (rows.length === 0) return null;
  // 並べ方（部署名＋半角スペース＋職場名）は全PFアプリ共通なので @paloma-pf/ui に置いてある。
  return formatAffiliation({
    department: rows[0].portal_department,
    workplace: rows[0].portal_workplace,
  });
}

/**
 * ポータルから連携された部署名（例「生産管理部」）。未連携・取得不可は null。
 * 機能ごとの利用権限（マスタ・取込・調達入力）の判定に使う。
 */
export async function getUserDepartment(userId: string): Promise<string | null> {
  const sql = getSql();
  const rows = await sql`
    SELECT portal_department FROM users WHERE id = ${userId} LIMIT 1`;
  const v = (rows[0]?.portal_department ?? "").toString().trim();
  return v || null;
}

/**
 * このユーザーが失効（退職・名簿からの削除）しているか。
 * ポータルから /api/provision で届く users.disabled を見る。JWT は取り消せないため、
 * リクエストごとにここで確認して、手元に残った cookie を無効にする。
 *
 * DB が引けないときは false（通す）。この状態ではどのみち画面にデータが出ないうえ、
 * 一時障害で全員がログイン画面へ飛ばされるほうが困るため。
 */
export async function isUserDisabled(userId: string): Promise<boolean> {
  try {
    const sql = getSql();
    const rows = await sql`SELECT disabled FROM users WHERE id = ${userId} LIMIT 1`;
    return rows.length > 0 && rows[0].disabled === true;
  } catch (e) {
    console.error("[auth] disabled check failed, allowing:", e);
    return false;
  }
}
