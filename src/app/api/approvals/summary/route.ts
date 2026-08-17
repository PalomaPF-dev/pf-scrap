import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { getSql } from "@/lib/neon";
import { ensureAuthSchema } from "@/lib/authDb";
import { countPendingDaily } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ポータルのアプリ横断「承認待ち」集計API（PFシリーズ共通の契約）。
 * POST { key, loginId } → { pending }
 * 「その人がいま承認の番」の件数だけを返す:
 *   このアプリでは、管理者に対して申請中（pending）の日次記録の件数。
 *   所属工場が設定された管理者は自工場分のみ。一般ユーザーは 0。
 */

function safeKeyEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

export async function POST(req: Request) {
  const provisionKey = (process.env.PF_PROVISION_KEY || "").trim();
  if (!provisionKey) {
    return NextResponse.json({ message: "未設定" }, { status: 503 });
  }
  const body = await req.json().catch(() => ({}));
  const key = typeof body.key === "string" ? body.key : "";
  if (!safeKeyEqual(key, provisionKey)) {
    return NextResponse.json({ message: "認証に失敗しました" }, { status: 401 });
  }
  const loginId = (body.loginId ?? "").toString().trim();
  if (!loginId) return NextResponse.json({ pending: 0 });

  try {
    await ensureAuthSchema();
    const sql = getSql();
    const rows = await sql`
      SELECT company_id, role, factory, disabled FROM users WHERE login_id = ${loginId} LIMIT 1`;
    const u = rows[0];
    if (!u || u.disabled === true || (u.role ?? "member") !== "admin") {
      return NextResponse.json({ pending: 0 });
    }
    const pending = await countPendingDaily(u.company_id as string, (u.factory ?? null) as string | null);
    return NextResponse.json({ pending }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[approvals/summary]", e);
    return NextResponse.json({ pending: 0 });
  }
}
