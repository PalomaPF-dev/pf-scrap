import { NextResponse } from "next/server";

/**
 * 認証済みページ（会社スコープのデータを描画）向けのセキュリティ強化。
 * - Cache-Control: 共有キャッシュ/CDN への滞留を防ぐ（force-dynamic で元々非キャッシュだが明示）。
 * - クリックジャッキング/MIMEスニッフィング/リファラ漏洩への基本的な防御ヘッダ。
 */
export function middleware() {
  const res = NextResponse.next();
  res.headers.set("Cache-Control", "private, no-store");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  return res;
}

export const config = {
  matcher: ["/", "/daily", "/first", "/items", "/scales", "/mcframe", "/procurement"],
};
