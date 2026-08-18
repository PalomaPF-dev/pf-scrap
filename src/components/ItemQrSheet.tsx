"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Printer } from "lucide-react";
import type { ScrapItem } from "@/lib/scrapTypes";

/** QRコード画像（値=品目KEY）。qrcode ライブラリでクライアント側生成。 */
function QrImage({ value, size = 110 }: { value: string; size?: number }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void import("qrcode").then((QRCode) =>
      QRCode.toDataURL(value, { width: size * 2, margin: 1 }).then((u: string) => {
        if (alive) setUrl(u);
      })
    );
    return () => {
      alive = false;
    };
  }, [value, size]);
  if (!url) return <div style={{ width: size, height: size }} className="bg-[#f0f0ee]" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={url} alt={value} width={size} height={size} />;
}

/**
 * 品目QRカード一覧。まず工場を選び、次に職場（製造場所）で絞り込んで印刷する。
 * 印刷レイアウトは1ページ4列。
 */
export default function ItemQrSheet({
  factory,
  factoryOptions,
  workplace,
  workplaces,
  groups,
}: {
  factory: string;
  factoryOptions: string[];
  workplace: string;
  workplaces: { name: string; count: number }[];
  groups: { workplace: string; items: ScrapItem[] }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function go(next: { factory?: string; workplace?: string }) {
    const q = new URLSearchParams(searchParams.toString());
    if (next.factory !== undefined) {
      q.set("factory", next.factory);
      q.delete("workplace"); // 工場を変えたら職場の絞り込みは解除
    }
    if (next.workplace !== undefined) {
      if (next.workplace) q.set("workplace", next.workplace);
      else q.delete("workplace");
    }
    router.push(`${pathname}?${q.toString()}`);
  }

  const chip = (active: boolean) =>
    `h-11 rounded-xl px-4 text-sm font-semibold ${
      active
        ? "bg-[#b4632c] text-white"
        : "border border-[#e5e5e5] bg-white text-[#555555] hover:bg-[#f7f7f5]"
    }`;

  const total = groups.reduce((t, g) => t + g.items.length, 0);

  return (
    <div>
      <div className="no-print mb-4 space-y-3">
        <div>
          <div className="mb-1.5 text-xs font-bold text-[#707070]">1. 工場を選ぶ</div>
          {factoryOptions.length === 0 ? (
            <p className="rounded-lg bg-[#fff3e0] px-3 py-2 text-sm text-[#a15c00]">
              工場が登録されていません。
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {factoryOptions.map((f) => (
                <button key={f} onClick={() => go({ factory: f })} className={chip(f === factory)}>
                  {f}
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="mb-1.5 text-xs font-bold text-[#707070]">2. 職場を選ぶ（任意）</div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => go({ workplace: "" })} className={chip(!workplace)}>
              すべて
            </button>
            {workplaces.map((w) => (
              <button
                key={w.name}
                onClick={() => go({ workplace: w.name })}
                className={chip(w.name === workplace)}
              >
                {w.name}（{w.count}）
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => window.print()}
            disabled={total === 0}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#b4632c] px-5 text-sm font-semibold text-white hover:bg-[#96521f] disabled:opacity-50"
          >
            <Printer className="h-4 w-4" />
            印刷（{total}品目）
          </button>
          <span className="text-xs text-[#909090]">
            印刷ダイアログで「PDFに保存」を選べばPDFとしても出力できます。
          </span>
        </div>
      </div>

      {groups.length === 0 && (
        <p className="text-sm text-[#707070]">
          該当する品目がありません。品目マスターに登録すると、ここにQR一覧が表示されます。
        </p>
      )}
      {groups.map((g) => (
        <section key={g.workplace} className="mb-8 break-inside-avoid">
          <h2 className="mb-3 border-b-2 border-[#b4632c] pb-1 text-base font-bold text-[#333333]">
            {factory}／{g.workplace}（{g.items.length}品目）
          </h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-4">
            {g.items.map((it) => (
              <div
                key={it.key}
                className="break-inside-avoid rounded-xl border border-[#e5e5e5] bg-white p-3 text-center"
              >
                <div className="flex justify-center">
                  <QrImage value={it.key} />
                </div>
                <div className="mt-1 text-sm font-bold text-[#333333]">{it.hinmei || it.key}</div>
                <div className="text-xs text-[#707070]">
                  {it.kanriZuban} ／ {it.kubun}
                </div>
                <div className="font-mono text-[10px] text-[#909090]">{it.key}</div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
