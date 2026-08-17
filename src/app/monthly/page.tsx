import { requireAdminPage } from "@/lib/session";
import { listMonthlyInputs, type MonthlyInput } from "@/lib/db";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import MonthlyInputTable from "@/components/MonthlyInputTable";

export const dynamic = "force-dynamic";

/** ⑤ 月初在庫・購入重量・スクラップ売却数量の入力（管理者のみ）。 */
export default async function MonthlyPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const session = await requireAdminPage();
  const sp = await searchParams;
  const yearNum = Number(sp.year);
  const year =
    Number.isInteger(yearNum) && yearNum >= 2000 && yearNum <= 2100
      ? yearNum
      : new Date().getFullYear();

  let inputs: MonthlyInput[];
  try {
    inputs = await listMonthlyInputs(session.companyId, year);
  } catch (e) {
    console.error("[monthly]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="月次入力" />
        <DbErrorState />
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="月次入力"
        description="単位: kg。月初在庫・購入重量は区分別に入力（全体は自動合計）。翌月の月初在庫を入力すると在庫法の使用量が計算されます。"
      />
      <MonthlyInputTable year={year} inputs={inputs} />
    </div>
  );
}
