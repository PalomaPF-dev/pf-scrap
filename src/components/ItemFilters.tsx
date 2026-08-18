"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { X } from "lucide-react";

/**
 * 品目マスターの絞り込み（工場・製造場所）。
 * URL の ?factory= / ?workplace= を書き換えてサーバー側で絞り込む。
 * 工場を変えたら製造場所の選択は解除する（工場ごとに職場が違うため）。
 */
export default function ItemFilters({
  factory,
  factoryOptions,
  factoryLocked,
  workplace,
  workplaceOptions,
}: {
  factory: string;
  factoryOptions: string[];
  /** 所属工場が設定された人は自工場に固定（選び直せない） */
  factoryLocked: boolean;
  workplace: string;
  workplaceOptions: { name: string; count: number }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function go(next: { factory?: string; workplace?: string }) {
    const q = new URLSearchParams(searchParams.toString());
    if (next.factory !== undefined) {
      if (next.factory) q.set("factory", next.factory);
      else q.delete("factory");
      q.delete("workplace"); // 工場を変えたら職場の絞り込みは解除
    }
    if (next.workplace !== undefined) {
      if (next.workplace) q.set("workplace", next.workplace);
      else q.delete("workplace");
    }
    router.push(`${pathname}?${q.toString()}`);
  }

  const select =
    "h-10 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm focus:border-[#b4632c] focus:outline-none";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1.5 text-xs text-[#707070]">
        工場
        {factoryLocked ? (
          <span className="flex h-10 items-center rounded-lg border border-[#e5e5e5] bg-[#f7f7f5] px-3 text-sm text-[#333333]">
            {factory}
          </span>
        ) : (
          <select value={factory} onChange={(e) => go({ factory: e.target.value })} className={select}>
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
        )}
      </label>
      <label className="flex items-center gap-1.5 text-xs text-[#707070]">
        製造場所
        <select
          value={workplace}
          onChange={(e) => go({ workplace: e.target.value })}
          className={select}
        >
          <option value="">すべて</option>
          {!workplaceOptions.some((w) => w.name === workplace) && workplace !== "" && (
            <option value={workplace}>{workplace}</option>
          )}
          {workplaceOptions.map((w) => (
            <option key={w.name} value={w.name}>
              {w.name}（{w.count}）
            </option>
          ))}
        </select>
      </label>
      {(!factoryLocked && factory) || workplace ? (
        <button
          onClick={() => go(factoryLocked ? { workplace: "" } : { factory: "", workplace: "" })}
          className="inline-flex h-10 items-center gap-1 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm text-[#555555] hover:bg-[#f7f7f5]"
        >
          <X className="h-4 w-4" />
          絞り込み解除
        </button>
      ) : null}
    </div>
  );
}
