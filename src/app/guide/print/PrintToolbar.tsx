"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Printer } from "lucide-react";

/**
 * 印刷用ページの上の帯（紙には出さない）。
 * 開いたら、写真と文字（フォント）の読み込みが終わるのを待って印刷画面を自動で開く
 * （読み込み前に開くと、写真が抜けた PDF になる）。閉じたあとでも「印刷する」で開き直せる。
 */
export default function PrintToolbar() {
  const [ready, setReady] = useState(false);
  const printed = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>(".guide-print img"));
    const waitImg = (img: HTMLImageElement) =>
      img.complete
        ? Promise.resolve()
        : new Promise<void>((r) => {
            img.addEventListener("load", () => r(), { once: true });
            img.addEventListener("error", () => r(), { once: true });
          });
    // 読み込めない写真があっても止めない（長くても15秒で開く）
    const timeout = new Promise<void>((r) => setTimeout(r, 15000));
    void Promise.race([Promise.all([...imgs.map(waitImg), document.fonts.ready]), timeout]).then(() => {
      if (cancelled) return;
      setReady(true);
      if (printed.current) return;
      printed.current = true;
      // 描画が落ち着いてから開く
      setTimeout(() => !cancelled && window.print(), 300);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="no-print sticky top-0 z-10 border-b border-[#e5e5e5] bg-white/95 px-4 py-2.5 backdrop-blur">
      <div className="mx-auto flex max-w-[186mm] flex-wrap items-center gap-2">
        <Link
          href="/guide"
          className="inline-flex h-11 items-center gap-1 rounded-xl border border-[#cfcac3] bg-white px-3 text-sm text-[#555555] hover:bg-[#f7f7f5]"
        >
          <ArrowLeft className="h-4 w-4" />
          使い方に戻る
        </Link>
        <button
          type="button"
          onClick={() => window.print()}
          disabled={!ready}
          className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-[#b4632c] px-4 text-sm font-bold text-white hover:bg-[#96521f] disabled:opacity-50"
        >
          <Printer className="h-4 w-4" />
          {ready ? "印刷する（PDFに保存）" : "写真を読み込み中…"}
        </button>
        <p className="w-full text-xs leading-5 text-[#555555] sm:w-auto sm:grow">
          印刷画面で<b>『PDFに保存』</b>を選んでください（スマホは印刷画面の共有ボタンから
          <b>「ファイルに保存」</b>など）。用紙はA4縦です。
        </p>
      </div>
    </div>
  );
}
