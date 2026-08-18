import { requireEntitledSession, getFactoryRestriction } from "@/lib/session";
import {
  getMonthlyInput,
  listAdjustments,
  listFactoryOptions,
  listProcureDays,
  type InventoryAdjustment,
  type MonthlyInput,
  type ProcureDay,
} from "@/lib/db";
import { isYmStr, thisMonthStr } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import ProcurePanel from "@/components/ProcurePanel";

export const dynamic = "force-dynamic";

/**
 * ⑤ 調達入力（日次）。調達担当者が毎日、入荷（購入実績）とスクラップ売却数を入力する。
 * 在庫は前日からの理論在庫（自動計算）。棚卸等の補正は理由付きで記録する。
 */
export default async function ProcurementPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string; factory?: string }>;
}) {
  const session = await requireEntitledSession();
  const sp = await searchParams;
  const ym = isYmStr(sp.ym) ? sp.ym : thisMonthStr();

  let factoryOptions: string[];
  let factoryLocked: boolean;
  let factory: string;
  let days: ProcureDay[];
  let adjustments: InventoryAdjustment[];
  let anchor: MonthlyInput | null;
  try {
    const restriction = await getFactoryRestriction(session);
    const factories = await listFactoryOptions(session.companyId);
    factoryLocked = restriction.restricted;
    factoryOptions = restriction.restricted ? [restriction.factory!] : factories;
    factory = restriction.restricted
      ? restriction.factory!
      : (sp.factory ?? "").trim() || factoryOptions[0] || "大口工場";
    [days, adjustments, anchor] = await Promise.all([
      listProcureDays(session.companyId, ym, factory),
      listAdjustments(session.companyId, ym, factory),
      getMonthlyInput(session.companyId, ym, factory),
    ]);
  } catch (e) {
    console.error("[procurement]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="調達入力" />
        <DbErrorState />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="調達入力"
        description="入荷（購入実績）とスクラップ売却数を毎日入力します。在庫は前日の理論在庫から自動計算され、棚卸等のズレは理由付きの在庫補正で記録します。"
      />
      {/* 対象月・工場が変わったら入力状態を作り直す（前月の入力値が残らないようにする） */}
      <ProcurePanel
        key={`${ym}|${factory}`}
        ym={ym}
        factory={factory}
        factoryOptions={factoryOptions}
        factoryLocked={factoryLocked}
        days={days}
        adjustments={adjustments}
        anchor={anchor}
        isAdmin={session.role === "admin"}
        userName={session.userName}
      />
    </div>
  );
}
