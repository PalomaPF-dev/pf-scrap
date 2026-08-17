import { NextResponse } from "next/server";
import { getSql, hasDatabase } from "@/lib/neon";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/health — 死活監視用。DB 接続まで確認する。
export async function GET() {
  if (!hasDatabase()) {
    return NextResponse.json({ ok: false, db: "unconfigured" }, { status: 503 });
  }
  try {
    const sql = getSql();
    await sql`SELECT 1`;
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[health]", e);
    return NextResponse.json({ ok: false, db: "error" }, { status: 503 });
  }
}
