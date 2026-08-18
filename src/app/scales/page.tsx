import { FileDown, Tag } from "lucide-react";
import { requireOperationsPage, getFactoryRestriction } from "@/lib/session";
import { listFactoryOptions, listScales, type Scale } from "@/lib/db";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import ScaleFactoryFilter from "@/components/ScaleFactoryFilter";
import ScalesTable from "@/components/ScalesTable";

export const dynamic = "force-dynamic";

/**
 * 重量計（スクラップ箱）マスター（管理者のみ）。
 * 工場・設備番号で一覧し、QRコードはラベル印刷（テプラ用CSVの書き出しも可）。
 * 日次記録では、このQRを読み取って投入先の箱を選択する。
 */
export default async function ScalesPage({
  searchParams,
}: {
  searchParams: Promise<{ factory?: string }>;
}) {
  const session = await requireOperationsPage();
  const sp = await searchParams;
  // 所属工場が設定されている人は自工場が自動で選ばれる（他工場は選べない）
  const restriction = await getFactoryRestriction(session);
  const factoryLocked = restriction.restricted;
  const factory = factoryLocked ? restriction.factory! : (sp.factory ?? "").trim();

  let scales: Scale[];
  let factoryOptions: string[];
  try {
    [scales, factoryOptions] = await Promise.all([
      listScales(session.companyId, { factory: factory || null }),
      listFactoryOptions(session.companyId),
    ]);
  } catch (e) {
    console.error("[scales]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="重量計マスター" />
        <DbErrorState />
      </div>
    );
  }

  const qs = factory ? `?factory=${encodeURIComponent(factory)}` : "";

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="重量計マスター"
        description="スクラップ箱（上銅 / 銅ダライ）の重量計を工場・設備番号で管理します。QRコードはラベル印刷、またはテプラ用CSVを書き出して差し込み印刷し、重量計に貼り付けます。"
        action={
          <>
            <a
              href={`/scales/labels${qs}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
            >
              <Tag className="h-4 w-4" />
              QRラベル一覧
            </a>
            <a
              href={`/api/export?type=scales${factory ? `&factory=${encodeURIComponent(factory)}` : ""}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
            >
              <FileDown className="h-4 w-4" />
              テプラ用CSV
            </a>
          </>
        }
      />
      <div className="mb-3">
        <ScaleFactoryFilter
          factory={factory}
          factoryOptions={factoryLocked ? [factory] : factoryOptions}
          factoryLocked={factoryLocked}
        />
      </div>
      <ScalesTable
        scales={scales}
        factory={factory}
        factoryOptions={factoryLocked ? [factory] : factoryOptions}
      />
    </div>
  );
}
