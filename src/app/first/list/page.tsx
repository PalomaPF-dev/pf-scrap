import Link from "next/link";
import { FileDown, Scale } from "lucide-react";
import { requireEntitledSession, getFactoryView } from "@/lib/session";
import {
  FA_STATUS_LABEL,
  listFactoryOptions,
  listFirstArticlesFiltered,
  type FaStatus,
  type FirstArticleListRow,
} from "@/lib/db";
import { fmt, fmtPct, normYm, thisMonthStr } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import MonthNav from "@/components/MonthNav";
import ScaleFactoryFilter from "@/components/ScaleFactoryFilter";
import SearchBox from "@/components/SearchBox";
import FirstListStatusFilter from "@/components/FirstListStatusFilter";

export const dynamic = "force-dynamic";

/** 画面に出す上限。これを超えたら絞り込みを促す（CSVは5,000件まで） */
const LIMIT = 1000;

const th = "px-3 py-2 text-left text-xs font-medium text-[#707070] whitespace-nowrap";
const td = "px-3 py-2 whitespace-nowrap";

function statusClass(status: FaStatus): string {
  return status === "approved"
    ? "bg-[#eef4ee] text-[#2f6b2f]"
    : status === "pending"
      ? "bg-[#fff3e0] text-[#a15c00]"
      : "bg-[#fdecea] text-[#dc000c]";
}

function fmtYm(ym: string): string {
  const [y, m] = ym.split("-");
  return y && m ? `${y}年${Number(m)}月` : ym;
}

/**
 * 初品測定の一覧。月・工場・品目（検索語）・状態で絞り込み、そのままCSVに出せる。
 * 登録・承認は「初品重量測定」で行い、ここは確認用（全員が見られる）。
 * 工場は所属・上部の選択に従い、「全工場」のときだけここで絞れる。
 */
export default async function FirstListPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string; factory?: string; q?: string; status?: string }>;
}) {
  const session = await requireEntitledSession();
  const sp = await searchParams;
  const allMonths = sp.ym === "all";
  const ym = allMonths ? null : (normYm(sp.ym) ?? thisMonthStr());
  const q = (sp.q ?? "").trim();
  const status = sp.status && sp.status in FA_STATUS_LABEL ? (sp.status as FaStatus) : null;

  let factoryOptions: string[];
  let factoryLocked: boolean;
  let factory: string;
  let rows: FirstArticleListRow[];
  try {
    const view = await getFactoryView(session);
    const factories = await listFactoryOptions(session.companyId);
    factoryLocked = view.restricted;
    factoryOptions = factoryLocked ? [view.factory!] : factories;
    factory = factoryLocked ? view.factory! : (sp.factory ?? "").trim();
    rows = await listFirstArticlesFiltered(session.companyId, {
      ym,
      factory: factory || null,
      q,
      status,
      limit: LIMIT,
    });
  } catch (e) {
    console.error("[first/list]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="初品測定一覧" />
        <DbErrorState />
      </div>
    );
  }

  const counts = { pending: 0, approved: 0, rejected: 0 } as Record<FaStatus, number>;
  for (const r of rows) counts[r.status]++;

  // 画面の絞り込みをそのままCSVへ（工場の制限はAPI側でも掛かる）
  const csvQs = new URLSearchParams({ type: "first", ym: ym ?? "all" });
  if (factory) csvQs.set("factory", factory);
  if (q) csvQs.set("q", q);
  if (status) csvQs.set("status", status);

  // 「すべての月」「今月に戻る」の切替リンク（他の絞り込みは保つ）
  const keep = new URLSearchParams();
  if (factory && !factoryLocked) keep.set("factory", factory);
  if (q) keep.set("q", q);
  if (status) keep.set("status", status);
  const linkTo = (ymValue: string) => {
    const p = new URLSearchParams(keep);
    p.set("ym", ymValue);
    return `/first/list?${p.toString()}`;
  };

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="初品測定一覧"
        description="初品の実測完成品重量の記録を、月・工場・品目・状態で絞り込んで確認します。絞り込んだ内容のままCSVに出せます。登録・承認は「初品重量測定」で行います。"
        action={
          <>
            <Link
              href={`/first${factory ? `?factory=${encodeURIComponent(factory)}` : ""}`}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
            >
              <Scale className="h-4 w-4" />
              測定を登録
            </Link>
            <a
              href={`/api/export?${csvQs.toString()}`}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
            >
              <FileDown className="h-4 w-4" />
              CSV出力
            </a>
          </>
        }
      />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#707070]">
          対象月
          {allMonths ? (
            <>
              <span className="flex h-10 items-center rounded-lg border border-[#e5e5e5] bg-[#f7f7f5] px-3 text-sm text-[#333333]">
                すべての月
              </span>
              <Link
                href={linkTo(thisMonthStr())}
                className="h-10 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm leading-10 text-[#555555] hover:bg-[#f7f7f5]"
              >
                月で絞る
              </Link>
            </>
          ) : (
            <>
              <MonthNav ym={ym!} />
              <Link
                href={linkTo("all")}
                className="h-10 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm leading-10 text-[#555555] hover:bg-[#f7f7f5]"
              >
                すべての月
              </Link>
            </>
          )}
        </div>
        <ScaleFactoryFilter
          factory={factory}
          factoryOptions={factoryOptions}
          factoryLocked={factoryLocked}
        />
        <FirstListStatusFilter status={status} />
      </div>
      <div className="mb-4">
        <SearchBox q={q} placeholder="品目CD・格納場所CD・品名・子図番・測定者で検索" />
      </div>

      <div className="overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eeeeee] px-4 py-2.5 text-sm">
          <span className="font-medium text-slate-700">
            {ym ? fmtYm(ym) : "すべての月"}
            {factory ? ` ・ ${factory}` : " ・ 全工場"}
            {status ? ` ・ ${FA_STATUS_LABEL[status]}` : ""}
            {q ? ` ・ 「${q}」` : ""}
            <span className="ml-2">{rows.length} 件</span>
            {rows.length >= LIMIT && (
              <span className="ml-2 text-xs font-normal text-[#dc000c]">
                先頭 {LIMIT} 件だけ表示しています。月や品目で絞り込んでください
              </span>
            )}
          </span>
          <span className="flex flex-wrap gap-3 text-xs text-[#707070]">
            <span>申請中 {counts.pending}</span>
            <span>承認済み {counts.approved}</span>
            <span>差し戻し {counts.rejected}</span>
          </span>
        </div>
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-500">
            条件に合う初品測定の記録がありません。
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-[#fafaf8]">
                <tr>
                  <th className={th}>測定日</th>
                  <th className={th}>工場</th>
                  <th className={th}>品目CD</th>
                  <th className={th}>格納場所CD</th>
                  <th className={th}>品名</th>
                  <th className={`${th} text-right`}>実測(kg)</th>
                  <th className={`${th} text-right`}>理論値(kg)</th>
                  <th className={`${th} text-right`}>差(kg)</th>
                  <th className={`${th} text-right`}>差率</th>
                  <th className={th}>測定者</th>
                  <th className={th}>状態</th>
                  <th className={th}>承認者</th>
                  <th className={th}>備考</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0f0f0]">
                {rows.map((r) => {
                  const diff = r.kanseiJuryo !== null ? r.weight - r.kanseiJuryo : null;
                  const rate = r.kanseiJuryo ? r.weight / r.kanseiJuryo - 1 : null;
                  // 理論値から大きく外れている行は目立たせる（単位・桁の誤りに気づけるように）
                  const off = rate !== null && Math.abs(rate) > 0.5;
                  return (
                    <tr key={`${r.measuredOn}|${r.hinmokuCD}|${r.kakunoCD}`} className="hover:bg-[#fcfcfb]">
                      <td className={`${td} tabular-nums`}>{r.measuredOn}</td>
                      <td className={td}>{r.factory || r.itemFactory || "—"}</td>
                      <td className={`${td} font-mono text-xs`}>{r.hinmokuCD}</td>
                      <td className={`${td} font-mono text-xs`}>{r.kakunoCD}</td>
                      <td className={`${td} max-w-[16rem] truncate`} title={r.hinmei ?? ""}>
                        {r.hinmei ?? <span className="text-[#9a9a9a]">（マスター未登録）</span>}
                      </td>
                      <td className={`${td} text-right font-bold tabular-nums`}>{fmt(r.weight, 4)}</td>
                      <td className={`${td} text-right tabular-nums text-[#555555]`}>
                        {r.kanseiJuryo !== null ? fmt(r.kanseiJuryo, 4) : "—"}
                      </td>
                      <td className={`${td} text-right tabular-nums text-[#555555]`}>
                        {diff !== null ? fmt(diff, 4) : "—"}
                      </td>
                      <td className={`${td} text-right tabular-nums ${off ? "font-bold text-[#dc000c]" : "text-[#555555]"}`}>
                        {rate !== null ? fmtPct(rate, 1) : "—"}
                      </td>
                      <td className={td}>{r.sokuteisha}</td>
                      <td className={td}>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(r.status)}`}>
                          {FA_STATUS_LABEL[r.status]}
                        </span>
                      </td>
                      <td className={`${td} text-[#555555]`}>{r.approvedBy || "—"}</td>
                      <td className={`${td} max-w-[16rem] truncate text-xs text-[#707070]`} title={r.rejectComment || r.note}>
                        {r.rejectComment || r.note || ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
