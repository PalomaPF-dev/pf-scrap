import { requireAdminPage } from "@/lib/session";
import { listScales, type Scale } from "@/lib/db";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import ScaleLabelSheet from "@/components/ScaleLabelSheet";

export const dynamic = "force-dynamic";

/** 重量計のQRラベル一覧（印刷用）。工場で絞り込める。 */
export default async function ScaleLabelsPage({
  searchParams,
}: {
  searchParams: Promise<{ factory?: string }>;
}) {
  const session = await requireAdminPage();
  const sp = await searchParams;
  const factory = (sp.factory ?? "").trim();

  let scales: Scale[];
  try {
    scales = await listScales(session.companyId, { factory: factory || null });
  } catch (e) {
    console.error("[scales/labels]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="QRラベル一覧" />
        <DbErrorState />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="no-print">
        <PageHeader
          title={`QRラベル一覧${factory ? `（${factory}）` : ""}`}
          description="重量計に貼るQRラベルです。工場・設備番号つきで印刷できます。テプラで刷る場合は、重量計マスターの「テプラ用CSV」を差し込み印刷にお使いください。"
          action={
            <a
              href="/scales"
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
            >
              重量計マスターへ戻る
            </a>
          }
        />
      </div>
      <ScaleLabelSheet scales={scales} />
    </div>
  );
}
