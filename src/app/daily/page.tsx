import { FileDown } from "lucide-react";
import { requireEntitledSession, getFactoryRestriction } from "@/lib/session";
import {
  getDailyRecord,
  listDailyAgg,
  listFactoryOptions,
  type DailyAggRow,
  type DailyRecord,
} from "@/lib/db";
import { fmt, fmtPct, isDateStr, isYmStr, thisMonthStr, todayStr } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import MonthPicker from "@/components/MonthPicker";
import DailyRecordForm from "@/components/DailyRecordForm";
import DeleteDailyButton from "@/components/DeleteDailyButton";

export const dynamic = "force-dynamic";

const td = "border border-[#e5e5e5] px-2.5 py-1.5 whitespace-nowrap";
const tdNum = `${td} text-right tabular-nums`;
const th = "border border-[#e5e5e5] bg-[#f0f0ee] px-2.5 py-1.5 text-left font-semibold whitespace-nowrap";
const thNum = `${th} text-right`;

export default async function DailyPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; factory?: string; ym?: string }>;
}) {
  const session = await requireEntitledSession();
  const sp = await searchParams;
  const date = isDateStr(sp.date) ? sp.date : todayStr();
  const ym = isYmStr(sp.ym) ? sp.ym : thisMonthStr();

  let factoryOptions: string[];
  let factoryLocked: boolean;
  let factory: string;
  let record: DailyRecord | null;
  let agg: DailyAggRow[];
  try {
    const restriction = await getFactoryRestriction(session);
    const factories = await listFactoryOptions(session.companyId);
    // 所属工場ユーザーは自工場に固定（URLで他工場を指定されてもサーバー側で無視）
    factoryLocked = restriction.restricted;
    factoryOptions = restriction.restricted ? [restriction.factory!] : factories;
    factory = restriction.restricted
      ? restriction.factory!
      : (sp.factory ?? "").trim() || factoryOptions[0] || "大口";
    [record, agg] = await Promise.all([
      getDailyRecord(session.companyId, date, factory),
      listDailyAgg(session.companyId, ym, restriction.restricted ? restriction.factory : null),
    ]);
  } catch (e) {
    console.error("[daily]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="日次記録" />
        <DbErrorState />
      </div>
    );
  }

  const isAdmin = session.role === "admin";
  const monthTotal = {
    dojo: agg.reduce((t, r) => t + r.byKubun["銅条"], 0),
    dokan: agg.reduce((t, r) => t + r.byKubun["銅管"], 0),
    sonota: agg.reduce((t, r) => t + r.byKubun["その他"], 0),
    total: agg.reduce((t, r) => t + r.total, 0),
  };

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="日次記録"
        description="スクラップ日次記録票（発生のたびに記入し、終礼で回収箱測定値と突合）"
      />

      <DailyRecordForm
        key={`${date}|${factory}`}
        date={date}
        factory={factory}
        factoryOptions={factoryOptions}
        factoryLocked={factoryLocked}
        initial={record}
        userName={session.userName}
      />

      {/* 月間集計 */}
      <section className="mt-6 rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-[#333333]">月間集計</h2>
          <div className="flex items-center gap-2">
            <MonthPicker ym={ym} />
            <a
              href={`/api/export?type=daily&ym=${ym}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
            >
              <FileDown className="h-4 w-4" />
              CSV出力
            </a>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="print-table w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>日付</th>
                <th className={th}>工場</th>
                <th className={th}>責任者</th>
                <th className={thNum}>銅条(kg)</th>
                <th className={thNum}>銅管(kg)</th>
                <th className={thNum}>その他(kg)</th>
                <th className={thNum}>合計(kg)</th>
                <th className={thNum}>回収箱測定値</th>
                <th className={thNum}>差異率</th>
                <th className={th}>承認</th>
                <th className={thNum}>異常</th>
                {isAdmin && <th className={th}></th>}
              </tr>
            </thead>
            <tbody>
              {agg.length === 0 && (
                <tr>
                  <td className={td} colSpan={isAdmin ? 12 : 11}>
                    対象月の記録がありません
                  </td>
                </tr>
              )}
              {agg.map((r) => {
                const sai =
                  r.kaishuSokuteichi !== null && r.total > 0
                    ? (r.kaishuSokuteichi - r.total) / r.total
                    : null;
                return (
                  <tr key={`${r.recordDate}|${r.factory}`}>
                    <td className={td}>
                      <a
                        href={`/daily?date=${r.recordDate}&factory=${encodeURIComponent(r.factory)}&ym=${ym}`}
                        className="text-[#b4632c] hover:underline"
                      >
                        {r.recordDate}
                      </a>
                    </td>
                    <td className={td}>{r.factory}</td>
                    <td className={td}>{r.sekininsha}</td>
                    <td className={tdNum}>{fmt(r.byKubun["銅条"])}</td>
                    <td className={tdNum}>{fmt(r.byKubun["銅管"])}</td>
                    <td className={tdNum}>{fmt(r.byKubun["その他"])}</td>
                    <td className={`${tdNum} font-semibold`}>{fmt(r.total)}</td>
                    <td className={tdNum}>{fmt(r.kaishuSokuteichi)}</td>
                    <td
                      className={`${tdNum} ${sai !== null && Math.abs(sai) > 0.05 ? "bg-[#fdecea] text-[#dc000c]" : ""}`}
                    >
                      {fmtPct(sai)}
                    </td>
                    <td className={td}>
                      {r.shonin ? (
                        `✔ ${r.shonin}`
                      ) : (
                        <span className="rounded bg-[#eeeeee] px-1.5 py-0.5 text-[11px] text-[#555555]">
                          未承認
                        </span>
                      )}
                    </td>
                    <td className={tdNum}>{r.ijoCount > 0 ? r.ijoCount : ""}</td>
                    {isAdmin && (
                      <td className={td}>
                        <DeleteDailyButton recordDate={r.recordDate} factory={r.factory} />
                      </td>
                    )}
                  </tr>
                );
              })}
              {agg.length > 0 && (
                <tr className="bg-[#faf6ef] font-semibold">
                  <td className={td} colSpan={3}>
                    月間合計（{agg.length}日分）
                  </td>
                  <td className={tdNum}>{fmt(monthTotal.dojo)}</td>
                  <td className={tdNum}>{fmt(monthTotal.dokan)}</td>
                  <td className={tdNum}>{fmt(monthTotal.sonota)}</td>
                  <td className={tdNum}>{fmt(monthTotal.total)}</td>
                  <td className={td} colSpan={isAdmin ? 5 : 4}></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
