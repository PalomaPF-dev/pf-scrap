import { requireOperationsPage } from "@/lib/session";
import { listBagStarts, listFactoryOptions, listScrapKinds, type BagStart, type ScrapKind } from "@/lib/db";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import ScrapKindsTable from "@/components/ScrapKindsTable";
import BagStartTable from "@/components/BagStartTable";

export const dynamic = "force-dynamic";

/**
 * 設定。
 * - スクラップ種類（上銅／銅ダライ／銅スクラップ…）… 重量計マスターの登録と日次記録の選択肢
 * - 袋単位の管理を始めた日（工場ごと）… この日を境に、袋単位と日単位を分けて扱う
 */
export default async function SettingsPage() {
  const session = await requireOperationsPage();

  let kinds: ScrapKind[];
  let bagStarts: BagStart[];
  try {
    kinds = await listScrapKinds(session.companyId);
    bagStarts = await listBagStarts(
      session.companyId,
      await listFactoryOptions(session.companyId)
    );
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
        description="スクラップの種類と、袋単位の管理を始めた日を設定します"
      />
      <ScrapKindsTable kinds={kinds} />
      <BagStartTable starts={bagStarts} />
    </div>
  );
}
