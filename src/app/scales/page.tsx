import { FileDown, Tag } from "lucide-react";
import { requireOperationsPage, getFactoryView } from "@/lib/session";
import { listFactoryOptions, listScales, listScrapKinds, type Scale, type ScrapKind } from "@/lib/db";
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
  // 所属工場が設定されている人は自工場（他工場は選べない）、上部で工場を選んだ人はその工場に固定
  const restriction = await getFactoryView(session);
  const factoryLocked = restriction.restricted;
  const factory = factoryLocked ? restriction.factory! : (sp.factory ?? "").trim();

  let scales: Scale[];
  let factoryOptions: string[];
  let kinds: ScrapKind[];
  try {
    [scales, factoryOptions, kinds] = await Promise.all([
      listScales(session.companyId, { factory: factory || null }),
      listFactoryOptions(session.companyId),
      // 種類は設定マスタから。使わないにした種類も渡す（色を設定・日次記録と同じ並び順で決めるため。
      // 選択肢に出すのは使用中のものだけ）
      listScrapKinds(session.companyId),
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
        description="スクラップ箱の重量計を工場・設備番号で管理します。種類は「設定」で追加できます。QRコードはラベル印刷、またはテプラ用CSVを書き出して差し込み印刷し、重量計に貼り付けます。"
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
        kinds={kinds}
      />
    </div>
  );
}
