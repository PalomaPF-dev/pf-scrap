/**
 * 使い方ガイドのスライドの一覧（id・並び・誰に出すか）と、画面（URL）→ スライドの対応。
 *
 * 使い方ページ（/guide）・作業しながら見るガイドの枠（components/GuidePanel.tsx）・
 * 印刷用ページ（/guide/print）が同じ一覧を使う。スライドの中身（文章・画面写真・画面の見方）は
 * lib/guideSlides.ts にあり、ここは軽い値だけを持つ（ガイドの枠は全画面のシェルに入るので、
 * 本文までは抱えない。本文は枠を開いたときに読み込む）。
 *
 * **`id` は使い方ページのアンカー（/guide#daily-read-before など）を兼ねる。**
 * 変えるとブックマーク・ガイドの枠の「使い方を全部見る」が迷子になるので、後から変えない。
 */

/** スライドの id。並びは GUIDE_SLIDE_ORDER */
export type GuideSlideId =
  | "intro"
  | "masters"
  | "daily-bag-start"
  | "daily-read-before"
  | "daily-read-after"
  | "daily-manual"
  | "daily-bag-close"
  | "daily-closing"
  | "bag-admin"
  | "bags"
  | "ship-send"
  | "ship-receive"
  | "first"
  | "first-list"
  | "quality"
  | "import"
  | "procurement"
  | "mcframe"
  | "summary"
  | "dashboard";

/**
 * スライドを出し分ける条件（その人が使える機能か）。
 * 判定は各画面の入口と同じ規則で、サーバー側で決めて渡す（lib/guideAudience.ts）。
 */
export interface GuideAudience {
  /** マスタ・取込・調達入力を使える（生産管理部・調達部のメンバーと管理者。session.ts の canUseOperations） */
  canOperate: boolean;
  /** 管理者（袋の訂正・品質チェックシート取込） */
  isAdmin: boolean;
  /** 工場間のスクラップ送付（プラ箱）を設定している会社 */
  useShipments: boolean;
}

/**
 * スライドの並び。業務の順番（Modules.ts の FLOW）と同じ:
 *   マスタ → 日次記録(袋の開始・交換を含む) → 袋の記録 → プラ箱（工場間） → 初品重量測定
 *   → 調達入力(在庫) → McFrame取込 → 月間集計 → 照合
 * `when` が無いスライドは全員に出す。使えない機能の説明は現場に読ませない。
 */
export const GUIDE_SLIDE_ORDER: { id: GuideSlideId; when?: (a: GuideAudience) => boolean }[] = [
  { id: "intro" },
  { id: "masters", when: (a) => a.canOperate },
  { id: "daily-bag-start" },
  { id: "daily-read-before" },
  { id: "daily-read-after" },
  { id: "daily-manual" },
  { id: "daily-bag-close" },
  { id: "daily-closing" },
  { id: "bag-admin", when: (a) => a.isAdmin },
  { id: "bags" },
  { id: "ship-send", when: (a) => a.useShipments },
  { id: "ship-receive", when: (a) => a.useShipments },
  { id: "first" },
  { id: "first-list" },
  { id: "quality", when: (a) => a.isAdmin },
  { id: "import", when: (a) => a.canOperate },
  { id: "procurement", when: (a) => a.canOperate },
  { id: "mcframe", when: (a) => a.canOperate },
  { id: "summary" },
  { id: "dashboard" },
];

/** その人に出すスライドの id（並び順） */
export function visibleGuideSlideIds(a: GuideAudience): GuideSlideId[] {
  return GUIDE_SLIDE_ORDER.filter((s) => !s.when || s.when(a)).map((s) => s.id);
}

/**
 * 画面 → その画面を説明しているスライド（説明の順）。上から順に見て最初に当たったものを使う。
 * `exact` は URL が完全に一致したときだけ（ホームの "/" がすべての画面に当たらないように）。
 * 旧URL（/first/list・/monthly）は転送先と同じスライドに当てる。
 * 当たらない画面は空 = この画面だけの説明はない（ガイドの枠は、いま出しているスライドのままにする）。
 */
const ROUTE_SLIDES: { path: string; exact?: boolean; slides: GuideSlideId[] }[] = [
  { path: "/", exact: true, slides: ["intro"] },
  { path: "/daily/import", slides: ["import"] },
  {
    path: "/daily",
    slides: [
      "daily-bag-start",
      "daily-read-before",
      "daily-read-after",
      "daily-manual",
      "daily-bag-close",
      "daily-closing",
      "bag-admin",
      "ship-receive",
    ],
  },
  { path: "/bags", slides: ["bags", "bag-admin"] },
  { path: "/shipments", slides: ["ship-send", "ship-receive"] },
  { path: "/first-list", slides: ["first-list"] },
  { path: "/first/list", slides: ["first-list"] },
  { path: "/first", slides: ["first"] },
  { path: "/quality", slides: ["quality"] },
  { path: "/summary", slides: ["summary"] },
  { path: "/dashboard", slides: ["dashboard"] },
  { path: "/procurement", slides: ["procurement"] },
  { path: "/monthly", slides: ["procurement"] },
  { path: "/mcframe", slides: ["mcframe"] },
  { path: "/scales", slides: ["masters"] },
  { path: "/items", slides: ["masters"] },
  { path: "/settings", slides: ["masters"] },
];

/** その画面を説明しているスライドのうち、その人に出すもの（説明の順） */
export function guideSlideIdsForPath(pathname: string, a: GuideAudience): GuideSlideId[] {
  const r = ROUTE_SLIDES.find((x) =>
    x.exact ? pathname === x.path : pathname === x.path || pathname.startsWith(x.path + "/")
  );
  if (!r) return [];
  const visible = new Set(visibleGuideSlideIds(a));
  return r.slides.filter((id) => visible.has(id));
}

/** 使い方の印刷用ページ（PDFで保存） */
export const GUIDE_PRINT_PATH = "/guide/print";

/** 使い方ページそのもの（ここではガイドの枠を出さない） */
export function isGuideRoute(pathname: string): boolean {
  return pathname === "/guide" || pathname.startsWith("/guide/");
}
