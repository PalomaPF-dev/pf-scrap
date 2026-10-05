"use client";

import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, X, ZoomIn } from "lucide-react";

/**
 * スライドに添える実画面のキャプチャ（public/guide/ に置く）。
 * width/height は画像の実寸。縦横比の枠を先に取って、読み込み中に表示が跳ねないようにする。
 */
export interface GuideShot {
  src: string;
  /** 画面に何が写っているか。読み上げと、画像が出ないときの代わりになる */
  alt: string;
  width: number;
  height: number;
  /**
   * PC画面のキャプチャ（横長・等倍）。スライドの幅いっぱいに出す。
   * 省略時はスマホ画面（幅390pxの2倍で撮ったもの）として扱う。
   */
  pc?: boolean;
}

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
  /**
   * 説明している画面の実物（1〜2枚）。文言（ボタン名など）は必ずこの画面と揃える。
   * 2枚のときは手順の順に並べる（例: カメラ画面 → 読み取ったあとの画面）。
   */
  shots?: GuideShot[];
}

/** 画像の表示上の幅（CSS px）。スマホ画面は2倍で撮っているので半分にする */
const cssWidth = (s: GuideShot) => (s.pc ? s.width : Math.round(s.width / 2));

/**
 * 実画面のキャプチャ1枚。スライドの中では縮めて出すので、押すと拡大表示を開く。
 * 画像は撮影時に縮小・WebP化してあるので、next/image の最適化は通さない。
 */
function Shot({ shot, onZoom }: { shot: GuideShot; onZoom: () => void }) {
  return (
    <button
      type="button"
      onClick={onZoom}
      aria-label={`拡大して見る: ${shot.alt}`}
      className="group relative block w-full rounded-xl bg-[#f0f0ee] p-2 text-left sm:p-2.5"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={shot.src}
        alt={shot.alt}
        width={shot.width}
        height={shot.height}
        decoding="async"
        className={`mx-auto block h-auto rounded-lg border border-[#e5e5e5] bg-white ${
          shot.pc ? "w-full" : "w-auto max-w-full max-h-[28rem] sm:max-h-[36rem]"
        }`}
      />
      <span className="pointer-events-none absolute right-3.5 bottom-3.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#333333]/70 text-white group-hover:bg-[#333333]/85">
        <ZoomIn className="h-4 w-4" />
      </span>
    </button>
  );
}

/**
 * 拡大表示。スマホでは画面いっぱいに原寸で出し、縦に（PC画面は横にも）スクロールして読む。
 * 閉じるのは × ・背景・Esc のどれでもよい。
 */
function Zoom({ shot, onClose }: { shot: GuideShot; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    // 後ろのページが一緒にスクロールしないようにする
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={shot.alt}
      className="fixed inset-0 z-50 flex flex-col bg-[#1b1b1b]"
      onClick={onClose}
    >
      <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-2.5 text-white">
        <p className="min-w-0 truncate text-sm">{shot.alt}</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="閉じる"
          autoFocus
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white/15 hover:bg-white/25"
        >
          <X className="h-6 w-6" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto px-4 pb-6">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={shot.src}
          alt={shot.alt}
          width={shot.width}
          height={shot.height}
          onClick={(e) => e.stopPropagation()}
          style={{ width: cssWidth(shot), maxWidth: shot.pc ? "none" : "100%" }}
          className="mx-auto block h-auto rounded-lg bg-white"
        />
      </div>
    </div>
  );
}

/**
 * 使い方ガイド（スライド送り）。
 *
 * 現場はスマホで見るので、1画面に1つのことだけを置く。
 * 各スライドには説明している画面の実物を添え、文言だけで画面を探させない。
 * 矢印キーでも送れるようにして、勉強会でPCから見せるときにも使えるようにする。
 */
export default function GuideSlides({ slides }: { slides: GuideSlide[] }) {
  const [i, setI] = useState(0);
  const [zoom, setZoom] = useState<GuideShot | null>(null);
  const last = slides.length - 1;

  const go = useCallback(
    (next: number) => setI((cur) => Math.min(last, Math.max(0, next === cur ? cur : next))),
    [last]
  );
  const closeZoom = useCallback(() => setZoom(null), []);

  useEffect(() => {
    // 拡大表示を開いている間は送らない（矢印キーで裏のスライドが変わると戸惑う）
    if (zoom) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight") setI((c) => Math.min(last, c + 1));
      if (e.key === "ArrowLeft") setI((c) => Math.max(0, c - 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [last, zoom]);

  // 次のスライドの画面を先に読んでおき、送ったときに画像が遅れて出ないようにする
  useEffect(() => {
    for (const sh of slides[i + 1]?.shots ?? []) new Image().src = sh.src;
  }, [i, slides]);

  const s = slides[i];
  const shots = s.shots ?? [];
  // スマホ画面のキャプチャは、PCでは説明の右に並べる（スマホでは見出しの下に置く）。
  // PC画面のキャプチャは横長なので、説明の下に幅いっぱいで出す。
  const side = shots.length > 0 && shots.every((sh) => !sh.pc);
  const sideCol =
    shots.length > 1 ? "sm:grid-cols-[minmax(0,1fr)_24rem]" : "sm:grid-cols-[minmax(0,1fr)_17rem]";
  const btn =
    "inline-flex h-12 items-center justify-center gap-1.5 rounded-xl px-5 text-base font-semibold disabled:opacity-40 sm:h-11 sm:text-sm";

  const figure = shots.length > 0 && (
    <figure
      className={`mt-4 min-w-0 ${side ? "sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:mt-0" : "sm:mt-6"}`}
    >
      <div className={`grid gap-2 ${shots.length > 1 ? "grid-cols-2" : ""}`}>
        {shots.map((sh) => (
          // key で差し替える。同じ要素を使い回すと、前のスライドの画像が一瞬残る
          <Shot key={sh.src} shot={sh} onZoom={() => setZoom(sh)} />
        ))}
      </div>
      <figcaption className="mt-1.5 text-center text-xs text-[#909090]">
        実際の画面（押すと拡大して見られます）
      </figcaption>
    </figure>
  );

  return (
    <div>
      {/* スライド本体。高さを揃えて、送っても位置が飛ばないようにする */}
      <section
        className={`rounded-2xl border border-[#e5e5e5] bg-white p-5 sm:min-h-[24rem] sm:p-8 ${
          side ? `sm:grid ${sideCol} sm:grid-rows-[auto_1fr] sm:gap-x-8` : ""
        }`}
      >
        <div className={side ? "min-w-0 sm:col-start-1 sm:row-start-1" : ""}>
          <p className="text-xs font-bold tracking-wide text-[#b4632c]">{s.eyebrow}</p>
          <h2 className="mt-1 text-xl font-bold text-[#333333] sm:text-2xl">{s.title}</h2>
          <p className="mt-2 text-sm text-[#555555]">{s.lead}</p>
        </div>

        {/* スマホでは見出しのすぐ下に画面を置き、何の画面の話かを先に見せる */}
        {side && figure}

        <div className={side ? "min-w-0 sm:col-start-1 sm:row-start-2" : ""}>
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
        </div>

        {/* PC画面は横長で縮むと読めないので、説明を読んだあとの位置に幅いっぱいで出す */}
        {!side && figure}
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

      {zoom && <Zoom shot={zoom} onClose={closeZoom} />}
    </div>
  );
}
