"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { todayStr } from "@/lib/format";

/** YYYY-MM-DD を n 日ずらす */
function shiftDate(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(y, m - 1, d + n);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(
    t.getDate()
  ).padStart(2, "0")}`;
}

/** 対象日の切替（前日 ◀ / 日付選択 / ▶ 翌日 ＋ 今日へ）。URL の ?date= を書き換える。 */
export default function DateNav({ date, param = "date" }: { date: string; param?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function go(next: string) {
    const q = new URLSearchParams(searchParams.toString());
    q.set(param, next);
    router.push(`${pathname}?${q.toString()}`);
  }

  const btn =
    "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#e5e5e5] bg-white text-[#555555] hover:bg-[#f7f7f5]";

  return (
    <div className="flex items-center gap-1.5">
      <button onClick={() => go(shiftDate(date, -1))} className={btn} aria-label="前の日">
        <ChevronLeft className="h-5 w-5" />
      </button>
      <input
        type="date"
        value={date}
        onChange={(e) => e.target.value && go(e.target.value)}
        aria-label="対象日"
        className="h-11 min-w-0 flex-1 rounded-lg border border-[#e5e5e5] bg-white px-3 text-base focus:border-[#b4632c] focus:outline-none sm:flex-none sm:text-sm"
      />
      <button onClick={() => go(shiftDate(date, 1))} className={btn} aria-label="次の日">
        <ChevronRight className="h-5 w-5" />
      </button>
      {date !== todayStr() && (
        <button
          onClick={() => go(todayStr())}
          className="h-11 shrink-0 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm text-[#555555] hover:bg-[#f7f7f5]"
        >
          今日
        </button>
      )}
    </div>
  );
}
