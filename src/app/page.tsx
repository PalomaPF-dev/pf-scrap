import Link from "next/link";
import { FileDown } from "lucide-react";
import { requireEntitledSession } from "@/lib/session";
import { monthlySummary, yearSummary, type KubunSummary } from "@/lib/calc";
import { KUBUN_LIST } from "@/lib/db";
import { fmt, fmtPct, isYmStr, thisMonthStr } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import MonthPicker from "@/components/MonthPicker";

export const dynamic = "force-dynamic";

const td = "border border-[#e5e5e5] px-2.5 py-1.5 whitespace-nowrap";
const tdNum = `${td} text-right tabular-nums`;
const th = "border border-[#e5e5e5] bg-[#f0f0ee] px-2.5 py-1.5 text-left font-semibold whitespace-nowrap";
const thNum = `${th} text-right`;

function MethodBadge({ method }: { method: KubunSummary["method"] }) {
  if (!method) return null;
  return (
    <span
      title={
        method === "在庫法"
          ? "月初在庫 + 購入重量 − 翌月月初在庫"
          : "Σ(加工数 × 構成重量)。翌月の月初在庫が未入力のための代替計算"
      }
      className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${
        method === "在庫法" ? "bg-[#eef4ee] text-[#2f6b2f]" : "bg-[#fff3e0] text-[#a15c00]"
      }`}
    >
      {method}
    </span>
  );
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string }>;
}) {
  const session = await requireEntitledSession();
  const sp = await searchParams;
  const ym = isYmStr(sp.ym) ? sp.ym : thisMonthStr();
  const year = Number(ym.slice(0, 4));

  let s, years;
  try {
    [s, years] = await Promise.all([
      monthlySummary(session.companyId, ym),
      yearSummary(session.companyId, year),
    ]);
  } catch (e) {
    console.error("[dashboard]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="照合ダッシュボード" />
        <DbErrorState />
      </div>
    );
  }

  const g = s.perKubun["全体"];
  const dailyTotal = s.daily.total;
  // 差異5%超は要確認としてハイライトする
  const warn6 =
    s.diff6 !== null && dailyTotal > 0 && Math.abs(s.diff6) / dailyTotal > 0.05;
  const warn7 =
    s.diff7sell !== null && g.scrapTheo ? Math.abs(s.diff7sell) / Math.abs(g.scrapTheo) > 0.05 : false;

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="照合ダッシュボード"
        description={`${session.companyName} スクラップ重量の突合（全社集計）`}
        action={
          <>
            <MonthPicker ym={ym} />
            <a
              href={`/api/export?type=recon&year=${year}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
            >
              <FileDown className="h-4 w-4" />
              年間一覧CSV
            </a>
          </>
        }
      />

      {/* 月次サマリー（区分別） */}
      <section className="mb-6 rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <h2 className="mb-1 text-sm font-bold text-[#333333]">月次サマリー（区分別）</h2>
        <p className="mb-3 text-xs text-[#909090]">
          使用量 = 月初在庫 + 購入重量 − 翌月月初在庫（未入力時は構成重量ベース） / 理論スクラップ = 使用量 − 完成重量
        </p>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>区分</th>
                <th className={thNum}>月初在庫</th>
                <th className={thNum}>購入重量</th>
                <th className={thNum}>翌月月初在庫</th>
                <th className={thNum}>使用量</th>
                <th className={th}>算出</th>
                <th className={thNum}>構成重量(参考)</th>
                <th className={thNum}>完成重量</th>
                <th className={thNum}>理論スクラップ</th>
              </tr>
            </thead>
            <tbody>
              {[...KUBUN_LIST, "全体"].map((kb) => {
                const r = s.perKubun[kb];
                const usage = r.usageInv !== null ? r.usageInv : r.usageBom;
                return (
                  <tr key={kb} className={kb === "全体" ? "bg-[#faf6ef] font-semibold" : ""}>
                    <td className={td}>{kb}</td>
                    <td className={tdNum}>{fmt(r.zaiko)}</td>
                    <td className={tdNum}>{fmt(r.konyu)}</td>
                    <td className={tdNum}>{fmt(r.zaikoNext)}</td>
                    <td className={tdNum}>{fmt(usage)}</td>
                    <td className={td}>
                      <MethodBadge method={r.method} />
                    </td>
                    <td className={tdNum}>{fmt(r.usageBom)}</td>
                    <td className={tdNum}>{fmt(r.finished)}</td>
                    <td className={`${tdNum} ${r.scrapTheo !== null && r.scrapTheo < 0 ? "text-[#dc000c]" : ""}`}>
                      {fmt(r.scrapTheo)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ⑥⑦ 突合 */}
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
          <h2 className="mb-3 text-sm font-bold text-[#333333]">⑥ スクラップ売却 × 日次記録 の突合</h2>
          <table className="w-full border-collapse text-sm">
            <tbody>
              <tr>
                <th className={th}>スクラップ売却数量（⑤入力）</th>
                <td className={tdNum}>{s.baikyaku !== null ? `${fmt(s.baikyaku)} kg` : "未入力"}</td>
                <td className={td}></td>
              </tr>
              <tr>
                <th className={th}>日次記録スクラップ合計（①）</th>
                <td className={tdNum}>{fmt(dailyTotal)} kg</td>
                <td className={td}>{s.daily.days}日分</td>
              </tr>
              <tr>
                <th className={th}>差異（売却 − 日次記録）</th>
                <td className={`${tdNum} ${warn6 ? "bg-[#fdecea] text-[#dc000c]" : s.diff6 !== null ? "bg-[#eef4ee]" : ""}`}>
                  {s.diff6 !== null ? `${fmt(s.diff6)} kg` : "-"}
                </td>
                <td className={td}>{s.rate6 !== null ? `率 ${fmtPct(s.rate6)}` : ""}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
          <h2 className="mb-3 text-sm font-bold text-[#333333]">⑦ 理論スクラップ × 売却/日次記録 の突合</h2>
          <table className="w-full border-collapse text-sm">
            <tbody>
              <tr>
                <th className={th}>理論スクラップ（全体）</th>
                <td className={tdNum}>{g.scrapTheo !== null ? `${fmt(g.scrapTheo)} kg` : "-"}</td>
                <td className={td}>
                  <MethodBadge method={g.method} />
                </td>
              </tr>
              <tr>
                <th className={th}>売却 − 理論（売量vs理論）</th>
                <td className={`${tdNum} ${warn7 ? "bg-[#fdecea] text-[#dc000c]" : s.diff7sell !== null ? "bg-[#eef4ee]" : ""}`}>
                  {s.diff7sell !== null ? `${fmt(s.diff7sell)} kg` : "-"}
                </td>
                <td className={td}>{s.rate7sell !== null ? `率 ${fmtPct(s.rate7sell)}` : ""}</td>
              </tr>
              <tr>
                <th className={th}>日次記録 − 理論</th>
                <td className={tdNum}>{s.diff7daily !== null ? `${fmt(s.diff7daily)} kg` : "-"}</td>
                <td className={td}>{s.rate7daily !== null ? `率 ${fmtPct(s.rate7daily)}` : ""}</td>
              </tr>
            </tbody>
          </table>
        </section>
      </div>

      {/* 年間推移（全体） */}
      <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-bold text-[#333333]">{year}年 年間推移（全体）</h2>
        <div className="overflow-x-auto">
          <table className="print-table w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>年月</th>
                <th className={thNum}>月初在庫</th>
                <th className={thNum}>購入重量</th>
                <th className={thNum}>使用量</th>
                <th className={thNum}>構成重量</th>
                <th className={thNum}>完成重量</th>
                <th className={thNum}>理論SCP</th>
                <th className={thNum}>SCP売量</th>
                <th className={thNum}>日次記録</th>
                <th className={thNum}>売量vs理論</th>
                <th className={thNum}>売却vs日次</th>
              </tr>
            </thead>
            <tbody>
              {years.length === 0 && (
                <tr>
                  <td className={td} colSpan={11}>
                    データがありません。
                    <Link href="/monthly" className="text-[#b4632c] underline">月次入力</Link>・
                    <Link href="/daily" className="text-[#b4632c] underline">日次記録</Link>から登録してください。
                  </td>
                </tr>
              )}
              {years.map((r) => (
                <tr key={r.ym} className={r.ym === ym ? "bg-[#faf6ef]" : ""}>
                  <td className={td}>
                    <Link href={`/?ym=${r.ym}`} className="text-[#b4632c] hover:underline">
                      {r.ym}
                    </Link>
                  </td>
                  <td className={tdNum}>{fmt(r.zaiko)}</td>
                  <td className={tdNum}>{fmt(r.konyu)}</td>
                  <td className={tdNum}>{fmt(r.usage)}</td>
                  <td className={tdNum}>{fmt(r.usageBom)}</td>
                  <td className={tdNum}>{fmt(r.finished)}</td>
                  <td className={tdNum}>{fmt(r.scrapTheo)}</td>
                  <td className={tdNum}>{fmt(r.baikyaku)}</td>
                  <td className={tdNum}>{fmt(r.daily)}</td>
                  <td className={`${tdNum} ${r.diff7sell !== null && r.diff7sell < 0 ? "text-[#dc000c]" : ""}`}>
                    {fmt(r.diff7sell)}
                  </td>
                  <td className={`${tdNum} ${r.diff6 !== null && r.diff6 < 0 ? "text-[#dc000c]" : ""}`}>
                    {fmt(r.diff6)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
