import { requireAdminPage } from "@/lib/session";
import { listItems, type ScrapItem } from "@/lib/db";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import ItemQrSheet from "@/components/ItemQrSheet";

export const dynamic = "force-dynamic";

/**
 * 品目QR一覧（職場＝製造場所ごと）。印刷して現場に掲示し、
 * 初品重量測定ではこのQR（値=品目KEY）を読み取って品目を呼び出す。
 */
export default async function ItemsQrPage() {
  const session = await requireAdminPage();

  let items: ScrapItem[];
  try {
    ({ items } = await listItems(session.companyId, { limit: 2000 }));
  } catch (e) {
    console.error("[items/qr]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="品目QR一覧" />
        <DbErrorState />
      </div>
    );
  }

  // KEY単位（完成品単位）に集約し、職場（製造場所名）ごとにグループ化
  const byKey = new Map<string, ScrapItem>();
  for (const it of items) {
    if (!byKey.has(it.key)) byKey.set(it.key, it);
  }
  const groups = new Map<string, ScrapItem[]>();
  for (const it of byKey.values()) {
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

  return (
    <div className="p-4 sm:p-6">
      <div className="no-print">
        <PageHeader
          title="品目QR一覧"
          description="職場（製造場所）ごとの品目QRコード一覧です。印刷して現場に掲示し、初品重量測定でQRを読み取って品目を呼び出します（QRの値 = 品目KEY）。"
        />
      </div>
      <ItemQrSheet groups={grouped} />
    </div>
  );
}
