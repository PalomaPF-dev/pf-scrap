"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { thisMonthStr } from "@/lib/format";

/** YYYY-MM を n か月ずらす */
function shiftYm(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * 対象月の切替（前月 ◀ / 月選択 / ▶ 翌月 ＋ 今月へ）。
 * URL の ?ym= を書き換えてサーバー側で再取得する。
 */
export default function MonthNav({ ym, param = "ym" }: { ym: string; param?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function go(next: string) {
    const q = new URLSearchParams(searchParams.toString());
    q.set(param, next);
    router.push(`${pathname}?${q.toString()}`);
  }

  const btn =
    "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[#e5e5e5] bg-white text-[#555555] hover:bg-[#f7f7f5]";

  return (
    <div className="flex items-center gap-1.5">
      <button onClick={() => go(shiftYm(ym, -1))} className={btn} aria-label="前の月">
        <ChevronLeft className="h-5 w-5" />
      </button>
      <input
        type="month"
        value={ym}
        onChange={(e) => e.target.value && go(e.target.value)}
        aria-label="対象月"
        className="h-10 rounded-lg border border-[#e5e5e5] bg-white px-3 text-base focus:border-[#b4632c] focus:outline-none sm:text-sm"
      />
      <button onClick={() => go(shiftYm(ym, 1))} className={btn} aria-label="次の月">
        <ChevronRight className="h-5 w-5" />
      </button>
      {ym !== thisMonthStr() && (
        <button
          onClick={() => go(thisMonthStr())}
          className="h-10 shrink-0 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm text-[#555555] hover:bg-[#f7f7f5]"
        >
          今月
        </button>
      )}
    </div>
  );
}
