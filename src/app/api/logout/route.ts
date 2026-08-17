import { NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ポータルからの一括ログアウトAPI（front-channel logout）。
 *
 * セッションはアプリごとの Cookie（別ドメイン）で持つため、ポータルでログアウトしても
 * 各アプリのセッションは残ってしまう。そこでポータルのログアウト時に、非表示 iframe で
 * 各アプリのこのエンドポイントを呼び、アプリ側の Cookie をアプリ自身に破棄させる。
 *
 * トークンは SSO と同じ形式（PF_PROVISION_KEY による HMAC-SHA256・短命）。
 * 署名を必須にしているのは、任意のサイトから <img> 等で勝手にログアウトさせられないようにするため。
 */

// このアプリのキー（ポータル側の app 指定と一致する必要がある）
const APP_KEY = "scrap";

/** タイミング安全な比較（長さ違いは即 false）。 */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** トークンを検証する（SSO と同じ署名方式。app 一致と有効期限を確認）。 */
function verifyToken(token: string, key: string): boolean {
  const dot = token.lastIndexOf(".");
  if (dot <= 0 || dot === token.length - 1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = createHmac("sha256", key).update(payload).digest("hex");
  if (!safeEqual(sig, expected)) return false;
  let data: unknown;
  try {
    data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return false;
  }
  if (typeof data !== "object" || data === null) return false;
  const { app, exp } = data as { app?: unknown; exp?: unknown };
  if (app !== APP_KEY) return false;
  return typeof exp === "number" && exp > Date.now();
}

/**
 * リクエストが持っているセッションCookieをすべて破棄する。
 * 名前を決め打ちせず `*.session-token`（__Secure- 付きも含む）をまとめて消す。
 */
function clearSessionCookies(req: Request, res: NextResponse): number {
  const header = req.headers.get("cookie") ?? "";
  const names = header
    .split(";")
    .map((c) => c.split("=")[0]?.trim() ?? "")
    .filter((n) => n.endsWith("session-token"));
  const secure = (process.env.NEXTAUTH_URL ?? "").startsWith("https://") || process.env.VERCEL === "1";
  for (const name of new Set(names)) {
    // maxAge:0 で即時失効。属性は発行時と揃える（揃わないと消えない）
    res.cookies.set(name, "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: secure || name.startsWith("__Secure-"),
      maxAge: 0,
    });
  }
  return new Set(names).size;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const key = process.env.PF_PROVISION_KEY;
  const token = url.searchParams.get("token");
  if (!key || !token || !verifyToken(token, key)) {
    // 失敗しても理由は返さない（ポータル側は結果を見ずに次へ進む）
    return new NextResponse(null, { status: 204 });
  }
  const res = new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  clearSessionCookies(req, res);
  return res;
}
