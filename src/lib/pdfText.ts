/**
 * PDFの文字を位置つきで取り出す（pdf.js）。ブラウザで読み、サーバーへは読み取った値だけ送る。
 * ページの回転も考慮し、左上原点の座標に揃えて返す。
 */

import type { SheetTextItem } from "./checkSheet";

/* eslint-disable @typescript-eslint/no-explicit-any */

/** pdf.js のページから文字と位置を取り出す（ブラウザ/Node 共用）。 */
export async function extractPageItems(
  page: any
): Promise<{ items: SheetTextItem[]; width: number; height: number }> {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items: SheetTextItem[] = [];
  for (const it of tc.items as any[]) {
    if (typeof it.str !== "string" || it.str.trim() === "") continue;
    const [a, b, c, d, e, f] = it.transform as number[];
    const h = it.height || Math.hypot(c, d) || Math.hypot(a, b);
    const w = it.width || 0;
    // テキスト空間の左下・右上をビューポート（左上原点）へ
    const [x1, y1] = vp.convertToViewportPoint(e, f);
    const [x2, y2] = vp.convertToViewportPoint(e + w, f + h);
    items.push({
      str: it.str,
      x: Math.min(x1, x2),
      y: Math.min(y1, y2),
      w: Math.abs(x2 - x1),
      h: Math.abs(y2 - y1) || h,
    });
  }
  return { items, width: vp.width, height: vp.height };
}

let pdfjsPromise: Promise<any> | null = null;

/**
 * pdf.js を遅延読込（ブラウザ専用）。工場の古い端末でも動くよう互換版（legacy）を使う。
 * ワーカーは同じバンドルから配信する（社内運用でも外部に出ない）。
 */
function loadPdfjs(): Promise<any> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs: any) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/legacy/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();
      return pdfjs;
    });
    pdfjsPromise.catch(() => {
      pdfjsPromise = null;
    });
  }
  return pdfjsPromise;
}

/** File（PDF）→ ページごとの文字と位置。ブラウザ専用。 */
export async function readPdfPages(
  file: File
): Promise<{ items: SheetTextItem[]; width: number; height: number }[]> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  try {
    const pages = [];
    for (let n = 1; n <= doc.numPages; n++) {
      pages.push(await extractPageItems(await doc.getPage(n)));
    }
    return pages;
  } finally {
    void doc.destroy();
  }
}
