import { FileDown } from "lucide-react";
import { requireEntitledSession, getFactoryRestriction } from "@/lib/session";
import { listBagsByMonth, listFactoryOptions, type ScrapBag } from "@/lib/db";
import { isYmStr, thisMonthStr } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import MonthNav from "@/components/MonthNav";
import ScaleFactoryFilter from "@/components/ScaleFactoryFilter";
import BagLedger from "@/components/BagLedger";

export const dynamic = "force-dynamic";

/**
 * 袋の記録（月単位の台帳）。
 *
 * 袋は「開いてから交換するまで」が1区切りで、日をまたぐこともあるため、
 * 日次記録の画面だけでは月の全体が見えない。ここでは締めた月（締める前は開いた月）で
 * 袋を並べ、締めの重量・記録した投入の合計・その差を突き合わせる。
 * 紙の記入用紙、Excelの「1袋＝1枚」に対応する。
 */
export default async function BagsPage({
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
  let bags: ScrapBag[];
  try {
    const restriction = await getFactoryRestriction(session);
    // 所属工場ユーザーは自工場に固定（URLで他工場を指定されてもサーバー側で無視）
    factoryLocked = restriction.restricted;
    factoryOptions = restriction.restricted ? [restriction.factory!] : await listFactoryOptions(session.companyId);
    factory = restriction.restricted ? restriction.factory! : (sp.factory ?? "").trim();
    bags = await listBagsByMonth(session.companyId, ym, factory || null);
  } catch (e) {
    console.error("[bags]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="袋の記録" />
        <DbErrorState />
      </div>
    );
  }

  const csv = `/api/export?type=bags&ym=${ym}${factory ? `&factory=${encodeURIComponent(factory)}` : ""}`;
  const csvEntries = `/api/export?type=bag-entries&ym=${ym}${factory ? `&factory=${encodeURIComponent(factory)}` : ""}`;
  const csvBtn =
    "inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]";

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="袋の記録"
        description="袋を交換するたびに締めた記録の一覧です。締めた月（締める前は開いた月）で並びます"
      />

      <div className="mb-3 flex flex-wrap items-center gap-2 sm:mb-4 sm:gap-3">
        <MonthNav ym={ym} />
        <ScaleFactoryFilter
          factory={factory}
          factoryOptions={factoryOptions}
          factoryLocked={factoryLocked}
        />
        <div className="flex flex-wrap gap-2">
          <a href={csv} className={csvBtn}>
            <FileDown className="h-4 w-4" />
            袋の一覧CSV
          </a>
          <a href={csvEntries} className={csvBtn}>
            <FileDown className="h-4 w-4" />
            袋別の明細CSV
          </a>
        </div>
      </div>

      {bags.length === 0 ? (
        <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 text-sm text-[#707070] sm:p-5">
          {ym} に締めた袋がありません。袋を交換すると、この一覧に「この袋は◯◯kgでした」が残ります。
          袋単位の管理を始める前の期間は、日次記録・月間集計で日単位のまま確認できます。
        </section>
      ) : (
        <BagLedger bags={bags} isAdmin={session.role === "admin"} />
      )}
    </div>
  );
}
