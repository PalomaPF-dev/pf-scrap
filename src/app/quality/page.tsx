import Link from "next/link";
import { requireEntitledSession, getFactoryView } from "@/lib/session";
import {
  countQualitySheetsByMonth,
  listFactoryOptions,
  listQualitySheets,
  type QualitySheet,
} from "@/lib/db";
import { normYm, thisMonthStr } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import MonthNav from "@/components/MonthNav";
import ScaleFactoryFilter from "@/components/ScaleFactoryFilter";
import QualitySheetDropZone from "@/components/QualitySheetDropZone";
import QualitySheetsTable from "@/components/QualitySheetsTable";

export const dynamic = "force-dynamic";

function fmtYm(ym: string): string {
  const [y, m] = ym.split("-");
  return y && m ? `${y}年${Number(m)}月` : ym;
}

/**
 * 品質チェックシート（PDF）の保管。
 * ファイルサーバーの月フォルダ（…\02_PDF\2026\202609）に入れているPDFを、
 * 月と工場を選んでまとめてドラッグ＆ドロップで取り込み、一覧から開ける。
 * 所属工場が設定された人は自工場のものだけ（取込先も自工場に固定）。上部で工場を選んだ人はその工場に固定。
 */
export default async function QualityPage({
  searchParams,
}: {
  searchParams: Promise<{ ym?: string; factory?: string }>;
}) {
  const session = await requireEntitledSession();
  const sp = await searchParams;
  const ym = normYm(sp.ym) ?? thisMonthStr();

  let factoryOptions: string[];
  let factoryLocked: boolean;
  let factory: string;
  let sheets: QualitySheet[];
  let months: { ym: string; count: number }[];
  try {
    // 所属工場ユーザーは自工場、上部で工場を選んだ人はその工場に固定（「全工場」ならここで絞り込める）。
    // 取込（書き込み）側の工場の判定は API が getFactoryRestriction で別に行う。
    const restriction = await getFactoryView(session);
    const factories = await listFactoryOptions(session.companyId);
    factoryLocked = restriction.restricted;
    factoryOptions = factoryLocked ? [restriction.factory!] : factories;
    factory = factoryLocked ? restriction.factory! : (sp.factory ?? "").trim();
    [sheets, months] = await Promise.all([
      listQualitySheets(session.companyId, { ym, factory: factory || null }),
      countQualitySheetsByMonth(session.companyId, factory || null),
    ]);
  } catch (e) {
    console.error("[quality]", e);
    return (
      <div className="p-4 sm:p-6">
        <PageHeader title="品質チェックシート" />
        <DbErrorState />
      </div>
    );
  }

  const otherMonths = months.filter((m) => m.ym !== ym).slice(0, 12);
  const factoryQs = factory ? `&factory=${encodeURIComponent(factory)}` : "";

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="品質チェックシート"
        description="内胴ベンダーなどの品質チェックシート（PDF）を月ごとに保管します。対象月と工場を選び、PDFをまとめてドラッグ＆ドロップしてください。取り込んだシートは一覧からその場で開けます。"
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs text-[#707070]">
          対象月
          <MonthNav ym={ym} />
        </div>
        <ScaleFactoryFilter
          factory={factory}
          factoryOptions={factoryOptions}
          factoryLocked={factoryLocked}
        />
      </div>

      <div className="space-y-6">
        <QualitySheetDropZone
          key={`${ym}|${factory}`}
          factory={factory}
          factoryOptions={factoryOptions}
          factoryLocked={factoryLocked}
          ym={ym}
        />

        <section>
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-bold text-slate-800">
              {fmtYm(ym)}
              {factory ? ` ・ ${factory}` : " ・ 全工場"}
            </h2>
            {otherMonths.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-[#707070]">
                <span>ほかの月:</span>
                {otherMonths.map((m) => (
                  <Link
                    key={m.ym}
                    href={`/quality?ym=${m.ym}${factoryQs}`}
                    className="rounded-full border border-[#e5e5e5] bg-white px-2.5 py-1 text-[#555555] hover:bg-[#f7f7f5]"
                  >
                    {fmtYm(m.ym)} <span className="text-[#9a9a9a]">{m.count}件</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
          <QualitySheetsTable
            sheets={sheets}
            isAdmin={session.role === "admin"}
            userId={session.userId}
            showFactory={!factory}
          />
        </section>
      </div>
    </div>
  );
}
