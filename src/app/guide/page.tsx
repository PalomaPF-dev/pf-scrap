import Link from "next/link";
import { FileDown } from "lucide-react";
import { requireEntitledSession } from "@/lib/session";
import PageHeader from "@/components/PageHeader";
import GuideSlides from "@/components/GuideSlides";
import { guideSlidesFor } from "@/lib/guideSlides";
import { loadGuideAudience } from "@/lib/guideAudience";
import { GUIDE_PRINT_PATH } from "@/lib/guideMap";

export const dynamic = "force-dynamic";

/**
 * 使い方ガイド。
 *
 * 中身（スライドの文章・画面写真・画面の見方）は lib/guideSlides.ts、
 * 並び・誰に出すか・画面との対応は lib/guideMap.ts にあり、
 * 作業しながら見るガイドの枠（components/GuidePanel.tsx）と印刷用ページ（/guide/print）も同じものを使う。
 * 使えない機能のスライドは出さない（判定は各画面の入口と同じ規則。lib/guideAudience.ts）。
 */
export default async function GuidePage() {
  const session = await requireEntitledSession();
  const slides = guideSlidesFor(await loadGuideAudience(session));

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="使い方"
        description="業務の順番（記録 → 集計 → 照合）に沿って、1画面ずつ見られます。矢印キー（← →）でも送れます。各画面の上の「ガイド」から、画面を操作しながら見ることもできます"
        action={
          // 全スライドを1つの文書にして印刷画面を開く（そこで「PDFに保存」を選ぶ）
          <Link
            href={GUIDE_PRINT_PATH}
            className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-[#cfcac3] bg-white px-4 text-sm font-semibold text-[#555555] hover:bg-[#f7f7f5]"
          >
            <FileDown className="h-4 w-4" />
            PDFで保存
          </Link>
        }
      />
      <div className="mx-auto max-w-4xl">
        <GuideSlides slides={slides} />
      </div>
    </div>
  );
}
