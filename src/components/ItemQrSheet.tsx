"use client";

import { useEffect, useState } from "react";
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

/** 職場（製造場所）ごとの品目QRカード一覧。印刷向けレイアウト。 */
export default function ItemQrSheet({
  groups,
}: {
  groups: { workplace: string; items: ScrapItem[] }[];
}) {
  return (
    <div>
      <div className="no-print mb-4">
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#b4632c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#96521f]"
        >
          <Printer className="h-4 w-4" />
          印刷
        </button>
      </div>
      {groups.length === 0 && (
        <p className="text-sm text-[#707070]">
          品目がありません。品目マスターに登録すると、ここにQR一覧が表示されます。
        </p>
      )}
      {groups.map((g) => (
        <section key={g.workplace} className="mb-8 break-inside-avoid">
          <h2 className="mb-3 border-b-2 border-[#b4632c] pb-1 text-base font-bold text-[#333333]">
            {g.workplace}（{g.items.length}品目）
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
