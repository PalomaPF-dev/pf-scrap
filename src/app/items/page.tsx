import { FileDown } from "lucide-react";
import { requireAdminPage } from "@/lib/session";
import { listItems, type ScrapItem } from "@/lib/db";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import SearchBox from "@/components/SearchBox";
import ItemsTable from "@/components/ItemsTable";
import ItemImportButton from "@/components/ItemImportButton";

export const dynamic = "force-dynamic";

/** ② 品目マスター（管理者のみ。子図番での呼び出し・KEYはMcFrameの設定）。 */
export default async function ItemsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const session = await requireAdminPage();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();

  let items: ScrapItem[];
  try {
    ({ items } = await listItems(session.companyId, { q, limit: 500 }));
  } catch (e) {
    console.error("[items]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="品目マスター" />
        <DbErrorState />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="品目マスター"
        description="KEY = 管理図番 + 製造場所CD（McFrameの設定）。子図番で検索して呼び出せます。"
        action={
          <>
            <ItemImportButton />
            <a
              href="/api/export?type=items"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
            >
              <FileDown className="h-4 w-4" />
              CSV出力
            </a>
          </>
        }
      />
      <div className="mb-4">
        <SearchBox q={q} placeholder="子図番・親図番・管理図番・KEY・品名で検索" />
      </div>
      <ItemsTable items={items} truncated={items.length >= 500} />
    </div>
  );
}
