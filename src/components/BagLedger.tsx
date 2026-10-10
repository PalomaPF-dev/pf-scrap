"use client";

import { useMemo, useState } from "react";
import { bagGap, bagWeight, type ScrapBag } from "@/lib/scrapTypes";
import { fmt } from "@/lib/format";
import { ScrapBagList, type PanelMessage } from "@/components/ScrapBagPanel";

/**
 * 袋の台帳（月単位）。紙の記入用紙・Excelの1枚に対応する単位で並べる。
 * 承認と締め値の訂正は日次記録と同じ操作をここからも行えるようにする
 * （月末にまとめて確認するときに、日をめくり直さずに済む）。
 */
export default function BagLedger({ bags, isAdmin }: { bags: ScrapBag[]; isAdmin: boolean }) {
  const [, setMessage] = useState<PanelMessage | null>(null);

  const sum = useMemo(() => {
    let weight = 0;
    let recorded = 0;
    let gap = 0;
    let closed = 0;
    let approved = 0;
    let open = 0;
    for (const b of bags) {
      const w = bagWeight(b);
      if (w !== null) weight += w;
      recorded += b.totalWeight ?? b.runningTotal;
      const g = bagGap(b);
      if (g !== null) gap += g;
      if (b.status === "approved") approved++;
      else if (b.status === "closed") closed++;
      else open++;
    }
    return { weight, recorded, gap, closed, approved, open };
  }, [bags]);

  return (
    <div className="space-y-3 sm:space-y-4">
      <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl bg-[#faf6ef] px-3 py-2.5">
            <div className="text-xs text-[#707070]">袋の重量 合計</div>
            <div className="text-lg font-bold tabular-nums">{fmt(sum.weight)} kg</div>
          </div>
          <div className="rounded-xl bg-[#f7f7f5] px-3 py-2.5">
            <div className="text-xs text-[#707070]">記録した投入 合計</div>
            <div className="text-lg font-bold tabular-nums">{fmt(sum.recorded)} kg</div>
          </div>
          <div className="rounded-xl bg-[#f7f7f5] px-3 py-2.5">
            <div className="text-xs text-[#707070]">差の合計</div>
            <div
              className={`text-lg font-bold tabular-nums ${
                Math.abs(sum.gap) > 0.05 ? "text-[#dc000c]" : ""
              }`}
            >
              {fmt(sum.gap)} kg
            </div>
          </div>
          <div className="rounded-xl bg-[#f7f7f5] px-3 py-2.5">
            <div className="text-xs text-[#707070]">袋の数</div>
            <div className="text-lg font-bold tabular-nums">{bags.length}</div>
            <div className="text-xs text-[#909090]">
              承認 {sum.approved} ／ 承認待ち {sum.closed} ／ 記録中 {sum.open}
            </div>
          </div>
        </div>
        <p className="mt-2 text-xs text-[#909090]">
          袋の重量は締めの表示値から出しています。締める前の袋（記録中）は重量が決まっていないため、
          合計には入りません。
        </p>
      </section>

      <ScrapBagList bags={bags} isAdmin={isAdmin} onMessage={setMessage} />
    </div>
  );
}
