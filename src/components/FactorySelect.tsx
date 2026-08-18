"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** 照合ダッシュボードの工場切替（空=全社合算）。URL の ?factory= を書き換える。 */
export default function FactorySelect({
  factory,
  options,
}: {
  factory: string;
  options: string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <select
      value={factory}
      onChange={(e) => {
        const q = new URLSearchParams(searchParams.toString());
        if (e.target.value) q.set("factory", e.target.value);
        else q.delete("factory");
        router.push(`${pathname}?${q.toString()}`);
      }}
      className="rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm focus:border-[#b4632c] focus:outline-none"
    >
      <option value="">全社（合算）</option>
      {options.map((f) => (
        <option key={f} value={f}>
          {f}
        </option>
      ))}
    </select>
  );
}
