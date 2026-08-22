import { FileDown, ClipboardList } from "lucide-react";
import { requireEntitledSession, getFactoryRestriction } from "@/lib/session";
import {
  DAILY_STATUS_LABEL,
  listDailyAgg,
  listFactoryOptions,
  listScrapKinds,
  type DailyAggRow,
  type ScrapKind,
} from "@/lib/db";
import { kindColor } from "@/lib/scrapTypes";
import { fmt, fmtPct, isYmStr, thisMonthStr } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import MonthNav from "@/components/MonthNav";
import SummaryFilters from "@/components/SummaryFilters";
import DeleteDailyButton from "@/components/DeleteDailyButton";

export const dynamic = "force-dynamic";

const td = "border border-[#e5e5e5] px-2.5 py-1.5 whitespace-nowrap";
const tdNum = `${td} text-right tabular-nums`;
const th = "border border-[#e5e5e5] bg-[#f0f0ee] px-2.5 py-1.5 text-left font-semibold whitespace-nowrap";
const thNum = `${th} text-right`;

/** 状態バッジの色（日次記録と同じ）。 */
function statusClass(status: DailyAggRow["status"]): string {
  return status === "approved"
    ? "bg-[#eef4ee] text-[#2f6b2f]"
    : status === "pending"
      ? "bg-[#fff3e0] text-[#a15c00]"
      : status === "rejected"
        ? "bg-[#fdecea] text-[#dc000c]"
        : "bg-[#eeeeee] text-[#555555]";
}

/**
 * 月間集計。日次記録から切り出した独立タブで、工場・スクラップの種類で絞り込める。
 * 集計の元は日次記録の投入明細なので、値は日次記録タブと必ず一致する。
 */
export default async function SummaryPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string; factory?: string; kind?: string }>;
}) {
  const session = await requireEntitledSession();
  const sp = await searchParams;
  const ym = isYmStr(sp.ym) ? sp.ym : thisMonthStr();

  let factoryOptions: string[];
  let factoryLocked: boolean;
  let factory: string;
  let agg: DailyAggRow[];
  let kinds: ScrapKind[];
  try {
    const restriction = await getFactoryRestriction(session);
    // 所属工場ユーザーは自工場に固定（URLで他工場を指定されてもサーバー側で無視）
    factoryLocked = restriction.restricted;
    factoryOptions = restriction.restricted
      ? [restriction.factory!]
      : await listFactoryOptions(session.companyId);
    factory = restriction.restricted ? restriction.factory! : (sp.factory ?? "").trim();
    [agg, kinds] = await Promise.all([
      listDailyAgg(session.companyId, ym, factory || null),
      listScrapKinds(session.companyId),
    ]);
  } catch (e) {
    console.error("[summary]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="月間集計" />
        <DbErrorState />
      </div>
    );
  }

  const isAdmin = session.role === "admin";

  // 絞り込みに出す種類。マスタの並び順を基本に、マスタに無い種類（過去の記録）は末尾に足す。
  const kindNames = [
    ...kinds.map((k) => k.name),
    ...[...new Set(agg.flatMap((r) => Object.keys(r.byKind)))]
      .filter((n) => !kinds.some((k) => k.name === n))
      .sort(),
  ];
  const kind = kindNames.includes((sp.kind ?? "").trim()) ? (sp.kind ?? "").trim() : "";

  // 種類で絞ったときは、その種類の重量だけを見る（回収箱測定値は箱ごと＝種類混在なので突合しない）
  const shownKinds = kind ? [kind] : kindNames;
  const rows = agg
    .map((r) => ({ ...r, shownTotal: kind ? (r.byKind[kind] ?? 0) : r.total }))
    .filter((r) => !kind || r.shownTotal !== 0);

  const byKindTotal = Object.fromEntries(
    kindNames.map((n) => [n, rows.reduce((t, r) => t + (r.byKind[n] ?? 0), 0)])
  ) as Record<string, number>;
  const grandTotal = rows.reduce((t, r) => t + r.shownTotal, 0);

  // 工場別の内訳。全工場を見ているときだけ意味があるので、2工場以上あるときに出す。
  const factoriesInRows = [...new Set(rows.map((r) => r.factory))].sort();
  const showFactoryBreakdown = !factory && factoriesInRows.length > 1;
  const factoryRows = factoriesInRows.map((f) => {
    const rs = rows.filter((r) => r.factory === f);
    return {
      factory: f,
      days: rs.length,
      byKind: Object.fromEntries(
        kindNames.map((n) => [n, rs.reduce((t, r) => t + (r.byKind[n] ?? 0), 0)])
      ) as Record<string, number>,
      total: rs.reduce((t, r) => t + r.shownTotal, 0),
    };
  });

  // 表の列数（データ無しの行・合計行の colSpan 用）
  const cols = 3 + shownKinds.length + (kind ? 0 : 4) + 1 + (isAdmin ? 1 : 0);
  const restCols = (kind ? 1 : 4) + (isAdmin ? 1 : 0);

  const exportHref =
    `/api/export?type=daily&ym=${ym}` +
    (factory ? `&factory=${encodeURIComponent(factory)}` : "") +
    (kind ? `&kind=${encodeURIComponent(kind)}` : "");
  const dailyHref = (r: DailyAggRow) =>
    `/daily?date=${r.recordDate}&factory=${encodeURIComponent(r.factory)}`;

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="月間集計"
        description="日次記録の投入明細を月単位で集計します。工場・スクラップの種類で絞り込めます"
      />

      {/* 絞り込み */}
      <div className="mb-3 flex flex-wrap items-center gap-2 sm:mb-4">
        <MonthNav ym={ym} />
        <SummaryFilters
          factory={factory}
          factoryOptions={factoryOptions}
          factoryLocked={factoryLocked}
          kind={kind}
          kindOptions={kindNames}
        />
        <a
          href={exportHref}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
        >
          <FileDown className="h-4 w-4" />
          CSV出力
        </a>
        <a
          href={`/daily?ym=${ym}`}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
        >
          <ClipboardList className="h-4 w-4" />
          日次記録へ
        </a>
      </div>

      {/* 種類別の月間合計 */}
      <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <h2 className="mb-1 text-sm font-bold text-[#333333]">
          {ym.replace("-", "年")}月の合計
          <span className="ml-2 font-normal text-[#707070]">
            {factory || "全工場"}
            {kind ? ` ／ ${kind}` : ""} ／ {rows.length}日分
          </span>
        </h2>
        <p className="mb-3 text-xs text-[#909090]">
          承認前（下書き・申請中）の記録も含みます。状態は下の一覧で確認してください。
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {shownKinds.map((n) => (
            <div key={n} className={`rounded-xl px-3 py-2.5 ${kindColor(n, kindNames.indexOf(n))}`}>
              <div className="text-xs opacity-80">{n}</div>
              <div className="text-lg font-bold tabular-nums">{fmt(byKindTotal[n] ?? 0)} kg</div>
            </div>
          ))}
          {/* 種類を1つに絞っているときは種類カードと同じ値になるので出さない */}
          {!kind && (
            <div className="rounded-xl bg-[#f7f7f5] px-3 py-2.5">
              <div className="text-xs text-[#707070]">合計</div>
              <div className="text-lg font-bold tabular-nums">{fmt(grandTotal)} kg</div>
            </div>
          )}
        </div>
      </section>

      {/* 工場別の内訳（全工場を見ているときだけ） */}
      {showFactoryBreakdown && (
        <section className="mt-4 rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
          <h2 className="mb-3 text-sm font-bold text-[#333333]">工場別</h2>
          <div className="overflow-x-auto">
            <table className="print-table w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={th}>工場</th>
                  <th className={thNum}>日数</th>
                  {shownKinds.map((n) => (
                    <th key={n} className={thNum}>
                      {n}(kg)
                    </th>
                  ))}
                  {!kind && <th className={thNum}>合計(kg)</th>}
                </tr>
              </thead>
              <tbody>
                {factoryRows.map((f) => (
                  <tr key={f.factory}>
                    <td className={td}>
                      <a
                        href={`/summary?ym=${ym}&factory=${encodeURIComponent(f.factory)}${kind ? `&kind=${encodeURIComponent(kind)}` : ""}`}
                        className="text-[#b4632c] hover:underline"
                      >
                        {f.factory}
                      </a>
                    </td>
                    <td className={tdNum}>{f.days}</td>
                    {shownKinds.map((n) => (
                      <td key={n} className={tdNum}>
                        {fmt(f.byKind[n] ?? 0)}
                      </td>
                    ))}
                    {!kind && <td className={`${tdNum} font-semibold`}>{fmt(f.total)}</td>}
                  </tr>
                ))}
                <tr className="bg-[#faf6ef] font-semibold">
                  <td className={td}>合計</td>
                  <td className={tdNum}>{rows.length}</td>
                  {shownKinds.map((n) => (
                    <td key={n} className={tdNum}>
                      {fmt(byKindTotal[n] ?? 0)}
                    </td>
                  ))}
                  {!kind && <td className={tdNum}>{fmt(grandTotal)}</td>}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* 日別 */}
      <section className="mt-4 rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <h2 className="mb-1 text-sm font-bold text-[#333333]">日別</h2>
        {kind && (
          <p className="text-xs text-[#909090]">
            「{kind}」の投入がある日だけを表示しています。回収箱の測定値は箱ごと（種類が混ざる）のため、
            種類で絞っている間は差異の欄を伏せています。
          </p>
        )}

        {/* モバイル: 日別カード */}
        <ul className="mt-3 space-y-2 sm:hidden">
          {rows.length === 0 && (
            <li className="rounded-xl bg-[#f7f7f5] px-3 py-3 text-sm text-[#707070]">
              対象月の記録がありません
            </li>
          )}
          {rows.map((r) => (
            <li key={`m-${r.recordDate}|${r.factory}`} className="rounded-xl border border-[#e5e5e5] p-3">
              <a href={dailyHref(r)} className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  <span className="text-sm font-bold text-[#b4632c]">{r.recordDate}</span>
                  <span className="ml-2 text-xs text-[#707070]">{r.factory}</span>
                  <span className="mt-0.5 block text-xs text-[#909090]">
                    {shownKinds
                      .filter((n) => (r.byKind[n] ?? 0) !== 0)
                      .map((n) => `${n} ${fmt(r.byKind[n] ?? 0)}`)
                      .join(" ／ ") || "記録なし"}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="block text-lg font-bold tabular-nums">{fmt(r.shownTotal)}</span>
                  <span
                    className={`mt-0.5 inline-block rounded-md px-1.5 py-0.5 text-[11px] font-bold ${statusClass(r.status)}`}
                  >
                    {DAILY_STATUS_LABEL[r.status]}
                  </span>
                </span>
              </a>
            </li>
          ))}
          {rows.length > 0 && (
            <li className="flex items-center justify-between rounded-xl bg-[#faf6ef] px-3 py-2.5 text-sm font-semibold">
              <span>月間合計（{rows.length}日分）</span>
              <span className="tabular-nums">{fmt(grandTotal)} kg</span>
            </li>
          )}
        </ul>

        <div className="mt-3 hidden overflow-x-auto sm:block">
          <table className="print-table w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>日付</th>
                <th className={th}>工場</th>
                <th className={th}>責任者</th>
                {shownKinds.map((n) => (
                  <th key={n} className={thNum}>
                    {n}(kg)
                  </th>
                ))}
                {!kind && (
                  <>
                    <th className={thNum}>合計(kg)</th>
                    <th className={thNum}>回収箱測定値</th>
                    <th className={thNum}>差異率</th>
                  </>
                )}
                <th className={th}>状態</th>
                {!kind && <th className={thNum}>異常</th>}
                {isAdmin && <th className={th}></th>}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td className={td} colSpan={cols}>
                    対象月の記録がありません
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const sai =
                  r.kaishuSokuteichi !== null && r.total > 0
                    ? (r.kaishuSokuteichi - r.total) / r.total
                    : null;
                return (
                  <tr key={`${r.recordDate}|${r.factory}`}>
                    <td className={td}>
                      <a href={dailyHref(r)} className="text-[#b4632c] hover:underline">
                        {r.recordDate}
                      </a>
                    </td>
                    <td className={td}>{r.factory}</td>
                    <td className={td}>{r.sekininsha}</td>
                    {shownKinds.map((n) => (
                      <td key={n} className={tdNum}>
                        {fmt(r.byKind[n] ?? 0)}
                      </td>
                    ))}
                    {!kind && (
                      <>
                        <td className={`${tdNum} font-semibold`}>{fmt(r.total)}</td>
                        <td className={tdNum}>{fmt(r.kaishuSokuteichi)}</td>
                        <td
                          className={`${tdNum} ${sai !== null && Math.abs(sai) > 0.05 ? "bg-[#fdecea] text-[#dc000c]" : ""}`}
                        >
                          {fmtPct(sai)}
                        </td>
                      </>
                    )}
                    <td className={td}>
                      <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${statusClass(r.status)}`}>
                        {DAILY_STATUS_LABEL[r.status]}
                      </span>
                      {r.status === "approved" && r.approvedBy && (
                        <span className="ml-1 text-xs text-[#707070]">{r.approvedBy}</span>
                      )}
                    </td>
                    {!kind && <td className={tdNum}>{r.ijoCount > 0 ? r.ijoCount : ""}</td>}
                    {isAdmin && (
                      <td className={td}>
                        <DeleteDailyButton recordDate={r.recordDate} factory={r.factory} />
                      </td>
                    )}
                  </tr>
                );
              })}
              {rows.length > 0 && (
                <tr className="bg-[#faf6ef] font-semibold">
                  <td className={td} colSpan={3}>
                    月間合計（{rows.length}日分）
                  </td>
                  {shownKinds.map((n) => (
                    <td key={n} className={tdNum}>
                      {fmt(byKindTotal[n] ?? 0)}
                    </td>
                  ))}
                  {!kind && <td className={tdNum}>{fmt(grandTotal)}</td>}
                  <td className={td} colSpan={restCols}></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
