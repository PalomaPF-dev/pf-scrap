import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { getSql } from "@/lib/neon";
import { ensurePasswordResetSchema, hashResetToken } from "@/lib/passwordReset";

export const runtime = "nodejs";

/**
 * パスワード再設定の実行。
 * トークン（メールのリンク）が未使用・期限内のときだけ、新しいパスワードに更新する。
 * ハッシュ方式は登録処理（authDb.createUser）と同じ bcryptjs・コスト12。
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const token = (body.token ?? "").toString().trim();
    const password = (body.password ?? "").toString();

    if (!/^[0-9a-f]{64}$/i.test(token)) {
      return NextResponse.json(
        { message: "リンクが正しくありません。メールのリンクをもう一度開き直してください。" },
        { status: 400 }
      );
    }
    if (password.length < 8) {
      return NextResponse.json(
        { message: "パスワードは8文字以上にしてください。" },
        { status: 400 }
      );
    }

    await ensurePasswordResetSchema();
    const sql = getSql();

    // 未使用・期限内のトークンをアトミックに消費（二重送信でも1回だけ成功）
    const consumed = await sql`
      UPDATE password_reset_tokens
      SET used_at = NOW()
      WHERE token_hash = ${hashResetToken(token)}
        AND used_at IS NULL
        AND expires_at > NOW()
      RETURNING user_id`;
    if (consumed.length === 0) {
      return NextResponse.json(
        {
          message:
            "このリンクは有効期限が切れているか、すでに使用されています。お手数ですが、もう一度最初からやり直してください。",
        },
        { status: 400 }
      );
    }

    const passwordHash = await bcrypt.hash(password, 12);
    // パスワード設定成功で pending も解除（招待完了）。通常のリセットでも false のままで無害。
    await sql`
      UPDATE users SET password_hash = ${passwordHash}, pending = false
      WHERE id = ${consumed[0].user_id as string}`;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[password-reset] confirm error:", err);
    return NextResponse.json(
      { message: "変更に失敗しました。時間をおいて再度お試しください。" },
      { status: 500 }
    );
  }
}
