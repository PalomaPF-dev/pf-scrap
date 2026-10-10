import { NextResponse } from "next/server";
import { getFactoryView, getOptionalSession } from "@/lib/session";
import { listFactoryOptions } from "@/lib/db";

/**
 * ログイン中の人が見られる工場と、いま選んでいる工場。
 * 画面の最初に「工場を選ぶ」ために使う（components/FactoryScope.tsx）。
 *   { all, home, factory, factories }
 * all=false（所属工場の人）は factories が所属工場1つだけになり、選び直せない。
 * 工場の一覧は各画面の工場フィルタと同じ listFactoryOptions（ポータル配信の工場＋実データの工場）。
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getOptionalSession();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const view = await getFactoryView({
    companyId: user.companyId,
    userId: user.id,
    isDemo: Boolean(user.isDemo),
  });

  let factories: string[] = [];
  if (view.all) {
    try {
      factories = await listFactoryOptions(user.companyId);
    } catch (e) {
      console.error("[scope] factories", e);
    }
  } else if (view.home) {
    factories = [view.home];
  }

  return NextResponse.json(
    {
      all: view.all,
      home: view.home,
      factory: view.factory,
      factories,
    },
    { headers: { "Cache-Control": "private, no-store" } }
  );
}
