"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FA_STATUS_LABEL, type FaStatus } from "@/lib/scrapTypes";

/** 初品測定一覧の状態の絞り込み。URL の ?status= を書き換える（空＝すべて）。 */
export default function FirstListStatusFilter({ status }: { status: FaStatus | null }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <label className="flex items-center gap-1.5 text-xs text-[#707070]">
      状態
      <select
        value={status ?? ""}
        onChange={(e) => {
          const q = new URLSearchParams(searchParams.toString());
          if (e.target.value) q.set("status", e.target.value);
          else q.delete("status");
          router.push(`${pathname}?${q.toString()}`);
        }}
        className="h-10 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm focus:border-[#b4632c] focus:outline-none"
      >
        <option value="">すべて</option>
        {(Object.keys(FA_STATUS_LABEL) as FaStatus[]).map((k) => (
          <option key={k} value={k}>
            {FA_STATUS_LABEL[k]}
          </option>
        ))}
      </select>
    </label>
  );
}
