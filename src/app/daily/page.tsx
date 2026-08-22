import { BarChart3 } from "lucide-react";
import { requireEntitledSession, getFactoryRestriction } from "@/lib/session";
import {
  KUBUN_LIST,
  getDailyRecord,
  listFactoryOptions,
  listScales,
  listScrapKinds,
  type DailyRecord,
  type Scale,
  type ScrapKind,
} from "@/lib/db";
import { dailyBomTotals, type DailyBom } from "@/lib/calc";
import { fmt, isDateStr, isYmStr, todayStr } from "@/lib/format";
import PageHeader from "@/components/PageHeader";
import DbErrorState from "@/components/DbErrorState";
import DailyRecordForm from "@/components/DailyRecordForm";

export const dynamic = "force-dynamic";

export default async function DailyPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; factory?: string; ym?: string }>;
}) {
  const session = await requireEntitledSession();
  const sp = await searchParams;
  const date = isDateStr(sp.date) ? sp.date : todayStr();
  // 月間集計は別タブ。ここでは「月間集計へ」のリンク先にだけ使う（既存ブックマークの ?ym= も活かす）
  const ym = isYmStr(sp.ym) ? sp.ym : date.slice(0, 7);

  let factoryOptions: string[];
  let factoryLocked: boolean;
  let factory: string;
  let record: DailyRecord | null;
  let scales: Scale[];
  let kinds: ScrapKind[];
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
    [record, scales, kinds, bom] = await Promise.all([
      getDailyRecord(session.companyId, date, factory),
      listScales(session.companyId, {
        factory: restriction.restricted ? restriction.factory : factory,
        activeOnly: true,
      }),
      // 種類は「設定」で増やせるので、投入先の選択肢もマスタから作る
      listScrapKinds(session.companyId),
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
        kinds={kinds}
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

      {/* 月間集計は別タブ（工場・種類で絞り込める） */}
      <div className="mt-4 flex justify-end">
        <a
          href={`/summary?ym=${ym}${factoryLocked ? "" : `&factory=${encodeURIComponent(factory)}`}`}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
        >
          <BarChart3 className="h-4 w-4" />
          月間集計を見る
        </a>
      </div>

    </div>
  );
}
