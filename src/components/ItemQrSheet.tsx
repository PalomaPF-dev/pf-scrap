"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Printer } from "lucide-react";
import { itemRef, type ScrapItem } from "@/lib/scrapTypes";

/** QRコード画像（値=品目KEY）。qrcode ライブラリでクライアント側生成。 */
function QrImage({ value, size = 88 }: { value: string; size?: number }) {
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

const td = "border border-[#333333] px-3 py-2 align-middle";
const th = "border border-[#333333] bg-[#f0f0ee] px-3 py-2 text-left font-bold whitespace-nowrap";

/**
 * 品目QR一覧。まず工場を選び、次に職場（製造場所）で絞り込んで印刷する。
 * 現場で見るのはQR・品名・管理図番だけなので、表形式でその3列に絞る。
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

  // 工場・職場が増えても並びが崩れないよう、タイルではなく選択式にする
  const select =
    "h-11 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 text-base focus:border-[#b4632c] focus:outline-none sm:h-10 sm:w-64 sm:text-sm";

  // total = いま表示している品目数（印刷ボタン用）。allCount = その工場の全品目数
  const total = groups.reduce((t, g) => t + g.items.length, 0);
  const allCount = workplaces.reduce((t, w) => t + w.count, 0);

  return (
    <div>
      <div className="no-print mb-4 space-y-3">
        {factoryOptions.length === 0 ? (
          <p className="rounded-lg bg-[#fff3e0] px-3 py-2 text-sm text-[#a15c00]">
            工場が登録されていません。
          </p>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
            <label className="flex flex-col gap-1 text-xs font-bold text-[#707070]">
              1. 工場を選ぶ
              <select
                value={factory}
                onChange={(e) => go({ factory: e.target.value })}
                className={select}
              >
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
            <label className="flex flex-col gap-1 text-xs font-bold text-[#707070]">
              2. 職場を選ぶ（任意）
              <select
                value={workplace}
                onChange={(e) => go({ workplace: e.target.value })}
                className={select}
              >
                <option value="">すべて（{allCount}品目）</option>
                {workplaces.map((w) => (
                  <option key={w.name} value={w.name}>
                    {w.name}（{w.count}）
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

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
        <section key={g.workplace} className="mb-8">
          <h2 className="mb-2 border-b-2 border-[#b4632c] pb-1 text-base font-bold text-[#333333]">
            {factory}／{g.workplace}（{g.items.length}品目）
          </h2>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={`${th} w-[120px] text-center`}>QRコード</th>
                <th className={th}>品名</th>
                <th className={`${th} w-[180px]`}>品目CD</th>
              </tr>
            </thead>
            <tbody>
              {g.items.map((it) => {
                // QRの値は「品目CD-格納場所CD」。同じ品目CDが工場ごとにあるため、
                // 品目CDだけでは読み取り側で1つに決められない。
                const ref = itemRef(it.kanriZuban, it.kakunoCD);
                return (
                  <tr key={ref} className="break-inside-avoid">
                    <td className={`${td} text-center`}>
                      <div className="flex justify-center">
                        <QrImage value={ref} />
                      </div>
                    </td>
                    <td className={`${td} text-base font-bold`}>{it.hinmei || it.kanriZuban}</td>
                    <td className={`${td} font-mono text-base`}>{it.kanriZuban}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}
