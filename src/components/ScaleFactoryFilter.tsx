"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * 重量計マスターの工場絞り込み。URL の ?factory= を書き換える。
 * 所属工場の人・上部のバーで工場を選んだ人は、その工場に固定して表示だけにする。
 */
export default function ScaleFactoryFilter({
  factory,
  factoryOptions,
  factoryLocked,
}: {
  factory: string;
  factoryOptions: string[];
  /** 所属工場・上部で選んだ工場に固定（ここでは選び直せない） */
  factoryLocked: boolean;
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

  if (factoryLocked) {
    return (
      <label className="flex items-center gap-1.5 text-xs text-[#707070]">
        工場
        <span className="flex h-10 items-center rounded-lg border border-[#e5e5e5] bg-[#f7f7f5] px-3 text-sm text-[#333333]">
          {factory}
        </span>
      </label>
    );
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
