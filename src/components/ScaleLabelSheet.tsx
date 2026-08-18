"use client";

import { useEffect, useState } from "react";
import { Printer } from "lucide-react";
import type { Scale } from "@/lib/scrapTypes";

/** QRコード画像。qrcode ライブラリでクライアント側生成。 */
function QrImage({ value, size = 120 }: { value: string; size?: number }) {
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
 * 重量計のQRラベル一覧。工場・設備番号つきのラベルを並べて印刷する。
 * テプラで刷る場合は、一覧画面の「テプラ用CSV」を差し込み印刷に使う。
 */
export default function ScaleLabelSheet({ scales }: { scales: Scale[] }) {
  return (
    <div>
      <div className="no-print mb-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => window.print()}
          disabled={scales.length === 0}
          className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#b4632c] px-5 text-sm font-semibold text-white hover:bg-[#96521f] disabled:opacity-50"
        >
          <Printer className="h-4 w-4" />
          印刷（{scales.length}枚）
        </button>
        <span className="text-xs text-[#909090]">
          印刷ダイアログで「PDFに保存」を選べばPDFでも出力できます。
        </span>
      </div>

      {scales.length === 0 ? (
        <p className="text-sm text-[#707070]">
          対象の重量計がありません。重量計マスターから登録してください。
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 print:grid-cols-4">
          {scales.map((s) => (
            <div
              key={s.id}
              className="break-inside-avoid rounded-xl border border-[#333333] bg-white p-3 text-center"
            >
              <div className="text-xs font-bold text-[#707070]">{s.factory || "全工場"}</div>
              <div className="font-mono text-lg font-bold leading-tight text-[#333333]">
                {s.equipNo || "-"}
              </div>
              <div className="my-1.5 flex justify-center">
                <QrImage value={s.qrCode} />
              </div>
              <div className="text-sm font-bold text-[#333333]">{s.name}</div>
              <div className="text-xs text-[#707070]">{s.kind}</div>
              <div className="font-mono text-[10px] text-[#909090]">{s.qrCode}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
