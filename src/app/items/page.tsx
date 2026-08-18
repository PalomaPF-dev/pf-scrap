import { FileDown, QrCode } from "lucide-react";
import { requireOperationsPage } from "@/lib/session";
import {
  listFactoryOptions,
  listItemWorkplaces,
  listItems,
  type ScrapItem,
} from "@/lib/db";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import SearchBox from "@/components/SearchBox";
import ItemFilters from "@/components/ItemFilters";
import ItemsTable from "@/components/ItemsTable";
import ItemImportButton from "@/components/ItemImportButton";

export const dynamic = "force-dynamic";

/** ② 品目マスター（管理者のみ。子図番での呼び出し・KEYはMcFrameの設定）。 */
export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; factory?: string; workplace?: string }>;
}) {
  const session = await requireOperationsPage();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const factory = (sp.factory ?? "").trim();
  const workplace = (sp.workplace ?? "").trim();

  let items: ScrapItem[];
  let total: number;
  let factoryOptions: string[];
  let workplaceOptions: { name: string; count: number }[];
  try {
    [{ items, total }, factoryOptions, workplaceOptions] = await Promise.all([
      listItems(session.companyId, {
        q,
        factory: factory || null,
        workplace: workplace || null,
        limit: 500,
      }),
      listFactoryOptions(session.companyId),
      // 製造場所の選択肢は、選んだ工場のぶんだけに絞る
      listItemWorkplaces(session.companyId, factory || null),
    ]);
  } catch (e) {
    console.error("[items]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="品目マスター" />
        <DbErrorState />
      </div>
    );
  }

  const qrHref = `/items/qr${factory ? `?factory=${encodeURIComponent(factory)}` : ""}`;
  // CSV出力は画面の絞り込みをそのまま引き継ぐ
  const exportQuery = new URLSearchParams({ type: "items" });
  if (q) exportQuery.set("q", q);
  if (factory) exportQuery.set("factory", factory);
  if (workplace) exportQuery.set("workplace", workplace);

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="品目マスター"
        description="KEY = 管理図番 + 製造場所CD（McFrameの設定）。工場・製造場所で絞り込み、子図番で検索して呼び出せます。"
        action={
          <>
            <a
              href={qrHref}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
            >
              <QrCode className="h-4 w-4" />
              品目QR一覧
            </a>
            <ItemImportButton />
            <a
              href={`/api/export?${exportQuery.toString()}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
            >
              <FileDown className="h-4 w-4" />
              CSV出力
            </a>
          </>
        }
      />
      <div className="mb-3">
        <ItemFilters
          factory={factory}
          factoryOptions={factoryOptions}
          workplace={workplace}
          workplaceOptions={workplaceOptions}
        />
      </div>
      <div className="mb-2">
        <SearchBox q={q} placeholder="子図番・親図番・管理図番・KEY・品名で検索" />
      </div>
      <p className="mb-4 text-xs text-[#909090]">
        {total.toLocaleString()} 件
        {factory || workplace || q ? "（絞り込み中）" : ""}
      </p>
      <ItemsTable items={items} truncated={items.length >= 500} factoryOptions={factoryOptions} />
    </div>
  );
}
