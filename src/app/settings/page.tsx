import { requireOperationsPage } from "@/lib/session";
import { listScrapKinds, type ScrapKind } from "@/lib/db";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import ScrapKindsTable from "@/components/ScrapKindsTable";

export const dynamic = "force-dynamic";

/**
 * 設定。いまはスクラップ種類（上銅／銅ダライ／銅スクラップ…）の管理だけ。
 * 種類は重量計マスターの登録と、日次記録の投入先の選択肢になる。
 */
export default async function SettingsPage() {
  const session = await requireOperationsPage();

  let kinds: ScrapKind[];
  try {
    kinds = await listScrapKinds(session.companyId);
  } catch (e) {
    console.error("[settings]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="設定" />
        <DbErrorState />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="設定"
        description="スクラップの種類を管理します。ここで追加した種類は、重量計マスターの登録と日次記録の集計（種類別の合計）に使われます。"
      />
      <ScrapKindsTable kinds={kinds} />
    </div>
  );
}
