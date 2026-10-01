import Link from "next/link";
import { redirect } from "next/navigation";
import { BookOpen, ChevronRight } from "lucide-react";
import { requireEntitledSession, canUseOperations, getFactoryView } from "@/lib/session";
import { DAILY_STATUS_LABEL, countPendingDaily, listDailyAgg, type DailyAggRow } from "@/lib/db";
import { fmt, thisMonthStr, todayStr } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import { FLOW, MODULES, usable, type AppModule, type ModuleKey } from "@/components/Modules";

export const dynamic = "force-dynamic";

/** ①②③… の丸数字（手順の番号） */
const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨"];

/** 機能を目的ごとにまとめたもの。ops の機能は権限のある人にだけ出す（サイドバーと同じ規則）。 */
const GROUPS: { title: string; note: string; keys: ModuleKey[] }[] = [
  { title: "現場の記録", note: "毎日の投入・袋の締めと初品の実測", keys: ["daily", "bags", "first", "firstList"] },
  { title: "集計・照合", note: "月末にズレがないかを確かめる", keys: ["summary", "dashboard"] },
  { title: "月次の入力・取込", note: "生産管理部・調達部", keys: ["procurement", "mcframe", "dailyImport", "quality"] },
  { title: "マスタ・設定", note: "生産管理部・調達部", keys: ["scales", "items", "settings"] },
];

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
 * ホーム。画面が機能ごとに並んでいるだけでは「何から・どの順で使うか」が分からないため、
 * 実際の業務の順番（マスタ → 日次記録 → 袋の記録 → 初品測定 → 調達入力(月次在庫) → McFrame取込 → 月間集計 → 照合）
 * を①②③…で見せ、各手順から該当画面へ進めるようにする。
 * いまの工場（上部で選んだ工場／所属工場）の今月の状況も少し出す。
 * 旧ホームの照合ダッシュボードは /dashboard へ移した。
 */
export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string; factory?: string }>;
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

  const ym = thisMonthStr();
  const today = todayStr();
  let status: {
    factory: string | null;
    rows: DailyAggRow[];
    pending: number;
  } | null = null;
  try {
    const view = await getFactoryView(session);
    const [rows, pending] = await Promise.all([
      listDailyAgg(session.companyId, ym, view.factory),
      countPendingDaily(session.companyId, view.factory),
    ]);
    status = { factory: view.factory, rows, pending };
  } catch (e) {
    // 状況が出せなくても、使い方の案内は見せる
    console.error("[home]", e);
  }

  const recorded = status ? status.rows.filter((r) => r.total > 0) : [];
  const monthTotal = recorded.reduce((t, r) => t + r.total, 0);
  const todayRows = recorded.filter((r) => r.recordDate === today);
  const recent = [...recorded]
    .sort((a, b) => b.recordDate.localeCompare(a.recordDate) || a.factory.localeCompare(b.factory))
    .slice(0, 5);

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="スクラップの記録から照合まで"
        description="現場で毎日スクラップの重量を記録し、McFrameの生産実績から出した理論スクラップ・売却量と突き合わせます。下の順番で使います。"
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

      {/* 使う順番 */}
      <section className="mb-6 rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-bold text-[#333333]">使う順番</h2>
        <ol className="space-y-2">
          {FLOW.map((step, i) => {
            const m = MODULES[step.module];
            const Icon = m.icon;
            const others = (step.also ?? []).map((k) => MODULES[k]).filter((o) => usable(o, canOperate, isAdmin));
            const can = usable(m, canOperate, isAdmin);
            return (
              <li
                key={step.module}
                className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border border-[#eeeeee] px-3 py-3 sm:flex-nowrap"
              >
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#b4632c] text-base font-bold text-white">
                  {CIRCLED[i] ?? i + 1}
                </span>
                <Icon className="h-5 w-5 shrink-0 text-[#b4632c]" />
                <div className="min-w-0 grow basis-48">
                  <p className="text-sm font-bold text-[#333333]">
                    {step.title}
                    <span className="ml-2 text-[11px] font-normal text-[#909090]">{step.when}</span>
                  </p>
                  <p className="text-xs leading-5 text-[#707070]">{step.note}</p>
                </div>
                {can ? (
                  <div className="flex w-full flex-wrap gap-1.5 sm:w-auto sm:shrink-0 sm:justify-end">
                    {others.map((o) => (
                      <Link
                        key={o.key}
                        href={o.href}
                        className="inline-flex items-center gap-1 rounded-lg border border-[#e5e5e5] px-3 py-1.5 text-xs font-medium text-[#555555] hover:bg-[#f7f7f5]"
                      >
                        {o.title}
                      </Link>
                    ))}
                    <Link
                      href={m.href}
                      className="inline-flex items-center gap-1 rounded-lg bg-[#b4632c] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#96521f]"
                    >
                      {m.title}
                      <ChevronRight className="h-3.5 w-3.5" />
                    </Link>
                  </div>
                ) : (
                  <span className="rounded-lg bg-[#f7f7f5] px-2.5 py-1 text-[11px] text-[#707070] sm:shrink-0">
                    生産管理部・調達部が行います
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </section>

      {/* いまの工場の状況 */}
      {status && (
        <section className="mb-6 rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-bold text-[#333333]">
              今月の状況（{status.factory ?? "全工場"}・{ym}）
            </h2>
            <Link href={MODULES.summary.href} className="text-xs text-[#b4632c] underline">
              月間集計を見る
            </Link>
          </div>
          <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="今日の記録" value={todayRows.length > 0 ? "記録あり" : "まだ"} warn={todayRows.length === 0} />
            <Stat label="今月の記録日数" value={`${new Set(recorded.map((r) => r.recordDate)).size}日`} />
            <Stat label="今月のスクラップ合計" value={`${fmt(monthTotal)} kg`} />
            <Stat
              label="承認待ち（全期間）"
              value={`${status.pending}日`}
              warn={status.pending > 0}
            />
          </div>
          <h3 className="mb-1.5 text-xs font-bold text-[#707070]">最近の日次記録</h3>
          {recent.length === 0 ? (
            <p className="rounded-lg bg-[#f7f7f5] px-3 py-3 text-sm text-[#707070]">
              今月の記録はまだありません。
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
        {GROUPS.map((g) => {
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

function Stat({ label, value, warn = false }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`rounded-xl px-3 py-2.5 ${warn ? "bg-[#fff3e0]" : "bg-[#f7f7f5]"}`}>
      <p className="text-[11px] text-[#707070]">{label}</p>
      <p className={`text-base font-bold tabular-nums ${warn ? "text-[#a15c00]" : "text-[#333333]"}`}>
        {value}
      </p>
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
