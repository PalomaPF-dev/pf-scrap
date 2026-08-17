import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/authOptions";
import { getCompanyEntitlement } from "@/lib/entitlement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/entitlement — 会社の利用権（契約 or 30日トライアル。社内運用は常に有効）を返す
export async function GET() {
  const session = await getServerSession(authOptions);
  const cid = session?.user?.companyId;
  if (!cid) return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  try {
    const ent = await getCompanyEntitlement(cid);
    return NextResponse.json({ ...ent, companyId: cid }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ message: (e as Error).message }, { status: 500 });
  }
}
