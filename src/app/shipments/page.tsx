import Link from "next/link";
import { FileDown } from "lucide-react";
import {
  requireEntitledSession,
  getFactoryView,
  getFactoryRestriction,
  canUseOperations,
} from "@/lib/session";
import {
  listFactoryOptions,
  listScrapKinds,
  listShipRoutes,
  listShipments,
  type Shipment,
} from "@/lib/db";
import { isYmStr, thisMonthStr, todayStr } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import MonthNav from "@/components/MonthNav";
import ScaleFactoryFilter from "@/components/ScaleFactoryFilter";
import ShipmentPanel from "@/components/ShipmentPanel";

export const dynamic = "force-dynamic";

/**
 * ポリ箱（工場間）。
 *
 * 本社工場・第二工場などはスクラップを種類ごとにポリ箱へ入れ、量ってから大口工場へ送る。
 * 大口工場は日次記録でそのポリ箱を選んで自工場のスクラップ箱へ投入する（投入前に量る）。
 * この画面は、送る側の「出荷の登録」と、両方で量った重量の突き合わせ・処理漏れの確認を受け持つ。
 */
export default async function ShipmentsPage({
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
  let routes: { fromFactory: string; toFactory: string }[];
  let kinds: string[];
  let shipments: Shipment[];
  let canOperate = false;
  let myFactory: string | null = null;
  try {
    // 所属工場の人は、自工場が送ったポリ箱だけ直せる（サーバー側でも同じ判定）
    myFactory = (await getFactoryRestriction(session)).factory;
    const view = await getFactoryView(session);
    factoryLocked = view.restricted;
    factoryOptions = view.restricted ? [view.factory!] : await listFactoryOptions(session.companyId);
    factory = view.restricted ? view.factory! : (sp.factory ?? "").trim();
    [routes, kinds, shipments, canOperate] = await Promise.all([
      listShipRoutes(session.companyId),
      listScrapKinds(session.companyId).then((ks) => ks.filter((k) => k.active).map((k) => k.name)),
      listShipments(session.companyId, { factory: factory || null, ym }),
      canUseOperations(session),
    ]);
  } catch (e) {
    console.error("[shipments]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="ポリ箱（工場間）" />
        <DbErrorState />
      </div>
    );
  }

  // 選んでいる工場が送る側なら出荷を登録できる
  const shipTo = factory ? (routes.find((r) => r.fromFactory === factory)?.toFactory ?? null) : null;
  const receivesFrom = factory ? routes.filter((r) => r.toFactory === factory).map((r) => r.fromFactory) : [];
  const csv = `/api/export?type=shipments&ym=${ym}${factory ? `&factory=${encodeURIComponent(factory)}` : ""}`;

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="ポリ箱（工場間）"
        description="他工場へ送るスクラップをポリ箱ごとに量って出荷し、受け入れた工場で量った重量と突き合わせます"
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 sm:mb-4 sm:gap-3">
        <MonthNav ym={ym} />
        <ScaleFactoryFilter factory={factory} factoryOptions={factoryOptions} factoryLocked={factoryLocked} />
        <a
          href={csv}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
        >
          <FileDown className="h-4 w-4" />
          ポリ箱の一覧CSV
        </a>
      </div>

      {routes.length === 0 && (
        <p className="mb-4 rounded-xl bg-[#fff3e0] px-4 py-3 text-sm text-[#a15c00]">
          工場間でスクラップを送る設定がまだありません。
          {canOperate ? (
            <>
              {" "}
              <Link href="/settings" className="font-semibold underline">
                設定
              </Link>
              の「工場間のスクラップ送付」で、送る工場と送り先を決めてください。
            </>
          ) : (
            " 生産管理部・調達部に、送る工場と送り先の設定を依頼してください。"
          )}
        </p>
      )}

      <ShipmentPanel
        key={`${factory}|${ym}`}
        factory={factory}
        shipTo={shipTo}
        receivesFrom={receivesFrom}
        kinds={kinds}
        shipments={shipments}
        ym={ym}
        today={todayStr()}
        isAdmin={session.role === "admin"}
        myFactory={myFactory}
      />
    </div>
  );
}
