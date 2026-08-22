"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * 月間集計の絞り込み（工場・スクラップ種類）。
 * URL の ?factory= / ?kind= を書き換えてサーバー側で取り直す。
 * 空文字は「すべて」。所属工場が設定された人は工場を選び直せない。
 */
export default function SummaryFilters({
  factory,
  factoryOptions,
  factoryLocked,
  kind,
  kindOptions,
}: {
  factory: string;
  factoryOptions: string[];
  factoryLocked: boolean;
  kind: string;
  kindOptions: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function go(param: "factory" | "kind", next: string) {
    const q = new URLSearchParams(searchParams.toString());
    if (next) q.set(param, next);
    else q.delete(param);
    router.push(`${pathname}?${q.toString()}`);
  }

  const select =
    "h-10 rounded-lg border border-[#e5e5e5] bg-white px-3 text-base focus:border-[#b4632c] focus:outline-none sm:text-sm";

  return (
    <>
      <label className="flex items-center gap-1.5 text-xs text-[#707070]">
        工場
        {factoryLocked ? (
          <span className="flex h-10 items-center rounded-lg border border-[#e5e5e5] bg-[#f7f7f5] px-3 text-sm text-[#333333]">
            {factory}
          </span>
        ) : (
          <select
            value={factory}
            onChange={(e) => go("factory", e.target.value)}
            aria-label="工場で絞り込む"
            className={select}
          >
            <option value="">すべて</option>
            {factoryOptions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        )}
      </label>

      <label className="flex items-center gap-1.5 text-xs text-[#707070]">
        種類
        <select
          value={kind}
          onChange={(e) => go("kind", e.target.value)}
          aria-label="種類で絞り込む"
          className={select}
        >
          <option value="">すべて</option>
          {kindOptions.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
