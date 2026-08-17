import { NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { BOOTSTRAP_COMPANY_NAME, getOrCreateCompanyByName } from "@/lib/authDb";
import { syncPortalMasters, type PortalFactory, type PortalWorkplace } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * ポータルからの工場・職場マスタ配信を受ける（内部用・UIなし。PFシリーズ共通の契約）。
 * 認証はセッションではなく共有キー PF_PROVISION_KEY（未設定なら 503 で無効化）。
 *
 * POST /api/portal-masters
 * body: {
 *   key: string,
 *   factories:  [{ code, name, sort }],
 *   workplaces: [{ code, name, factoryCode, sort }]   // factoryCode = 親工場の code
 * }
 * → { ok: true, applied: { factories, workplaces, skipped } }
 *
 * このアプリでは日次記録・品目の「工場」の入力候補に使う（記録の値は文字列のまま）。
 */

/** タイミング安全なキー比較（長さ違いは即 false）。provision と同じ。 */
function safeKeyEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function cleanFactories(raw: unknown): PortalFactory[] {
  if (!Array.isArray(raw)) return [];
  const out: PortalFactory[] = [];
  for (const r of raw) {
    const code = String((r as { code?: unknown })?.code ?? "").trim();
    const name = String((r as { name?: unknown })?.name ?? "").trim();
    const sort = Number((r as { sort?: unknown })?.sort ?? 0) || 0;
    if (code && name) out.push({ code, name, sort });
  }
  return out;
}

function cleanWorkplaces(raw: unknown): PortalWorkplace[] {
  if (!Array.isArray(raw)) return [];
  const out: PortalWorkplace[] = [];
  for (const r of raw) {
    const code = String((r as { code?: unknown })?.code ?? "").trim();
    const name = String((r as { name?: unknown })?.name ?? "").trim();
    const factoryCode = String((r as { factoryCode?: unknown })?.factoryCode ?? "").trim();
    const sort = Number((r as { sort?: unknown })?.sort ?? 0) || 0;
    if (code && name && factoryCode) out.push({ code, name, factoryCode, sort });
  }
  return out;
}

export async function POST(req: Request) {
  const provisionKey = (process.env.PF_PROVISION_KEY || "").trim();
  if (!provisionKey) {
    return NextResponse.json({ message: "この機能は現在無効です（鍵未設定）" }, { status: 503 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ message: "不正なリクエストです" }, { status: 400 });
  }
  const key = typeof body.key === "string" ? body.key : "";
  if (!safeKeyEqual(key, provisionKey)) {
    return NextResponse.json({ message: "認証に失敗しました" }, { status: 401 });
  }

  try {
    const companyId = await getOrCreateCompanyByName(BOOTSTRAP_COMPANY_NAME);
    const applied = await syncPortalMasters(
      companyId,
      cleanFactories(body.factories),
      cleanWorkplaces(body.workplaces)
    );
    return NextResponse.json({ ok: true, applied });
  } catch (e) {
    console.error("[portal-masters]", e);
    return NextResponse.json({ message: "サーバーエラーが発生しました" }, { status: 500 });
  }
}
