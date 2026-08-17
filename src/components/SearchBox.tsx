"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";

/** 検索ボックス（入力を300msデバウンスして URL の ?q= を書き換える）。 */
export default function SearchBox({ q, placeholder }: { q: string; placeholder: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [value, setValue] = useState(q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  function onChange(v: string) {
    setValue(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (v.trim()) params.set("q", v.trim());
      else params.delete("q");
      router.replace(`${pathname}?${params.toString()}`);
    }, 300);
  }

  return (
    <div className="relative max-w-xl">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#909090]" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-[#e5e5e5] bg-white py-2 pl-9 pr-3 text-sm focus:border-[#b4632c] focus:outline-none"
      />
    </div>
  );
}
