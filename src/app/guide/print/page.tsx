import type { Metadata } from "next";
import { requireEntitledSession } from "@/lib/session";
import { GuideSlidesPrint } from "@/components/GuideSlides";
import { guideSlidesFor } from "@/lib/guideSlides";
import { loadGuideAudience } from "@/lib/guideAudience";
import PrintToolbar from "./PrintToolbar";

/**
 * 使い方の印刷用ページ（PDFで保存）。
 *
 * その人が見られる全スライドを順に1つの縦長のページに並べ（「画面の見方」はすべて開き、
 * 画面写真も全部入れる）、写真の読み込みが終わったらブラウザの印刷画面を開く。
 * 利用者はそこで「PDFに保存」を選ぶ。PDFを自前で組み立てないのは、文字が多い文書を
 * 画像にすると重く・検索もできないため（印刷ならブラウザが文字のまま書き出す）。
 * 中身は使い方ページと同じ（lib/guideSlides.ts）。出すスライドも同じ規則で決める。
 *
 * シェル（サイドバー・工場の選択・ガイドの枠）は付けない（components/AppShell.tsx の BARE_ROUTES）。
 * 用紙は A4 縦。@page はこのページにだけ置く（QRラベルなどほかの画面の印刷を変えないため）。
 */

export const metadata: Metadata = { title: "使い方ガイド - PFスクラップ管理" };
// 表紙に印刷日を入れるので、毎回その日の日付で作る
export const dynamic = "force-dynamic";

/** 印刷日（日本時間） */
function printDate(): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date());
}

export default async function GuidePrintPage() {
  const session = await requireEntitledSession();
  const slides = guideSlidesFor(await loadGuideAudience(session));

  return (
    <div className="guide-print min-h-screen bg-[#e9e7e3] print:bg-white">
      <style>{PRINT_CSS}</style>
      <PrintToolbar />
      {/* 画面でも紙と同じ幅（A4 の左右余白を除いた 186mm）で見せる。写真の大きさは mm で決めているので、画面と紙で同じ並びになる */}
      <div className="guide-paper mx-auto w-full max-w-[calc(186mm+4rem)] overflow-x-hidden bg-white p-4 shadow sm:my-4 sm:p-8 print:my-0 print:max-w-none print:overflow-visible print:p-0 print:shadow-none">
        <header className="guide-cover">
          <div className="border-b-2 border-[#b4632c] pb-4">
            <p className="text-[11px] tracking-[0.08em] text-[#707070]">株式会社パロマ PFスクラップ管理</p>
            <h1 className="mt-1 text-3xl font-bold text-[#333333]">使い方ガイド</h1>
            <p className="mt-2 text-sm text-[#555555]">
              業務の順番（記録 → 集計 → 照合）に沿って、各画面の操作と「画面の見方」をまとめたものです。
            </p>
            <p className="mt-3 text-xs text-[#707070]">
              印刷日: {printDate()}　／　印刷した人が使える機能の説明（全{slides.length}項目）
            </p>
          </div>
          {/* 目次。紙で目当ての画面を探せるように、ページの見出しと同じ番号を振る */}
          <h2 className="mt-6 text-sm font-bold text-[#333333]">目次</h2>
          <ol className="mt-2 divide-y divide-[#eeeeee] border-y border-[#eeeeee]">
            {slides.map((s, n) => (
              <li key={s.id} className="flex gap-3 py-1.5 text-sm">
                <span className="w-8 shrink-0 text-right tabular-nums text-[#909090]">{n + 1}</span>
                <span className="w-44 shrink-0 text-xs font-bold leading-5 text-[#b4632c]">{s.eyebrow}</span>
                <span className="min-w-0 text-[#333333]">{s.title}</span>
              </li>
            ))}
          </ol>
        </header>
        <GuideSlidesPrint slides={slides} />
      </div>
    </div>
  );
}

/**
 * 印刷の体裁。画面では区切り線で見せ、紙のときだけ改ページを効かせる。
 * - 表紙（目次）で1ページ、以降はスライドごとに改ページ（長いスライドは続きのページへ流れる）
 * - 写真・手順の1行・「画面の見方」の1行の途中では改ページしない
 * - 見出しだけがページの最後に残らないようにする
 * - 札・ボタンの色は意味があるので、背景色も印刷させる
 */
const PRINT_CSS = `
@page {
  size: A4 portrait;
  margin: 12mm 12mm 14mm;
}
.guide-print { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.guide-print .guide-slide { margin-top: 2rem; padding-top: 2rem; border-top: 1px solid #e5e5e5; }
.guide-print .guide-shot,
.guide-print .guide-keep,
.guide-print figure { break-inside: avoid; }
.guide-print .guide-keep-next { break-after: avoid; }
@media print {
  .guide-print .guide-slide { margin-top: 0; padding-top: 0; border-top: 0; break-before: page; }
  .guide-print a { color: inherit; text-decoration: none; }
}
`;
