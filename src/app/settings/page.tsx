import { requireOperationsPage } from "@/lib/session";
import {
  listBagStarts,
  listFactoryMasters,
  listFactoryOptions,
  listScrapKinds,
  listShipRoutes,
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
import ShipRouteTable from "@/components/ShipRouteTable";

export const dynamic = "force-dynamic";

/**
 * 設定。
 * - 工場・職場 … このアプリで使う工場・職場（ポータル配信分の使う/使わない、手動の追加・削除）
 * - スクラップ種類（上銅／銅ダライ／銅スクラップ…）… 重量計マスターの登録と日次記録の選択肢
 * - 工場間のスクラップ送付 … ポリ箱で他工場へ送る工場と送り先
 * - 袋単位の管理を始めた日（工場ごと）… この日を境に、袋単位と日単位を分けて扱う
 */
export default async function SettingsPage() {
  const session = await requireOperationsPage();

  let kinds: ScrapKind[];
  let bagStarts: BagStart[];
  let factories: FactoryMaster[];
  let suggestions: Record<string, { name: string; count: number }[]>;
  let factoryNames: string[];
  let routes: { fromFactory: string; toFactory: string }[];
  try {
    kinds = await listScrapKinds(session.companyId);
    factories = await listFactoryMasters(session.companyId);
    suggestions = await listWorkplaceSuggestions(session.companyId);
    factoryNames = await listFactoryOptions(session.companyId);
    bagStarts = await listBagStarts(session.companyId, factoryNames);
    routes = await listShipRoutes(session.companyId);
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
      <ShipRouteTable factories={factoryNames} routes={routes} />
      <ScrapKindsTable kinds={kinds} />
      <BagStartTable starts={bagStarts} />
    </div>
  );
}
