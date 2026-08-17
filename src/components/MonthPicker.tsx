"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** 対象月の切替（URL の ?ym= を書き換えてサーバー側で再集計する）。 */
export default function MonthPicker({ ym, param = "ym" }: { ym: string; param?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <input
      type="month"
      value={ym}
      onChange={(e) => {
        if (!e.target.value) return;
        const q = new URLSearchParams(searchParams.toString());
        q.set(param, e.target.value);
        router.push(`${pathname}?${q.toString()}`);
      }}
      className="rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm focus:border-[#b4632c] focus:outline-none"
    />
  );
}
