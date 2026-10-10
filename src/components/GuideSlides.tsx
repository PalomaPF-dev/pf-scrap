"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, X, ZoomIn } from "lucide-react";
import type { GuidePart, GuideShot, GuideSlide, GuideTone } from "@/lib/guideSlides";

/**
 * 使い方ガイドのスライドの描き方。中身（文章・画面写真・画面の見方）は lib/guideSlides.ts。
 *
 * 1枚のスライドを、置く場所に合わせて3通りに描く（GuideSlideBody の variant）:
 * - page  … 使い方ページ（/guide）。PCでは説明の右に画面写真を並べる
 * - panel … 作業しながら見るガイドの枠（GuidePanel.tsx）。枠は狭いので1列に縦へ並べる
 *           （画面幅で効く sm: の段組みは、枠の中では使えない）
 * - print … 印刷用ページ（/guide/print）。「画面の見方」は全部開き、写真は紙の大きさで出す
 */

const TONE_CLASS: Record<GuideTone, string> = {
  read: "rounded-lg bg-[#0b5ca8] px-2.5 py-1 text-white",
  action: "rounded-lg bg-[#b4632c] px-2.5 py-1 text-white",
  approve: "rounded-lg bg-[#2f6b2f] px-2.5 py-1 text-white",
  sub: "rounded-lg border border-[#cfcac3] bg-white px-2.5 py-0.5 text-[#555555]",
  subAccent: "rounded-lg border border-[#b4632c] bg-white px-2.5 py-0.5 text-[#b4632c]",
  danger: "rounded-lg border border-[#dc000c] bg-white px-2.5 py-0.5 text-[#dc000c]",
  selected: "rounded-lg bg-[#333333] px-2.5 py-1 text-white",
  ok: "rounded-md bg-[#eef4ee] px-2 py-0.5 text-[#2f6b2f]",
  wait: "rounded-md bg-[#fff3e0] px-2 py-0.5 text-[#a15c00]",
  ng: "rounded-md bg-[#fdecea] px-2 py-0.5 text-[#dc000c]",
  draft: "rounded-md bg-[#eeeeee] px-2 py-0.5 text-[#555555]",
  open: "rounded-md bg-[#faf6ef] px-2 py-0.5 text-[#b4632c]",
  ai: "rounded-md bg-[#eef1f4] px-2 py-0.5 text-[#0b5ca8]",
  poly: "rounded-md bg-[#e8f0f8] px-2 py-0.5 text-[#0b5ca8]",
  alert: "text-[#dc000c]",
};

export type GuideSlideVariant = "page" | "panel" | "print";

/** 画像の表示上の幅（CSS px）。スマホ画面は2倍で撮っているので半分にする */
const cssWidth = (s: GuideShot) => (s.pc ? s.width : Math.round(s.width / 2));

/**
 * 実画面のキャプチャ1枚。スライドの中では縮めて出すので、押すと拡大表示を開く。
 * 画像は撮影時に縮小・WebP化してあるので、next/image の最適化は通さない。
 */
function Shot({
  shot,
  onZoom,
  compact,
}: {
  shot: GuideShot;
  onZoom: () => void;
  /** ガイドの枠の中（狭い・低い）。スマホ画面の写真を低めに抑える */
  compact?: boolean;
}) {
  const phoneSize = compact ? "max-h-[20rem]" : "max-h-[28rem] sm:max-h-[36rem]";
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
          shot.pc ? "w-full" : `w-auto max-w-full ${phoneSize}`
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
 * 写真を読むための一時的な表示なので、これだけはモーダル（ガイドの枠から開いたときも同じ）。
 */
export function Zoom({ shot, onClose }: { shot: GuideShot; onClose: () => void }) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        // ガイドの枠の Esc（枠を閉じる）まで届かないようにする
        e.stopPropagation();
        onClose();
      }
    }
    // 捕捉段階で受け、枠の中にフォーカスがあっても拡大表示だけを閉じる
    window.addEventListener("keydown", onKey, true);
    // 後ろのページが一緒にスクロールしないようにする
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey, true);
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

/** 「画面の見方」の各行（見出しは画面の文言・札の形、その下に説明） */
function PartLabel({ part }: { part: GuidePart }) {
  return part.tone ? (
    <span className={`inline-block text-[13px] font-bold ${TONE_CLASS[part.tone]}`}>{part.label}</span>
  ) : (
    <>{part.label}</>
  );
}

/**
 * 画面の見方（各部の意味）。開閉できる欄に、見出し（画面の文言・札の形）と説明を並べる。
 * 開いた状態は送っても保つ（1枚ずつ開き直させない）。
 */
function Parts({
  parts,
  open,
  onToggle,
}: {
  parts: GuidePart[];
  open: boolean;
  onToggle: (open: boolean) => void;
}) {
  return (
    <details
      open={open}
      onToggle={(e) => onToggle(e.currentTarget.open)}
      className="group mt-5 rounded-xl border border-[#e5e5e5] bg-[#fafaf8]"
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-sm font-bold text-[#333333] [&::-webkit-details-marker]:hidden">
        <span>
          画面の見方
          <span className="ml-1.5 text-xs font-normal text-[#707070]">
            ボタン・表示の意味（{parts.length}項目）
          </span>
        </span>
        <ChevronDown className="h-5 w-5 shrink-0 text-[#b4632c] transition-transform group-open:rotate-180" />
      </summary>
      <dl className="divide-y divide-[#eeeeee] border-t border-[#e5e5e5] px-4">
        {parts.map((pt, n) => (
          <div key={n} className="py-2.5">
            <dt className="text-sm font-bold leading-relaxed text-[#333333]">
              <PartLabel part={pt} />
            </dt>
            <dd className="mt-1 text-sm leading-relaxed text-[#555555]">{pt.text}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

/** 手順・要点（番号付き） */
function Points({ points }: { points: string[] }) {
  return (
    <ul className="mt-5 space-y-2.5">
      {points.map((p, n) => (
        <li key={n} className="guide-keep flex gap-3 text-sm text-[#333333]">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#faf6ef] text-xs font-bold text-[#b4632c]">
            {n + 1}
          </span>
          <span className="min-w-0 leading-relaxed">{p}</span>
        </li>
      ))}
    </ul>
  );
}

function Caution({ text }: { text: string }) {
  return (
    <p className="guide-keep mt-5 rounded-lg bg-[#fdecea] px-3 py-2.5 text-sm text-[#dc000c]">{text}</p>
  );
}

/**
 * スライド1枚分の本文（見出し・画面写真・手順・注意・画面の見方）。
 * 使い方ページとガイドの枠で同じものを使う（印刷は GuideSlidesPrint）。
 */
export function GuideSlideBody({
  slide: s,
  variant,
  partsOpen,
  onPartsToggle,
  onZoom,
}: {
  slide: GuideSlide;
  variant: Exclude<GuideSlideVariant, "print">;
  partsOpen: boolean;
  onPartsToggle: (open: boolean) => void;
  onZoom: (shot: GuideShot) => void;
}) {
  const shots = s.shots ?? [];
  const parts = s.parts && s.parts.length > 0 && (
    <Parts parts={s.parts} open={partsOpen} onToggle={onPartsToggle} />
  );

  if (variant === "panel") {
    // 枠は狭いので、見出し → 画面 → 手順 → 注意 → 画面の見方 を1列に並べる
    return (
      <article aria-labelledby={`guide-panel-slide-${s.id}`}>
        <p className="text-xs font-bold tracking-wide text-[#b4632c]">{s.eyebrow}</p>
        <h3 id={`guide-panel-slide-${s.id}`} className="mt-0.5 text-lg font-bold leading-snug text-[#333333]">
          {s.title}
        </h3>
        <p className="mt-1.5 text-sm text-[#555555]">{s.lead}</p>
        {shots.length > 0 && (
          <figure className="mt-3">
            <div className={`grid gap-2 ${shots.length > 1 ? "grid-cols-2" : ""}`}>
              {shots.map((sh) => (
                <Shot key={sh.src} shot={sh} compact onZoom={() => onZoom(sh)} />
              ))}
            </div>
            <figcaption className="mt-1 text-center text-xs text-[#909090]">
              実際の画面（押すと拡大）
            </figcaption>
          </figure>
        )}
        <Points points={s.points} />
        {s.caution && <Caution text={s.caution} />}
        {parts}
      </article>
    );
  }

  // スマホ画面のキャプチャは、PCでは説明の右に並べる（スマホでは見出しの下に置く）。
  // PC画面のキャプチャは横長なので、説明の下に幅いっぱいで出す。
  const side = shots.length > 0 && shots.every((sh) => !sh.pc);
  const sideCol =
    shots.length > 1 ? "sm:grid-cols-[minmax(0,1fr)_24rem]" : "sm:grid-cols-[minmax(0,1fr)_17rem]";

  const figure = shots.length > 0 && (
    <figure
      className={`mt-4 min-w-0 ${side ? "sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:mt-0" : "sm:mt-6"}`}
    >
      <div className={`grid gap-2 ${shots.length > 1 ? "grid-cols-2" : ""}`}>
        {shots.map((sh) => (
          // key で差し替える。同じ要素を使い回すと、前のスライドの画像が一瞬残る
          <Shot key={sh.src} shot={sh} onZoom={() => onZoom(sh)} />
        ))}
      </div>
      <figcaption className="mt-1.5 text-center text-xs text-[#909090]">
        実際の画面（押すと拡大して見られます）
      </figcaption>
    </figure>
  );

  return (
    // スライド本体。高さを揃えて、送っても位置が飛ばないようにする
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
        <Points points={s.points} />
        {s.caution && <Caution text={s.caution} />}
        {parts}
      </div>

      {/* PC画面は横長で縮むと読めないので、説明を読んだあとの位置に幅いっぱいで出す */}
      {!side && figure}
    </section>
  );
}

/** 印刷の写真の大きさ（mm）。紙の幅（A4 縦の余白を除いて 186mm）に収め、1枚がページをまたがないようにする */
const PRINT_MM = {
  /** スマホ画面1枚: 説明の右に並べる列の幅と、高さの上限 */
  phone: { w: 60, h: 165 },
  /** スマホ画面2枚: 説明の下に横に並べる */
  phonePair: { w: 64, h: 125 },
  /** PC画面: 説明の下に幅いっぱい */
  pc: { w: 186, h: 180 },
} as const;

/** 縦横比を保ったまま、幅と高さの上限の両方に収まる幅（mm） */
function printWidthMm(shot: GuideShot, box: { w: number; h: number }): number {
  return Math.min(box.w, (box.h * shot.width) / shot.height);
}

function PrintShot({ shot, box }: { shot: GuideShot; box: { w: number; h: number } }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={shot.src}
      alt={shot.alt}
      width={shot.width}
      height={shot.height}
      style={{ width: `${printWidthMm(shot, box).toFixed(1)}mm` }}
      className="guide-shot block h-auto rounded border border-[#d9d9d9] bg-white"
    />
  );
}

/**
 * 印刷用（/guide/print）。全スライドを順に縦に並べ、「画面の見方」はすべて開いて出す。
 * 改ページ・写真の途中で切らない指定は印刷用ページの CSS（.guide-slide など）で行う。
 */
export function GuideSlidesPrint({ slides }: { slides: GuideSlide[] }) {
  return (
    <>
      {slides.map((s, n) => {
        const shots = s.shots ?? [];
        const phones = shots.filter((sh) => !sh.pc);
        const pcs = shots.filter((sh) => sh.pc);
        const sidePhone = phones.length === 1;
        return (
          <article key={s.id} id={s.id} className="guide-slide">
            <div className="guide-keep-next">
              <p className="text-xs font-bold tracking-wide text-[#b4632c]">
                {n + 1} / {slides.length}　{s.eyebrow}
              </p>
              <h2 className="mt-1 text-xl font-bold text-[#333333]">{s.title}</h2>
              <p className="mt-1.5 text-sm text-[#555555]">{s.lead}</p>
            </div>

            <div className={sidePhone ? "flex items-start gap-[6mm]" : ""}>
              <div className="min-w-0 flex-1">
                <Points points={s.points} />
                {s.caution && <Caution text={s.caution} />}
              </div>
              {sidePhone && (
                <figure className="mt-5 shrink-0">
                  <PrintShot shot={phones[0]} box={PRINT_MM.phone} />
                </figure>
              )}
            </div>

            {phones.length > 1 && (
              <figure className="mt-5 flex items-start justify-center gap-[6mm]">
                {phones.map((sh) => (
                  <PrintShot key={sh.src} shot={sh} box={PRINT_MM.phonePair} />
                ))}
              </figure>
            )}
            {pcs.map((sh) => (
              <figure key={sh.src} className="mt-5 flex justify-center">
                <PrintShot shot={sh} box={PRINT_MM.pc} />
              </figure>
            ))}

            {s.parts && s.parts.length > 0 && (
              <section className="mt-6">
                <h3 className="guide-keep-next border-b border-[#e5e5e5] pb-1 text-sm font-bold text-[#333333]">
                  画面の見方
                  <span className="ml-1.5 text-xs font-normal text-[#707070]">
                    ボタン・表示の意味（{s.parts.length}項目）
                  </span>
                </h3>
                <dl className="divide-y divide-[#eeeeee]">
                  {s.parts.map((pt, k) => (
                    <div key={k} className="guide-keep grid grid-cols-[58mm_minmax(0,1fr)] gap-x-[4mm] py-1.5">
                      <dt className="text-[13px] font-bold leading-relaxed text-[#333333]">
                        <PartLabel part={pt} />
                      </dt>
                      <dd className="text-[13px] leading-relaxed text-[#555555]">{pt.text}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
          </article>
        );
      })}
    </>
  );
}

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

/** URL の # のあと（スライドの id）。壊れた表記は無視する */
function readHash(): string {
  try {
    return decodeURIComponent(window.location.hash.slice(1));
  } catch {
    return "";
  }
}

/**
 * 使い方ガイド（スライド送り）。
 *
 * 現場はスマホで見るので、1画面に1つのことだけを置く。
 * 各スライドには説明している画面の実物を添え、文言だけで画面を探させない。
 * 矢印キーでも送れるようにして、勉強会でPCから見せるときにも使えるようにする。
 * URL の #id（例 /guide#daily-read-before）でそのスライドから開ける（ガイドの枠の「使い方を全部見る」）。
 */
export default function GuideSlides({ slides }: { slides: GuideSlide[] }) {
  const [i, setI] = useState(0);
  const [zoom, setZoom] = useState<GuideShot | null>(null);
  // 「画面の見方」を開いているか。スライドを送っても開いたまま（閉じたまま）にする
  const [partsOpen, setPartsOpen] = useState(false);
  const last = slides.length - 1;

  const go = useCallback(
    (next: number) => setI((cur) => Math.min(last, Math.max(0, next === cur ? cur : next))),
    [last]
  );
  const closeZoom = useCallback(() => setZoom(null), []);

  // #id で開いたら、そのスライドから見せる（開いたあとに #id が変わったときも同じ）。
  // サーバーの描画では # が分からないので、ブラウザで読んだ値と食い違ったときに合わせる
  const hash = useSyncExternalStore(subscribeHash, readHash, () => "");
  const [seenHash, setSeenHash] = useState("");
  if (hash !== seenHash) {
    setSeenHash(hash);
    const n = slides.findIndex((sl) => sl.id === hash);
    if (n >= 0) setI(n);
  }

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
  const btn =
    "inline-flex h-12 items-center justify-center gap-1.5 rounded-xl px-5 text-base font-semibold disabled:opacity-40 sm:h-11 sm:text-sm";

  return (
    <div>
      <GuideSlideBody
        slide={s}
        variant="page"
        partsOpen={partsOpen}
        onPartsToggle={setPartsOpen}
        onZoom={setZoom}
      />

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
