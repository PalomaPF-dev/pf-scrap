import { requireEntitledSession } from "@/lib/session";
import { listFirstArticles, listItems, type FirstArticle, type ScrapItem } from "@/lib/db";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import SearchBox from "@/components/SearchBox";
import FirstArticlePanel from "@/components/FirstArticlePanel";

export const dynamic = "force-dynamic";

/** ③ 初品の単品完成品重量の測定（品目を選び完成品重量を登録）。 */
export default async function FirstPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireEntitledSession();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();

  let items: ScrapItem[];
  let history: FirstArticle[];
  try {
    [{ items }, history] = await Promise.all([
      listItems(session.companyId, { q, limit: 300 }),
      listFirstArticles(session.companyId, 200),
    ]);
  } catch (e) {
    console.error("[first]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="初品重量測定" />
        <DbErrorState />
      </div>
    );
  }

  // 候補は KEY 単位（完成品単位）で1行にまとめる
  const byKey = new Map<string, ScrapItem>();
  for (const it of items) {
    if (!byKey.has(it.key)) byKey.set(it.key, it);
  }
  const candidates = [...byKey.values()].slice(0, 30);

  // KEYごとの最新実測（候補一覧の「最新実測」表示用）
  const latest = new Map<string, { date: string; weight: number }>();
  for (const h of history) {
    const cur = latest.get(h.itemKey);
    if (!cur || h.measuredOn > cur.date) {
      latest.set(h.itemKey, { date: h.measuredOn, weight: h.weight });
    }
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="初品重量測定"
        description="毎日生産した初品の単品完成品重量を登録します。完成重量の計算には対象月末以前の最新測定値を使用します（未測定の品目はマスターの理論値）。"
      />
      <div className="mb-4">
        <SearchBox q={q} placeholder="子図番・図番・品名で品目を検索" />
      </div>
      <FirstArticlePanel
        candidates={candidates}
        latest={Object.fromEntries(latest)}
        history={history}
        userName={session.userName}
      />
    </div>
  );
}
