import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import {
  BOOTSTRAP_COMPANY_NAME,
  createInvitedUser,
  ensureAuthSchema,
  getOrCreateCompanyByName,
} from "@/lib/authDb";
import { getSql } from "@/lib/neon";
import {
  ensurePasswordResetSchema,
  generateResetToken,
  hashResetToken,
  resetLinkBase,
} from "@/lib/passwordReset";

export const runtime = "nodejs";

/**
 * ポータルからの一括アカウント発行API（内部用・UIなし。PFシリーズ共通の契約）。
 * 認証はセッションではなく共有キー PF_PROVISION_KEY（未設定なら 503 で無効化）。
 * 複数ユーザーをまとめて発行してパスワード設定リンクを返す。
 * ポータルで退職・削除された人は disabled:true で届き、アカウントを失効させる。
 */

// 設定リンクの有効期限は7日
const INVITE_TOKEN_TTL_MINUTES = 7 * 24 * 60;
// 1リクエストで発行できる上限件数
const MAX_USERS_PER_REQUEST = 200;

const isEmail = (s: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
// 社員番号は半角英数字とハイフン・アンダースコアのみ（1〜64文字）
const isLoginId = (s: string) => /^[A-Za-z0-9_-]{1,64}$/.test(s);

/** タイミング安全なキー比較（長さ違いは即 false 扱い）。 */
function safeKeyEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

type ProvisionResult = {
  loginId: string;
  status: "created" | "exists" | "error";
  passwordSet?: boolean;
  inviteUrl?: string;
  message?: string;
};

export async function POST(req: Request) {
  const provisionKey = process.env.PF_PROVISION_KEY;
  if (!provisionKey) {
    return NextResponse.json({ message: "provision未設定" }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const key = typeof body.key === "string" ? body.key : "";
  if (!safeKeyEqual(key, provisionKey)) {
    return NextResponse.json({ message: "認証に失敗しました。" }, { status: 401 });
  }

  const users = body.users;
  if (!Array.isArray(users) || users.length === 0) {
    return NextResponse.json({ message: "users を指定してください。" }, { status: 400 });
  }
  if (users.length > MAX_USERS_PER_REQUEST) {
    return NextResponse.json(
      { message: `一度に発行できるのは最大${MAX_USERS_PER_REQUEST}件です。` },
      { status: 400 }
    );
  }
  const regenerateLinks = body.regenerateLinks === true;

  try {
    await ensureAuthSchema();
    await ensurePasswordResetSchema();
    const companyId = await getOrCreateCompanyByName(BOOTSTRAP_COMPANY_NAME);
    const sql = getSql();

    const results: ProvisionResult[] = [];
    for (const u of users) {
      const loginId = (u?.loginId ?? "").toString().trim();
      try {
        if (!isLoginId(loginId)) {
          results.push({
            loginId,
            status: "error",
            message: "社員番号は半角英数字とハイフン・アンダースコア（1〜64文字）で入力してください。",
          });
          continue;
        }
        if (loginId === "admin") {
          results.push({
            loginId,
            status: "error",
            message: "社員番号 'admin' は発行できません。",
          });
          continue;
        }
        // 失効（退職・名簿からの削除）。ポータルが disabled:true を送ってきたら
        // アカウントを止めるだけで、作成もリンク再発行もしない。
        // このアプリにアカウントが無い人は何もせず成功として返す（ポータルは削除後に
        // 「その人がどのアプリを使えたか」を引けないので、全アプリへ一斉に送ってくる）。
        if (u?.disabled === true) {
          const done = await sql`
            UPDATE users SET disabled = true WHERE login_id = ${loginId} RETURNING pending`;
          results.push(
            done.length > 0
              ? { loginId, status: "exists", passwordSet: !done[0].pending }
              : { loginId, status: "exists" }
          );
          continue;
        }
        // 在籍者の連携では毎回 false に戻す（退職後に復帰した人がそのまま使えるように）
        await sql`UPDATE users SET disabled = false WHERE login_id = ${loginId}`;
        const name = (u?.name ?? "").toString().trim();
        const email = ((u?.email ?? "").toString().trim().toLowerCase() as string) || null;
        // 役割は 管理者(admin) / 一般(member) の2種（旧「作業者(worker)」は一般に丸める）
        const role: "admin" | "member" = u?.role === "admin" ? "admin" : "member";
        // 指定承認者（任意）。このアプリでは承認フローに使わないが連携値は保持する。
        const approverLoginId: string | null =
          (u?.approverLoginId ?? "").toString().trim() || null;
        // 所属工場（任意）。キーが指定された場合のみ扱う（空文字は NULL=全工場 に戻す）
        const factoryProvided = u != null && typeof u === "object" && "factory" in u;
        const factory: string | null = factoryProvided
          ? (u.factory ?? "").toString().trim() || null
          : null;
        // ポータルの所属（表示用）。部署名（工場所属なら工場名）と職場名。
        // サイドバーの「所属／氏名」に出すだけで、権限・絞り込みには使わない。
        // factory と同じく、キー自体が無いときは既存値を変えない。
        const hasDepartment = u != null && Object.prototype.hasOwnProperty.call(u, "department");
        const portalDepartment: string | null = hasDepartment
          ? (u.department ?? "").toString().trim() || null
          : null;
        const hasWorkplace = u != null && Object.prototype.hasOwnProperty.call(u, "workplace");
        const portalWorkplace: string | null = hasWorkplace
          ? (u.workplace ?? "").toString().trim() || null
          : null;
        if (email && (!isEmail(email) || email.length > 254)) {
          results.push({
            loginId,
            status: "error",
            message: "メールアドレスの形式が正しくありません。",
          });
          continue;
        }
        if (approverLoginId && !isLoginId(approverLoginId)) {
          results.push({
            loginId,
            status: "error",
            message:
              "承認者の社員番号は半角英数字とハイフン・アンダースコア（1〜64文字）で入力してください。",
          });
          continue;
        }

        // 既存ユーザー（login_id 一致）: ポータル側の編集（氏名・役割・指定承認者・メール・所属工場）を反映。
        // 設定リンクは regenerateLinks のときだけ再発行
        const existing = await sql`SELECT id, pending FROM users WHERE login_id = ${loginId} LIMIT 1`;
        if (existing.length > 0) {
          const userId = existing[0].id as string;
          await sql`
            UPDATE users SET
              name = COALESCE(NULLIF(${name}, ''), name),
              role = ${role},
              approver_login_id = ${approverLoginId},
              email = COALESCE(${email}, email)
            WHERE id = ${userId}`;
          if (factoryProvided) {
            await sql`UPDATE users SET factory = ${factory} WHERE id = ${userId}`;
          }
          if (hasDepartment) {
            await sql`UPDATE users SET portal_department = ${portalDepartment} WHERE id = ${userId}`;
          }
          if (hasWorkplace) {
            await sql`UPDATE users SET portal_workplace = ${portalWorkplace} WHERE id = ${userId}`;
          }
          if (!regenerateLinks) {
            results.push({ loginId, status: "exists", passwordSet: !existing[0].pending });
            continue;
          }
          const token = generateResetToken();
          await sql`
            INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
            VALUES (${userId}, ${hashResetToken(token)},
                    NOW() + make_interval(mins => ${INVITE_TOKEN_TTL_MINUTES}))`;
          results.push({
            loginId,
            status: "exists",
            passwordSet: !existing[0].pending,
            inviteUrl: `${resetLinkBase()}/password-reset/confirm?token=${token}`,
          });
          continue;
        }

        if (!name) {
          results.push({ loginId, status: "error", message: "お名前を入力してください。" });
          continue;
        }

        // 新規発行: 招待ユーザー作成（所属工場・指定承認者つき） → 設定リンク発行
        const userId = await createInvitedUser(
          companyId,
          loginId,
          name,
          role,
          email,
          factory,
          approverLoginId
        );
        if (hasDepartment) {
          await sql`UPDATE users SET portal_department = ${portalDepartment} WHERE id = ${userId}`;
        }
        if (hasWorkplace) {
          await sql`UPDATE users SET portal_workplace = ${portalWorkplace} WHERE id = ${userId}`;
        }
        const token = generateResetToken();
        await sql`
          INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
          VALUES (${userId}, ${hashResetToken(token)},
                  NOW() + make_interval(mins => ${INVITE_TOKEN_TTL_MINUTES}))`;
        const inviteUrl = `${resetLinkBase()}/password-reset/confirm?token=${token}`;
        results.push({ loginId, status: "created", passwordSet: false, inviteUrl });
      } catch (e) {
        // email 一意制約違反などもここに落として続行
        results.push({ loginId, status: "error", message: (e as Error).message });
      }
    }

    return NextResponse.json({ results });
  } catch (err) {
    console.error("[provision] error:", err);
    return NextResponse.json({ message: "一括発行に失敗しました。" }, { status: 500 });
  }
}
