import { requireOperationsPage } from "@/lib/session";
import { listFactoryOptions, listItems, type ScrapItem } from "@/lib/db";
import { itemRef } from "@/lib/scrapTypes";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import ItemQrSheet from "@/components/ItemQrSheet";

export const dynamic = "force-dynamic";

/**
 * 品目QR一覧（工場 → 職場ごと）。印刷して現場に掲示し、
 * 初品重量測定ではこのQR（値=品目KEY）を読み取って品目を呼び出す。
 */
export default async function ItemsQrPage({
  searchParams,
}: {
  searchParams: Promise<{ factory?: string; workplace?: string }>;
}) {
  const session = await requireOperationsPage();
  const sp = await searchParams;

  let items: ScrapItem[];
  let factoryOptions: string[];
  let factory: string;
  try {
    factoryOptions = await listFactoryOptions(session.companyId);
    factory = (sp.factory ?? "").trim() || factoryOptions[0] || "";
    ({ items } = await listItems(session.companyId, {
      factory: factory || null,
      limit: 2000,
    }));
  } catch (e) {
    console.error("[items/qr]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="品目QR一覧" />
        <DbErrorState />
      </div>
    );
  }

  // 品目単位（品目CD×格納場所CD）に集約し、職場（製造場所名）ごとにグループ化
  const byRef = new Map<string, ScrapItem>();
  for (const it of items) {
    const ref = itemRef(it.kanriZuban, it.kakunoCD);
    if (!byRef.has(ref)) byRef.set(ref, it);
  }
  const groups = new Map<string, ScrapItem[]>();
  for (const it of byRef.values()) {
    const g = it.seizoBashoMei || it.factory || "（職場未設定）";
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g)!.push(it);
  }
  const grouped = [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0], "ja"))
    .map(([workplace, list]) => ({
      workplace,
      items: list.sort((a, b) => a.kanriZuban.localeCompare(b.kanriZuban)),
    }));

  const workplace = (sp.workplace ?? "").trim();
  const shown = workplace ? grouped.filter((g) => g.workplace === workplace) : grouped;

  return (
    <div className="p-4 sm:p-6">
      <div className="no-print">
        <PageHeader
          title="品目QR一覧"
          description="工場と職場（製造場所）を選んで印刷し、現場に掲示します。初品重量測定ではこのQRを読み取って品目を呼び出します（QRの値 = 品目KEY）。"
        />
      </div>
      <ItemQrSheet
        factory={factory}
        factoryOptions={factoryOptions}
        workplace={workplace}
        workplaces={grouped.map((g) => ({ name: g.workplace, count: g.items.length }))}
        groups={shown}
      />
    </div>
  );
}
