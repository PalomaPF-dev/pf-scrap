import { ClipboardList } from "lucide-react";
import { requireOperationsPage, getFactoryRestriction } from "@/lib/session";
import { listFactoryOptions, listScrapKinds, type ScrapKind } from "@/lib/db";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import DailyExcelImport from "@/components/DailyExcelImport";

export const dynamic = "force-dynamic";
// 取込は日数ぶんの明細をまとめて書き込むため、既定(10〜15秒)では足りないことがある
export const maxDuration = 60;

/**
 * Excelの日次記録票の取込（生産管理部・調達部のメンバーと管理者のみ）。
 * アプリ導入前・アプリで入力できていない期間の記録を、日付×工場の記録票として取り込む。
 */
export default async function DailyImportPage() {
  const session = await requireOperationsPage();

  let factoryOptions: string[];
  let factoryLocked: boolean;
  let factory: string;
  let kinds: ScrapKind[];
  try {
    const restriction = await getFactoryRestriction(session);
    const factories = await listFactoryOptions(session.companyId);
    factoryLocked = restriction.restricted;
    factoryOptions = restriction.restricted ? [restriction.factory!] : factories;
    factory = restriction.restricted ? restriction.factory! : (factoryOptions[0] ?? "大口");
    kinds = await listScrapKinds(session.companyId);
  } catch (e) {
    console.error("[daily/import]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="日次記録のExcel取込" />
        <DbErrorState />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="日次記録のExcel取込"
        description="現場でつけていたExcelの「スクラップ日次記録票」を、アプリの日次記録に取り込みます。1シート＝1日×1つの箱、同じ日のシートは1枚の記録票にまとまります。取り込む前に内容を画面で確認できます。"
        action={
          <a
            href="/daily"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
          >
            <ClipboardList className="h-4 w-4" />
            日次記録へ
          </a>
        }
      />

      <DailyExcelImport
        factory={factory}
        factoryOptions={factoryOptions}
        factoryLocked={factoryLocked}
        kinds={kinds}
      />
    </div>
  );
}
