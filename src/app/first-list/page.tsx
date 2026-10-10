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
import { normYm, thisMonthStr } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import MonthNav from "@/components/MonthNav";
import ScaleFactoryFilter from "@/components/ScaleFactoryFilter";
import SearchBox from "@/components/SearchBox";
import FirstListStatusFilter from "@/components/FirstListStatusFilter";
import FirstListTable from "@/components/FirstListTable";

export const dynamic = "force-dynamic";

/** 画面に出す上限。これを超えたら絞り込みを促す（CSVは5,000件まで） */
const LIMIT = 1000;

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
    return `/first-list?${p.toString()}`;
  };

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="初品測定一覧"
        description="初品の実測完成品重量の記録を、月・工場・品目・状態で絞り込んで確認します。絞り込んだ内容のままCSVに出せます。登録・承認は「初品重量測定」で、削除は管理者がこの画面で行います。"
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
        <FirstListTable rows={rows} isAdmin={session.role === "admin"} />
      </div>
    </div>
  );
}
