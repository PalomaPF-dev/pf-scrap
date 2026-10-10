"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { BookOpen, ChevronLeft, ChevronRight, ExternalLink, FileDown } from "lucide-react";
import { GuideSlideBody, Zoom } from "./GuideSlides";
import { guideSlidesFor, type GuideShot } from "@/lib/guideSlides";
import { GUIDE_PRINT_PATH, type GuideAudience, type GuideSlideId } from "@/lib/guideMap";

/**
 * ガイドの枠（GuidePanel.tsx）の中身。枠を開いたときに読み込む。
 * 使い方ページと同じスライド（lib/guideSlides.ts）を、同じ描き方（GuideSlideBody）の
 * 枠向けの形（variant="panel"）で1枚ずつ出す。
 *
 * 上から: 見出しの帯（たたんだときはここだけ）→ スライドの選択と前後の送り → 本文 → 使い方ページ・PDF
 */
export default function GuidePanelContent({
  audience,
  slideId,
  select,
  routeIds,
  follow,
  minimized,
  onExpand,
  controls,
  focusOnOpenRef,
}: {
  audience: GuideAudience;
  slideId: GuideSlideId;
  select: (id: GuideSlideId) => void;
  /** いまの画面を説明しているスライド（その人に出すものだけ） */
  routeIds: GuideSlideId[];
  follow: boolean;
  /** スマホでたたんでいる（帯だけ） */
  minimized: boolean;
  onExpand: () => void;
  /** 大きさの切り替え・閉じる（枠の側で作る） */
  controls: React.ReactNode;
  focusOnOpenRef: React.RefObject<boolean>;
}) {
  const slides = useMemo(() => guideSlidesFor(audience), [audience]);
  const found = slides.findIndex((s) => s.id === slideId);
  const i = found < 0 ? 0 : found;
  const s = slides[i];
  const [zoom, setZoom] = useState<GuideShot | null>(null);
  const closeZoom = useCallback(() => setZoom(null), []);
  // 「画面の見方」を開いているか。スライドを送っても開いたまま（閉じたまま）にする
  const [partsOpen, setPartsOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);

  // スライドを替えたら先頭から（同じスライドのまま画面を移ったときは、読んでいた所を保つ）
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0 });
  }, [s.id]);

  // 「ガイド」ボタンで開いたときは、枠の見出しへ移る（読み上げで枠が開いたことが分かるように）
  useEffect(() => {
    if (focusOnOpenRef.current) {
      focusOnOpenRef.current = false;
      titleRef.current?.focus();
    }
  }, [focusOnOpenRef]);

  const offer = !follow && routeIds.length > 0 && !routeIds.includes(s.id) ? routeIds[0] : null;
  const navBtn =
    "inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#e5e5e5] bg-white text-[#555555] hover:bg-[#f7f7f5] disabled:opacity-40";

  return (
    <>
      {/* 見出しの帯。たたんでいる間は、いま出しているスライドの見出しを出し、押すと広げる */}
      <div className={`flex shrink-0 items-center gap-1 pl-3 pr-1 ${minimized ? "" : "border-b border-[#e5e5e5]"}`}>
        <BookOpen className="h-4 w-4 shrink-0 text-[#b4632c]" aria-hidden="true" />
        <h2
          id="guide-panel-title"
          ref={titleRef}
          tabIndex={-1}
          className="min-w-0 grow text-sm font-bold text-[#333333] outline-none"
        >
          {minimized ? (
            <button
              type="button"
              onClick={onExpand}
              className="flex h-11 w-full min-w-0 items-center gap-2 text-left"
              aria-label={`ガイドを広げる（${s.eyebrow}: ${s.title}）`}
            >
              <span className="shrink-0">ガイド</span>
              <span className="min-w-0 truncate text-xs font-normal text-[#555555]">
                {s.eyebrow}・{s.title}
              </span>
            </button>
          ) : (
            <span className="flex h-11 items-center">ガイド</span>
          )}
        </h2>
        {controls}
      </div>

      {/* 本文以下（たたんでいる間も消さず、読んでいた所を保つ） */}
      <div hidden={minimized} className="flex min-h-0 grow flex-col">
        {/* スライドの選択と前後の送り */}
        <div className="shrink-0 space-y-1.5 border-b border-[#e5e5e5] px-3 py-2">
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => select(slides[i - 1].id)}
              disabled={i === 0}
              aria-label="前のスライド"
              className={navBtn}
            >
              <ChevronLeft className="h-5 w-5" />
            </button>
            <label className="min-w-0 grow">
              <span className="sr-only">表示する説明</span>
              <select
                value={s.id}
                onChange={(e) => select(e.target.value as GuideSlideId)}
                className="h-11 w-full min-w-0 rounded-lg border border-[#cfcac3] bg-white px-2 text-sm text-[#333333]"
              >
                {slides.map((sl, n) => (
                  <option key={sl.id} value={sl.id}>
                    {n + 1}. {sl.eyebrow}：{sl.title}
                    {routeIds.includes(sl.id) ? "（この画面）" : ""}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              onClick={() => select(slides[i + 1].id)}
              disabled={i === slides.length - 1}
              aria-label="次のスライド"
              className={navBtn}
            >
              <ChevronRight className="h-5 w-5" />
            </button>
          </div>
          {offer && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-[#faf6ef] px-2.5 py-1.5 text-xs text-[#8a4a1f]">
              <span className="grow">この画面の説明は「{slides.find((x) => x.id === offer)?.eyebrow}」です</span>
              <button
                type="button"
                onClick={() => select(offer)}
                className="h-9 rounded-lg border border-[#b4632c] bg-white px-3 font-bold text-[#b4632c] hover:bg-[#faf6ef]"
              >
                切り替える
              </button>
            </p>
          )}
          {routeIds.length === 0 && (
            <p className="text-[11px] leading-4 text-[#909090]">
              この画面だけの説明はありません。上の選択で、ほかの画面の説明を見られます。
            </p>
          )}
        </div>

        <div ref={bodyRef} className="min-h-0 grow overflow-y-auto overscroll-contain px-4 py-3">
          <p className="mb-1 text-[11px] tabular-nums text-[#909090]">
            {i + 1} / {slides.length}
          </p>
          <GuideSlideBody
            slide={s}
            variant="panel"
            partsOpen={partsOpen}
            onPartsToggle={setPartsOpen}
            onZoom={setZoom}
          />
        </div>

        {/* 別のタブで開く（この画面の入力中の内容を失わないため） */}
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 border-t border-[#e5e5e5] px-3 text-xs">
          <a
            href={`/guide#${s.id}`}
            target="_blank"
            rel="noopener"
            className="inline-flex h-11 items-center gap-1 text-[#8a4a1f] hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            使い方を全部見る
          </a>
          <a
            href={GUIDE_PRINT_PATH}
            target="_blank"
            rel="noopener"
            className="inline-flex h-11 items-center gap-1 text-[#8a4a1f] hover:underline"
          >
            <FileDown className="h-3.5 w-3.5" />
            PDFで保存
          </a>
          <span className="ml-auto text-[11px] text-[#909090]">別のタブで開きます</span>
        </div>
      </div>

      {/* 拡大表示は枠の外（body の直下）に出す。枠の重なり順（z-[35]）に閉じ込めないため */}
      {zoom && createPortal(<Zoom shot={zoom} onClose={closeZoom} />, document.body)}
    </>
  );
}
