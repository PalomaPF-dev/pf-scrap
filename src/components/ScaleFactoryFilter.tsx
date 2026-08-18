"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** 重量計マスターの工場絞り込み。URL の ?factory= を書き換える。 */
export default function ScaleFactoryFilter({
  factory,
  factoryOptions,
}: {
  factory: string;
  factoryOptions: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function go(next: string) {
    const q = new URLSearchParams(searchParams.toString());
    if (next) q.set("factory", next);
    else q.delete("factory");
    router.push(`${pathname}?${q.toString()}`);
  }

  return (
    <label className="flex items-center gap-1.5 text-xs text-[#707070]">
      工場
      <select
        value={factory}
        onChange={(e) => go(e.target.value)}
        className="h-10 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm focus:border-[#b4632c] focus:outline-none"
      >
        <option value="">すべて</option>
        {!factoryOptions.includes(factory) && factory !== "" && (
          <option value={factory}>{factory}</option>
        )}
        {factoryOptions.map((f) => (
          <option key={f} value={f}>
            {f}
          </option>
        ))}
      </select>
    </label>
  );
}
