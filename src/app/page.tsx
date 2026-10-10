import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, ChevronRight } from "lucide-react";
import { requireEntitledSession, canUseOperations, getFactoryView } from "@/lib/session";
import { DAILY_STATUS_LABEL, countPendingDaily, listDailyAgg, listFactoryOptions, type DailyAggRow } from "@/lib/db";
import { fmt, normYm, thisMonthStr, todayStr } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import MonthNav from "@/components/MonthNav";
import { MODULES, MODULE_GROUPS, usable, type AppModule } from "@/components/Modules";

export const dynamic = "force-dynamic";

/** 状態バッジの色（日次記録・月間集計と同じ）。 */
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
 * ホーム。工場ごとの「その月の状況」（今日の記録・記録日数・合計・承認待ち）と、
 * 用途別の機能一覧を出す。月は上の切替で変えられる（既定は今月）。
 * 旧ホームの照合ダッシュボードは /dashboard へ移した。
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string; factory?: string; m?: string }>;
}) {
  // 旧ホーム（照合ダッシュボード）のブックマーク（/?ym=…）は、移転先へ送る
  const sp = await searchParams;
  if (sp.ym || sp.factory) {
    const q = new URLSearchParams();
    if (sp.ym) q.set("ym", sp.ym);
    if (sp.factory) q.set("factory", sp.factory);
    redirect(`/dashboard?${q.toString()}`);
  }

  const session = await requireEntitledSession();
  // 使えない機能は出さない。判定はサイドバー・各画面の入口と同じ規則
  const canOperate = await canUseOperations(session);
  const isAdmin = session.role === "admin";

  // 月の切替は ?m=（?ym= は旧ホームの転送に使っているので別名）
  const ym = normYm(sp.m) ?? thisMonthStr();
  const today = todayStr();
  const isThisMonth = ym === thisMonthStr();
  let status: {
    /** 見られる工場（所属工場の人は1つ、全工場の人は候補＋記録のある工場） */
    factories: string[];
    rows: DailyAggRow[];
    /** 工場ごとの承認待ち日数（全期間） */
    pending: Record<string, number>;
    locked: boolean;
  } | null = null;
  try {
    const view = await getFactoryView(session);
    const [rows, options] = await Promise.all([
      listDailyAgg(session.companyId, ym, view.factory),
      view.factory ? Promise.resolve([view.factory]) : listFactoryOptions(session.companyId),
    ]);
    const factories = [...options];
    for (const r of rows) if (r.factory && !factories.includes(r.factory)) factories.push(r.factory);
    const pendingList = await Promise.all(
      factories.map((f) => countPendingDaily(session.companyId, f).then((n) => [f, n] as const))
    );
    status = { factories, rows, pending: Object.fromEntries(pendingList), locked: view.restricted };
  } catch (e) {
    // 状況が出せなくても、機能の案内は見せる
    console.error("[home]", e);
  }

  const recorded = status ? status.rows.filter((r) => r.total > 0) : [];
  const recent = [...recorded]
    .sort((a, b) => b.recordDate.localeCompare(a.recordDate) || a.factory.localeCompare(b.factory))
    .slice(0, 5);
  const [y, mo] = ym.split("-");
  const ymLabel = `${y}年${Number(mo)}月`;

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="スクラップの記録から照合まで"
        description="現場で毎日スクラップの重量を記録し、McFrameの生産実績から出した理論スクラップ・売却量と突き合わせます。"
        action={
          <Link
            href={MODULES.guide.href}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
          >
            <BookOpen className="h-4 w-4" />
            使い方を1画面ずつ見る
          </Link>
        }
      />

      {/* 工場ごとの月の状況 */}
      {status && (
        <section className="mb-6 rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-[#333333]">{ymLabel}の状況（工場別）</h2>
            <div className="flex flex-wrap items-center gap-2">
              <MonthNav ym={ym} param="m" />
              <Link href={`${MODULES.summary.href}?ym=${ym}`} className="text-xs text-[#b4632c] underline">
                月間集計を見る
              </Link>
            </div>
          </div>
          {status.factories.length === 0 ? (
            <p className="rounded-lg bg-[#f7f7f5] px-3 py-3 text-sm text-[#707070]">
              工場がまだ登録されていません。設定の「工場・職場」で追加してください。
            </p>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#eeeeee]">
              <table className="w-full text-sm">
                <thead className="bg-[#fafaf8] text-xs text-[#707070]">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">工場</th>
                    {isThisMonth && <th className="px-3 py-2 text-left font-medium">今日の記録</th>}
                    <th className="px-3 py-2 text-right font-medium">記録日数</th>
                    <th className="px-3 py-2 text-right font-medium">スクラップ合計(kg)</th>
                    <th className="px-3 py-2 text-right font-medium">承認待ち（全期間）</th>
                    <th className="px-3 py-2 text-right font-medium"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#f0f0f0]">
                  {status.factories.map((f) => {
                    const mine = recorded.filter((r) => r.factory === f);
                    const days = new Set(mine.map((r) => r.recordDate)).size;
                    const total = mine.reduce((t, r) => t + r.total, 0);
                    const todayDone = mine.some((r) => r.recordDate === today);
                    const pending = status.pending[f] ?? 0;
                    return (
                      <tr key={f} className="hover:bg-[#fcfcfb]">
                        <td className="px-3 py-2 font-medium text-[#333333]">{f}</td>
                        {isThisMonth && (
                          <td className="px-3 py-2">
                            <span
                              className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                                todayDone ? "bg-[#eef4ee] text-[#2f6b2f]" : "bg-[#fff3e0] text-[#a15c00]"
                              }`}
                            >
                              {todayDone ? "記録あり" : "まだ"}
                            </span>
                          </td>
                        )}
                        <td className="px-3 py-2 text-right tabular-nums">{days}日</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(total)}</td>
                        <td
                          className={`px-3 py-2 text-right tabular-nums ${pending > 0 ? "font-bold text-[#a15c00]" : ""}`}
                        >
                          {pending}日
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">
                          <Link
                            href={`${MODULES.daily.href}?factory=${encodeURIComponent(f)}`}
                            className="text-xs text-[#b4632c] underline"
                          >
                            日次記録
                          </Link>
                          <Link
                            href={`${MODULES.summary.href}?ym=${ym}&factory=${encodeURIComponent(f)}`}
                            className="ml-3 text-xs text-[#b4632c] underline"
                          >
                            月間集計
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                {status.factories.length > 1 && (
                  <tfoot className="bg-[#fafaf8] text-xs">
                    <tr>
                      <td className="px-3 py-2 font-medium text-[#555555]">合計</td>
                      {isThisMonth && <td />}
                      <td className="px-3 py-2 text-right tabular-nums">
                        {new Set(recorded.map((r) => `${r.factory}|${r.recordDate}`)).size}日
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmt(recorded.reduce((t, r) => t + r.total, 0))}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {Object.values(status.pending).reduce((t, n) => t + n, 0)}日
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}
          <h3 className="mb-1.5 mt-4 text-xs font-bold text-[#707070]">最近の日次記録</h3>
          {recent.length === 0 ? (
            <p className="rounded-lg bg-[#f7f7f5] px-3 py-3 text-sm text-[#707070]">
              {ymLabel}の記録はまだありません。
              <Link href={MODULES.daily.href} className="ml-1 text-[#b4632c] underline">
                日次記録をつける
              </Link>
            </p>
          ) : (
            <ul className="divide-y divide-[#eeeeee] rounded-xl border border-[#eeeeee]">
              {recent.map((r) => (
                <li key={`${r.recordDate}|${r.factory}`}>
                  <Link
                    href={`/daily?date=${r.recordDate}&factory=${encodeURIComponent(r.factory)}`}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm hover:bg-[#faf6ef]"
                  >
                    <span className="tabular-nums text-[#333333]">{r.recordDate}</span>
                    <span className="text-[#707070]">{r.factory}</span>
                    <span className="grow text-right tabular-nums text-[#333333]">{fmt(r.total)} kg</span>
                    <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold ${statusClass(r.status)}`}>
                      {DAILY_STATUS_LABEL[r.status]}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {/* 機能（目的ごと） */}
      <div className="grid gap-4 lg:grid-cols-2">
        {MODULE_GROUPS.map((g) => {
          const mods = g.keys.map((k) => MODULES[k]).filter((m) => usable(m, canOperate, isAdmin));
          if (mods.length === 0) return null;
          return (
            <section key={g.title} className="rounded-2xl border border-[#e5e5e5] bg-white p-4">
              <div className="mb-3 flex items-baseline gap-2">
                <h2 className="text-sm font-bold text-[#333333]">{g.title}</h2>
                <p className="text-[11px] text-[#909090]">{g.note}</p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {mods.map((m) => (
                  <ModuleCard key={m.key} m={m} />
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ModuleCard({ m }: { m: AppModule }) {
  const Icon = m.icon;
  return (
    <Link
      href={m.href}
      className="flex flex-col rounded-xl border border-[#eeeeee] p-3 transition hover:border-[#b4632c] hover:shadow-sm"
    >
      <div className="mb-1.5 flex items-center gap-2">
        <Icon className="h-5 w-5 shrink-0 text-[#b4632c]" />
        <h3 className="text-sm font-bold text-[#333333]">{m.title}</h3>
      </div>
      <p className="mb-2 text-xs leading-5 text-[#707070]">{m.lead}</p>
      {m.points.length > 0 && (
        <ul className="mb-3 list-disc space-y-0.5 pl-4 text-[11px] leading-4 text-[#909090]">
          {m.points.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      <span className="mt-auto inline-flex w-fit items-center gap-1 text-xs font-bold text-[#b4632c]">
        {m.cta}
        <ChevronRight className="h-3.5 w-3.5" />
      </span>
    </Link>
  );
}
