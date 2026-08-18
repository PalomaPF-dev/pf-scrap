import { FileDown } from "lucide-react";
import { requireEntitledSession, getFactoryRestriction } from "@/lib/session";
import {
  DAILY_STATUS_LABEL,
  KUBUN_LIST,
  getDailyRecord,
  listDailyAgg,
  listFactoryOptions,
  listScales,
  type DailyAggRow,
  type DailyRecord,
  type Scale,
} from "@/lib/db";
import { dailyBomTotals, type DailyBom } from "@/lib/calc";
import { fmt, fmtPct, isDateStr, isYmStr, thisMonthStr, todayStr } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import MonthNav from "@/components/MonthNav";
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
  let scales: Scale[];
  let bom: DailyBom;
  try {
    const restriction = await getFactoryRestriction(session);
    const factories = await listFactoryOptions(session.companyId);
    // 所属工場ユーザーは自工場に固定（URLで他工場を指定されてもサーバー側で無視）
    factoryLocked = restriction.restricted;
    factoryOptions = restriction.restricted ? [restriction.factory!] : factories;
    factory = restriction.restricted
      ? restriction.factory!
      : (sp.factory ?? "").trim() || factoryOptions[0] || "大口";
    [record, agg, scales, bom] = await Promise.all([
      getDailyRecord(session.companyId, date, factory),
      listDailyAgg(session.companyId, ym, restriction.restricted ? restriction.factory : null),
      listScales(session.companyId, {
        factory: restriction.restricted ? restriction.factory : factory,
        activeOnly: true,
      }),
      // McFrameの日別加工数 × 単品完成重量（初品実測を優先）＝ その日の完成品重量
      dailyBomTotals(session.companyId, date, factory),
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
  // 当日の記録スクラップ合計（理論値との突合に使う）
  const dayTotal = (record?.entries ?? []).reduce((t, e) => t + e.weight, 0);
  const monthTotal = {
    jodo: agg.reduce((t, r) => t + r.byKind["上銅"], 0),
    darai: agg.reduce((t, r) => t + r.byKind["銅ダライ"], 0),
    sonota: agg.reduce((t, r) => t + r.byKind["その他"], 0),
    total: agg.reduce((t, r) => t + r.total, 0),
  };

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="日次記録"
        description="スクラップ発生のたびに、重量計（スクラップ箱）をQRで選んで計量・記録し、終礼後に管理者へ申請します"
      />

      <DailyRecordForm
        key={`${date}|${factory}|${record?.status ?? "new"}`}
        date={date}
        factory={factory}
        factoryOptions={factoryOptions}
        factoryLocked={factoryLocked}
        initial={record}
        scales={scales}
        userName={session.userName}
        isAdmin={isAdmin}
      />

      {/* 当日の理論値（McFrame日別加工数 × 単品完成重量） */}
      <section className="mt-3 rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:mt-4 sm:p-5">
        <h2 className="mb-1 text-base font-bold text-[#333333] sm:text-sm">
          {date} の完成品重量（McFrame加工数 × 初品重量）
        </h2>
        <p className="mb-3 text-xs text-[#909090]">
          完成品重量 = Σ(その日の加工数 × 単品完成重量)。単品完成重量は承認済みの初品実測を優先し、
          無ければ品目マスターの理論値を使います。
        </p>
        {bom.items === 0 ? (
          <p className="rounded-lg bg-[#f7f7f5] px-3 py-3 text-sm text-[#707070]">
            この日のMcFrame加工数が取り込まれていません。「McFrame取込」から
            日付つきの加工数（KEY, 日付, 加工数）を取り込むと、当日の完成品重量が算出されます。
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="rounded-xl bg-[#f7f7f5] px-3 py-2.5">
              <div className="text-xs text-[#707070]">完成品重量</div>
              <div className="text-lg font-bold tabular-nums">{fmt(bom.finished)} kg</div>
            </div>
            <div className="rounded-xl bg-[#f7f7f5] px-3 py-2.5">
              <div className="text-xs text-[#707070]">使用量（構成法）</div>
              <div className="text-lg font-bold tabular-nums">{fmt(bom.usage)} kg</div>
            </div>
            <div className="rounded-xl bg-[#faf6ef] px-3 py-2.5">
              <div className="text-xs text-[#707070]">理論スクラップ</div>
              <div className="text-lg font-bold tabular-nums">{fmt(bom.usage - bom.finished)} kg</div>
            </div>
            <div className="rounded-xl bg-[#f7f7f5] px-3 py-2.5">
              <div className="text-xs text-[#707070]">日次記録 − 理論</div>
              <div
                className={`text-lg font-bold tabular-nums ${
                  Math.abs(dayTotal - (bom.usage - bom.finished)) > (bom.usage - bom.finished) * 0.05
                    ? "text-[#dc000c]"
                    : ""
                }`}
              >
                {fmt(dayTotal - (bom.usage - bom.finished))} kg
              </div>
            </div>
          </div>
        )}
        {bom.items > 0 && (
          <p className="mt-2 text-xs text-[#909090]">
            対象品目 {bom.items} 件 ／ 区分別 完成品重量:{" "}
            {KUBUN_LIST.map((k) => `${k} ${fmt(bom.byKubun[k].finished)}`).join(" ／ ")} kg
          </p>
        )}
      </section>

      {/* 月間集計 */}
      <section className="mt-6 rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-[#333333]">月間集計</h2>
          <div className="flex flex-wrap items-center gap-2">
            <MonthNav ym={ym} />
            <a
              href={`/api/export?type=daily&ym=${ym}`}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
            >
              <FileDown className="h-4 w-4" />
              CSV出力
            </a>
          </div>
        </div>

        {/* モバイル: 日別カード */}
        <ul className="space-y-2 sm:hidden">
          {agg.length === 0 && (
            <li className="rounded-xl bg-[#f7f7f5] px-3 py-3 text-sm text-[#707070]">
              対象月の記録がありません
            </li>
          )}
          {agg.map((r) => (
            <li key={`m-${r.recordDate}|${r.factory}`} className="rounded-xl border border-[#e5e5e5] p-3">
              <a
                href={`/daily?date=${r.recordDate}&factory=${encodeURIComponent(r.factory)}&ym=${ym}`}
                className="flex items-center justify-between gap-2"
              >
                <span className="min-w-0">
                  <span className="text-sm font-bold text-[#b4632c]">{r.recordDate}</span>
                  <span className="ml-2 text-xs text-[#707070]">{r.factory}</span>
                  <span className="mt-0.5 block text-xs text-[#909090]">
                    上銅 {fmt(r.byKind["上銅"])} ／ 銅ダライ {fmt(r.byKind["銅ダライ"])}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-lg font-bold tabular-nums">{fmt(r.total)}</span>
                  <span
                    className={`mt-0.5 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                      r.status === "approved"
                        ? "bg-[#eef4ee] text-[#2f6b2f]"
                        : r.status === "pending"
                          ? "bg-[#fff3e0] text-[#a15c00]"
                          : r.status === "rejected"
                            ? "bg-[#fdecea] text-[#dc000c]"
                            : "bg-[#eeeeee] text-[#555555]"
                    }`}
                  >
                    {DAILY_STATUS_LABEL[r.status]}
                  </span>
                </span>
              </a>
            </li>
          ))}
          {agg.length > 0 && (
            <li className="flex items-center justify-between rounded-xl bg-[#faf6ef] px-3 py-2.5 text-sm font-semibold">
              <span>月間合計（{agg.length}日分）</span>
              <span className="tabular-nums">{fmt(monthTotal.total)} kg</span>
            </li>
          )}
        </ul>

        <div className="hidden overflow-x-auto sm:block">
          <table className="print-table w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>日付</th>
                <th className={th}>工場</th>
                <th className={th}>責任者</th>
                <th className={thNum}>上銅(kg)</th>
                <th className={thNum}>銅ダライ(kg)</th>
                <th className={thNum}>その他(kg)</th>
                <th className={thNum}>合計(kg)</th>
                <th className={thNum}>回収箱測定値</th>
                <th className={thNum}>差異率</th>
                <th className={th}>状態</th>
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
                    <td className={tdNum}>{fmt(r.byKind["上銅"])}</td>
                    <td className={tdNum}>{fmt(r.byKind["銅ダライ"])}</td>
                    <td className={tdNum}>{fmt(r.byKind["その他"])}</td>
                    <td className={`${tdNum} font-semibold`}>{fmt(r.total)}</td>
                    <td className={tdNum}>{fmt(r.kaishuSokuteichi)}</td>
                    <td
                      className={`${tdNum} ${sai !== null && Math.abs(sai) > 0.05 ? "bg-[#fdecea] text-[#dc000c]" : ""}`}
                    >
                      {fmtPct(sai)}
                    </td>
                    <td className={td}>
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                          r.status === "approved"
                            ? "bg-[#eef4ee] text-[#2f6b2f]"
                            : r.status === "pending"
                              ? "bg-[#fff3e0] text-[#a15c00]"
                              : r.status === "rejected"
                                ? "bg-[#fdecea] text-[#dc000c]"
                                : "bg-[#eeeeee] text-[#555555]"
                        }`}
                      >
                        {DAILY_STATUS_LABEL[r.status]}
                      </span>
                      {r.status === "approved" && r.approvedBy && (
                        <span className="ml-1 text-xs text-[#707070]">{r.approvedBy}</span>
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
                  <td className={tdNum}>{fmt(monthTotal.jodo)}</td>
                  <td className={tdNum}>{fmt(monthTotal.darai)}</td>
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
