"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/** スライド1枚分の中身。ページ側でデータとして書く。 */
export interface GuideSlide {
  /** 見出しの上に出す小さなラベル（例「日次記録 ①」） */
  eyebrow: string;
  title: string;
  /** 見出しの下の1〜2行。何のための操作かを先に言う */
  lead: string;
  /** 手順・要点。番号は付けず、短く区切る */
  points: string[];
  /** 特に間違えやすい点。赤系で目立たせる */
  caution?: string;
}

/**
 * 使い方ガイド（スライド送り）。
 *
 * 現場はスマホで見るので、1画面に1つのことだけを置く。
 * 矢印キーでも送れるようにして、勉強会でPCから見せるときにも使えるようにする。
 */
export default function GuideSlides({ slides }: { slides: GuideSlide[] }) {
  const [i, setI] = useState(0);
  const last = slides.length - 1;

  const go = useCallback(
    (next: number) => setI((cur) => Math.min(last, Math.max(0, next === cur ? cur : next))),
    [last]
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") setI((c) => Math.min(last, c + 1));
      if (e.key === "ArrowLeft") setI((c) => Math.max(0, c - 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last]);

  const s = slides[i];
  const btn =
    "inline-flex h-12 items-center justify-center gap-1.5 rounded-xl px-5 text-base font-semibold disabled:opacity-40 sm:h-11 sm:text-sm";

  return (
    <div>
      {/* スライド本体。高さを揃えて、送っても位置が飛ばないようにする */}
      <section className="rounded-2xl border border-[#e5e5e5] bg-white p-5 sm:min-h-[24rem] sm:p-8">
        <p className="text-xs font-bold tracking-wide text-[#b4632c]">{s.eyebrow}</p>
        <h2 className="mt-1 text-xl font-bold text-[#333333] sm:text-2xl">{s.title}</h2>
        <p className="mt-2 text-sm text-[#555555]">{s.lead}</p>

        <ul className="mt-5 space-y-2.5">
          {s.points.map((p, n) => (
            <li key={n} className="flex gap-3 text-sm text-[#333333]">
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#faf6ef] text-xs font-bold text-[#b4632c]">
                {n + 1}
              </span>
              <span className="min-w-0 leading-relaxed">{p}</span>
            </li>
          ))}
        </ul>

        {s.caution && (
          <p className="mt-5 rounded-lg bg-[#fdecea] px-3 py-2.5 text-sm text-[#dc000c]">
            {s.caution}
          </p>
        )}
      </section>

      {/* 送り。スマホは親指が届く下側に置く */}
      <div className="mt-4 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => go(i - 1)}
          disabled={i === 0}
          className={`${btn} border border-[#e5e5e5] bg-white text-[#555555] hover:bg-[#f7f7f5]`}
        >
          <ChevronLeft className="h-5 w-5" />
          前へ
        </button>

        <span className="text-sm tabular-nums text-[#707070]">
          {i + 1} / {slides.length}
        </span>

        <button
          type="button"
          onClick={() => go(i + 1)}
          disabled={i === last}
          className={`${btn} bg-[#b4632c] text-white hover:bg-[#96521f]`}
        >
          次へ
          <ChevronRight className="h-5 w-5" />
        </button>
      </div>

      {/* 現在地。押せば直接そのページへ飛べる */}
      <div className="mt-3 flex flex-wrap justify-center gap-1.5">
        {slides.map((sl, n) => (
          <button
            key={n}
            type="button"
            onClick={() => go(n)}
            aria-label={`${n + 1}枚目: ${sl.title}`}
            aria-current={n === i}
            className={`h-2.5 rounded-full transition-all ${
              n === i ? "w-6 bg-[#b4632c]" : "w-2.5 bg-[#e5e5e5] hover:bg-[#c9c9c9]"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
