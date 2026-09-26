import { requireOperationsPage } from "@/lib/session";
import {
  listBagStarts,
  listFactoryMasters,
  listFactoryOptions,
  listScrapKinds,
  listWorkplaceSuggestions,
  type BagStart,
  type FactoryMaster,
  type ScrapKind,
} from "@/lib/db";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import ScrapKindsTable from "@/components/ScrapKindsTable";
import BagStartTable from "@/components/BagStartTable";
import FactoryMasterTable from "@/components/FactoryMasterTable";

export const dynamic = "force-dynamic";

/**
 * 設定。
 * - 工場・職場 … このアプリで使う工場・職場（ポータル配信分の使う/使わない、手動の追加・削除）
 * - スクラップ種類（上銅／銅ダライ／銅スクラップ…）… 重量計マスターの登録と日次記録の選択肢
 * - 袋単位の管理を始めた日（工場ごと）… この日を境に、袋単位と日単位を分けて扱う
 */
export default async function SettingsPage() {
  const session = await requireOperationsPage();

  let kinds: ScrapKind[];
  let bagStarts: BagStart[];
  let factories: FactoryMaster[];
  let suggestions: Record<string, { name: string; count: number }[]>;
  try {
    kinds = await listScrapKinds(session.companyId);
    factories = await listFactoryMasters(session.companyId);
    suggestions = await listWorkplaceSuggestions(session.companyId);
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
        description="このアプリで使う工場・職場、スクラップの種類、袋単位の管理を始めた日を設定します"
      />
      <FactoryMasterTable factories={factories} suggestions={suggestions} />
      <ScrapKindsTable kinds={kinds} />
      <BagStartTable starts={bagStarts} />
    </div>
  );
}
