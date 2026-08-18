import { FileDown } from "lucide-react";
import { requireAdminPage } from "@/lib/session";
import { mcframeDayTotals, monthlyItemRows, type McframeDayTotal } from "@/lib/calc";
import { fmt, isYmStr, thisMonthStr } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import MonthNav from "@/components/MonthNav";
import McframeImportButton from "@/components/McframeImportButton";

export const dynamic = "force-dynamic";

const td = "border border-[#e5e5e5] px-2.5 py-1.5 whitespace-nowrap";
const tdNum = `${td} text-right tabular-nums`;
const th = "border border-[#e5e5e5] bg-[#f0f0ee] px-2.5 py-1.5 text-left font-semibold whitespace-nowrap";
const thNum = `${th} text-right`;

/** ④ McFrameから完成品数量（加工数）の取込と、品目別の理論スクラップ計算（管理者のみ）。 */
export default async function McframePage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const session = await requireAdminPage();
  const sp = await searchParams;
  const ym = isYmStr(sp.ym) ? sp.ym : thisMonthStr();

  let rows: Awaited<ReturnType<typeof monthlyItemRows>>;
  let dayTotals: McframeDayTotal[];
  try {
    [rows, dayTotals] = await Promise.all([
      monthlyItemRows(session.companyId, ym),
      mcframeDayTotals(session.companyId, ym),
    ]);
  } catch (e) {
    console.error("[mcframe]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="McFrame取込" />
        <DbErrorState />
      </div>
    );
  }

  const sum = (k: "qty" | "usage" | "finished" | "scrap") =>
    rows.reduce((t, r) => t + r[k], 0);

  return (
      <div className="p-4 sm:p-6">
        <PageHeader
          title="McFrame取込"
          description="品目マスターのKEY単位で完成品数量（加工数）を取り込みます。CSV形式: KEY,日付,加工数（日別）または KEY,年月,加工数（月次）。「管理図番,製造場所CD,日付/年月,加工数」の4列も可。日付は 2026/8/5・2026-08-05、年月は 2026/08・202608 いずれも可。同じ日付(年月)×KEYは上書きされます。"
          action={
            <>
              <McframeImportButton />
              <MonthNav ym={ym} />
              <a
                href={`/api/export?type=mcframe&ym=${ym}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
              >
                <FileDown className="h-4 w-4" />
                計算結果CSV
              </a>
            </>
          }
        />

        {/* 日別の完成品重量（日付つきで取り込んだ月のみ） */}
        <section className="mb-4 rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
          <h2 className="mb-1 text-sm font-bold text-[#333333]">{ym} 日別の完成品重量</h2>
          <p className="mb-3 text-xs text-[#909090]">
            完成品重量 = その日の加工数 × 単品完成重量（初品実測を優先）。日付つきで取り込んだ月だけ表示されます。
          </p>
          {dayTotals.length === 0 ? (
            <p className="rounded-lg bg-[#f7f7f5] px-3 py-3 text-sm text-[#707070]">
              この月は日別の加工数がありません（月次の取込値で集計しています）。
              CSVに「日付」列を付けて取り込むと、日ごとの完成品重量が出せます。
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="print-table w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={th}>日付</th>
                    <th className={thNum}>加工数</th>
                    <th className={thNum}>完成品重量(kg)</th>
                    <th className={thNum}>使用量(kg)</th>
                    <th className={thNum}>理論スクラップ(kg)</th>
                  </tr>
                </thead>
                <tbody>
                  {dayTotals.map((d) => (
                    <tr key={d.date}>
                      <td className={td}>
                        <a
                          href={`/daily?date=${d.date}`}
                          className="text-[#b4632c] hover:underline"
                        >
                          {d.date}
                        </a>
                      </td>
                      <td className={tdNum}>{fmt(d.qty, 0)}</td>
                      <td className={`${tdNum} font-semibold`}>{fmt(d.finished)}</td>
                      <td className={tdNum}>{fmt(d.usage)}</td>
                      <td className={tdNum}>{fmt(d.usage - d.finished)}</td>
                    </tr>
                  ))}
                  <tr className="bg-[#faf6ef] font-semibold">
                    <td className={td}>月間合計（{dayTotals.length}日分）</td>
                    <td className={tdNum}>{fmt(dayTotals.reduce((t, d) => t + d.qty, 0), 0)}</td>
                    <td className={tdNum}>{fmt(dayTotals.reduce((t, d) => t + d.finished, 0))}</td>
                    <td className={tdNum}>{fmt(dayTotals.reduce((t, d) => t + d.usage, 0))}</td>
                    <td className={tdNum}>
                      {fmt(dayTotals.reduce((t, d) => t + d.usage - d.finished, 0))}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
          <h2 className="mb-1 text-sm font-bold text-[#333333]">
            {ym} 品目別 完成重量・使用量・理論スクラップ
          </h2>
          <p className="mb-3 text-xs text-[#909090]">
            完成重量 = 加工数 × 単品完成重量（初品実測を優先、なければ理論値） / 使用量 = 加工数 × 構成重量 / 理論スクラップ = 使用量 − 完成重量
          </p>
          <div className="overflow-x-auto">
            <table className="print-table w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={th}>KEY</th>
                  <th className={th}>品名</th>
                  <th className={th}>区分</th>
                  <th className={thNum}>加工数</th>
                  <th className={thNum}>単品完成重量(kg)</th>
                  <th className={th}>重量根拠</th>
                  <th className={thNum}>完成重量(kg)</th>
                  <th className={thNum}>使用量(kg)</th>
                  <th className={thNum}>理論スクラップ(kg)</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr>
                    <td className={td} colSpan={9}>
                      対象月の加工数データがありません。「CSV取込」から取り込んでください。
                    </td>
                  </tr>
                )}
                {rows.map((r) => (
                  <tr key={r.itemKey}>
                    <td className={td}>{r.itemKey}</td>
                    <td className={td}>
                      {r.found ? (
                        r.hinmei
                      ) : (
                        <span className="rounded bg-[#fdecea] px-1.5 py-0.5 text-[11px] font-bold text-[#dc000c]">
                          マスター未登録
                        </span>
                      )}
                    </td>
                    <td className={td}>{r.kubun}</td>
                    <td className={tdNum}>{fmt(r.qty, 0)}</td>
                    <td className={tdNum}>{fmt(r.unitFinished, 6)}</td>
                    <td className={td}>
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
                          r.unitSource === "実測"
                            ? "bg-[#eef4ee] text-[#2f6b2f]"
                            : r.unitSource === "理論"
                              ? "bg-[#fff3e0] text-[#a15c00]"
                              : "bg-[#fdecea] text-[#dc000c]"
                        }`}
                      >
                        {r.unitSource}
                        {r.faDate ? ` ${r.faDate}` : ""}
                      </span>
                    </td>
                    <td className={tdNum}>{fmt(r.finished)}</td>
                    <td className={tdNum}>{fmt(r.usage)}</td>
                    <td className={`${tdNum} ${r.scrap < 0 ? "text-[#dc000c]" : ""}`}>{fmt(r.scrap)}</td>
                  </tr>
                ))}
                {rows.length > 0 && (
                  <tr className="bg-[#faf6ef] font-semibold">
                    <td className={td} colSpan={3}>
                      合計（{rows.length}品目）
                    </td>
                    <td className={tdNum}>{fmt(sum("qty"), 0)}</td>
                    <td className={td} colSpan={2}></td>
                    <td className={tdNum}>{fmt(sum("finished"))}</td>
                    <td className={tdNum}>{fmt(sum("usage"))}</td>
                    <td className={tdNum}>{fmt(sum("scrap"))}</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
    </div>
  );
}
