import { requireAdminPage } from "@/lib/session";
import { listScales, type Scale } from "@/lib/db";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import ScalesTable from "@/components/ScalesTable";

export const dynamic = "force-dynamic";

/**
 * 重量計（スクラップ箱）マスター（管理者のみ）。
 * 箱は 上銅 / 銅ダライ の2種類。QRコードを印刷して重量計に貼り、
 * 日次記録では読み取りで投入先を選択する。
 */
export default async function ScalesPage() {
  const session = await requireAdminPage();

  let scales: Scale[];
  try {
    scales = await listScales(session.companyId);
  } catch (e) {
    console.error("[scales]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="重量計マスター" />
        <DbErrorState />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="重量計マスター"
        description="スクラップ箱（上銅 / 銅ダライ）の重量計を登録し、QRコードを印刷して重量計に貼り付けます。日次記録はこのQRを読み取って投入先を選択します。"
      />
      <ScalesTable scales={scales} />
    </div>
  );
}
