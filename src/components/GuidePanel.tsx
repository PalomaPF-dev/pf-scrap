"use client";

import {
  Suspense,
  createContext,
  lazy,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { usePathname } from "next/navigation";
import { BookOpen, ChevronDown, ChevronUp, ChevronsLeft, ChevronsRight, Maximize2, Minus, X } from "lucide-react";
import {
  guideSlideIdsForPath,
  isGuideRoute,
  type GuideAudience,
  type GuideSlideId,
} from "@/lib/guideMap";

/**
 * 作業しながら見るガイド（使い方）の枠。PFシリーズ共通の作り（PF作業改善などと同じ）。
 *
 * どの画面でも「ガイド」で開け、**開いたままその画面を操作できる**（モーダルにしない:
 * 下敷きの暗幕もスクロール止めもない）。シェルの中に置くので、画面を移っても閉じない。
 * - PC（横幅が広い）: 右に縦長の枠を出し、本文の列をその分だけ狭める（枠が本文に重ならない）。
 *   幅は「狭い / 広い」の2段
 * - スマホ・タブレット: 下から出るシート。「たたむ（帯だけ）/ 半分 / 全体」を切り替え、
 *   読むときは広げ、計量・撮影など操作するときはたたむ。たたむ・半分のときは、
 *   日次記録の画面下の保存の帯とカメラの撮影画面をシートの上へ持ち上げる（globals.css の
 *   .guide-avoid-bottom）。ボタンがシートに隠れて押せなくならないようにするため
 *
 * 中身は使い方ページと同じスライド（lib/guideSlides.ts）を1枚ずつ出す（GuidePanelContent.tsx）。
 * 出すスライドは使い方ページと同じ規則で絞る（layout.tsx がサーバー側で決めた audience）。
 * 開いたときは、いまの画面を説明しているスライド（lib/guideMap.ts の対応）を出す。
 * 画面を移ったときは:
 * - 利用者が別のスライドを選んでいない（画面に合わせて出している）間は、移った先の画面の
 *   スライドに切り替える。いま出しているスライドが移った先の画面の説明でもあれば、そのまま
 * - 利用者が自分で別の画面のスライドを選んでいたら、読んでいる所を崩さないよう切り替えず、
 *   「この画面の説明に切り替える」を出すだけにする
 * - 説明のスライドがない画面では、いまのスライドをそのまま出しておく
 *
 * 開閉と大きさ（PCの幅・スマホのシートの高さ）は端末に覚える（localStorage。使えなくても動く）。
 * 使い方ページそのもの・印刷用ページ・ログイン画面・印刷では出さない。
 */

const STORE_KEY = "scrap-guide-panel";
/** PC の枠の幅 */
const WIDTH_PX = { narrow: 380, wide: 460 } as const;
type PanelWidth = keyof typeof WIDTH_PX;
/** スマホのシートの高さ */
type SheetSize = "min" | "half" | "full";
const SHEET_HEIGHT: Record<SheetSize, string> = {
  // 帯だけ（つまみと、いまのスライドの見出し・操作ボタン）
  min: "calc(3.75rem + env(safe-area-inset-bottom))",
  half: "50dvh",
  // 上のヘッダ（メニュー・ガイド・ホーム）は隠さない
  full: "calc(100dvh - 3.5rem - 4px - env(safe-area-inset-top))",
};
/**
 * 画面の側で空けておく高さ（本文の下の余白・持ち上げる帯）。全体に広げたときは画面を
 * 読み終えるまでの一時的な状態なので、半分のときと同じだけにする（帯やカメラを潰さない）。
 */
const AVOID_HEIGHT: Record<SheetSize, string> = {
  min: SHEET_HEIGHT.min,
  half: SHEET_HEIGHT.half,
  full: SHEET_HEIGHT.half,
};
/**
 * 右に並べる（PC）か、下から出す（スマホ・タブレット）かの境目。
 * サイドバー（256px）＋枠＋本文が収まる幅で、サイドバーが出る高さ（globals.css の wide）もあるとき。
 */
const SIDE_QUERY = "(min-width: 1100px) and (min-height: 600px)";

export const GUIDE_PANEL_ID = "guide-panel";

interface Saved {
  open: boolean;
  /** null = まだ選んでいない（画面の幅で決める） */
  width: PanelWidth | null;
  sheet: SheetSize;
}

const DEFAULT_SAVED: Saved = { open: false, width: null, sheet: "half" };

function readSaved(): Saved {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) ?? "null") as Partial<Saved> | null;
    if (!v || typeof v !== "object") return DEFAULT_SAVED;
    return {
      open: v.open === true,
      width: v.width === "narrow" || v.width === "wide" ? v.width : null,
      sheet: v.sheet === "min" || v.sheet === "half" || v.sheet === "full" ? v.sheet : "half",
    };
  } catch {
    return DEFAULT_SAVED;
  }
}

/**
 * 開閉と大きさの保存先。端末（localStorage）に覚え、読めない・書けない端末ではこの画面を
 * 開いている間だけ覚える。サーバーの描画では「閉じている」として描き、ブラウザで読んだ値に合わせる
 * （useSyncExternalStore。サーバーとブラウザの初回描画を食い違わせないため）。
 */
let saved: Saved | null = null;
const savedListeners = new Set<() => void>();
const savedStore = {
  subscribe(onChange: () => void) {
    savedListeners.add(onChange);
    return () => savedListeners.delete(onChange);
  },
  get(): Saved {
    if (!saved) saved = readSaved();
    return saved;
  },
  getServer: (): Saved => DEFAULT_SAVED,
  set(patch: Partial<Saved>) {
    saved = { ...savedStore.get(), ...patch };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(saved));
    } catch {
      /* プライベートモード等で保存できなくても、開閉自体は効かせる */
    }
    savedListeners.forEach((f) => f());
  },
};

/** 右に並べる幅か（サーバーの描画では null = まだ分からない） */
function subscribeSide(onChange: () => void) {
  const mq = window.matchMedia(SIDE_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

/** 本文は開いたときに読み込む（全画面のシェルに使い方の文章と写真の一覧まで抱えさせないため） */
const GuidePanelContent = lazy(() => import("./GuidePanelContent"));

interface Ctx {
  /** この画面でガイドを出せるか（使い方ページ・ログイン画面などでは false） */
  available: boolean;
  open: boolean;
  toggle: () => void;
}

const GuideCtx = createContext<Ctx>({ available: false, open: false, toggle: () => {} });

/** 見えている「ガイド」ボタン（サイドバーとスマホのヘッダの2か所にあり、片方は隠れている） */
function focusVisibleToggle() {
  const btns = Array.from(document.querySelectorAll<HTMLElement>("[data-guide-toggle]"));
  btns.find((b) => b.offsetParent !== null)?.focus();
}

export function GuidePanelProvider({
  enabled,
  audience,
  children,
}: {
  /** ログインしていて、シェルのある画面のときだけ true */
  enabled: boolean;
  /** 出すスライドの条件（layout.tsx がサーバー側で決める。使い方ページと同じ規則） */
  audience: GuideAudience;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const available = enabled && !isGuideRoute(pathname);
  // 中身が同じなら同じオブジェクトにして、画面を移るたびに対応を引き直さない
  const { canOperate, isAdmin, useShipments } = audience;
  const aud = useMemo(
    () => ({ canOperate, isAdmin, useShipments }),
    [canOperate, isAdmin, useShipments]
  );
  const routeIds = useMemo(() => guideSlideIdsForPath(pathname, aud), [pathname, aud]);

  const { open, width: savedWidth, sheet } = useSyncExternalStore(
    savedStore.subscribe,
    savedStore.get,
    savedStore.getServer
  );
  const side = useSyncExternalStore<boolean | null>(
    subscribeSide,
    () => window.matchMedia(SIDE_QUERY).matches,
    () => null
  );
  // 幅をまだ選んでいなければ、大きな画面では広い方にする（枠を開いて描くのはブラウザだけ）
  const width: PanelWidth =
    savedWidth ?? (side && typeof window !== "undefined" && window.innerWidth >= 1500 ? "wide" : "narrow");
  const setOpen = useCallback((v: boolean) => savedStore.set({ open: v }), []);
  const setWidth = useCallback((v: PanelWidth) => savedStore.set({ width: v }), []);
  const setSheet = useCallback((v: SheetSize) => savedStore.set({ sheet: v }), []);

  const [slideId, setSlideId] = useState<GuideSlideId>(routeIds[0] ?? "intro");
  /** true = 画面に合わせてスライドを出している（利用者が別の画面のスライドを選んでいない） */
  const [follow, setFollow] = useState(true);
  /** ボタンで開いたときだけ枠へ移る（読み込み時に開いた状態を戻すときは、操作中の欄から奪わない） */
  const focusOnOpenRef = useRef(false);

  // 画面を移ったら、利用者が別のスライドを選んでいない間だけ、その画面のスライドに切り替える。
  // いま出しているスライドが移った先の画面の説明でもあれば、そのまま（描画中に合わせる）
  const routeKey = routeIds.join(",");
  const [seenRouteKey, setSeenRouteKey] = useState(routeKey);
  if (routeKey !== seenRouteKey) {
    setSeenRouteKey(routeKey);
    if (follow && routeIds.length > 0 && !routeIds.includes(slideId)) setSlideId(routeIds[0]);
  }

  const select = useCallback(
    (id: GuideSlideId) => {
      setSlideId(id);
      // この画面の説明（または説明のない画面）なら、画面に合わせて切り替える状態のまま
      setFollow(routeIds.length === 0 || routeIds.includes(id));
    },
    [routeIds]
  );

  const toggle = useCallback(() => {
    if (open) {
      setOpen(false);
      return;
    }
    // 開くときは、いまの画面のスライドから見せる
    if (routeIds.length > 0) setSlideId((cur) => (routeIds.includes(cur) ? cur : routeIds[0]));
    setFollow(true);
    focusOnOpenRef.current = true;
    setOpen(true);
  }, [open, routeIds, setOpen]);

  const close = useCallback(() => {
    setOpen(false);
    // 閉じたら、開いたボタンへ戻す（キーボード操作で迷子にしない）
    requestAnimationFrame(focusVisibleToggle);
  }, [setOpen]);

  const shown = available && open && side !== null;

  // 本文の列を枠の分だけ狭める / シートの分だけ下に余白を足す（globals.css の html[data-guide]）
  useEffect(() => {
    const root = document.documentElement;
    if (!shown) {
      delete root.dataset.guide;
      return;
    }
    root.dataset.guide = side ? "side" : "sheet";
    root.style.setProperty("--guide-w", `${WIDTH_PX[width]}px`);
    root.style.setProperty("--guide-avoid-h", AVOID_HEIGHT[sheet]);
    return () => {
      delete root.dataset.guide;
    };
  }, [shown, side, width, sheet]);

  return (
    <GuideCtx.Provider value={{ available, open, toggle }}>
      {children}
      {shown && (
        <GuidePanelFrame
          side={side}
          width={width}
          setWidth={setWidth}
          sheet={sheet}
          setSheet={setSheet}
          audience={aud}
          slideId={slideId}
          select={select}
          routeIds={routeIds}
          follow={follow}
          onClose={close}
          focusOnOpenRef={focusOnOpenRef}
        />
      )}
    </GuideCtx.Provider>
  );
}

/** 「ガイド」ボタン。sidebar = PCのサイドバー（とスマホのメニュー）、header = スマホの上の帯 */
export function GuideToggle({ variant }: { variant: "sidebar" | "header" }) {
  const { available, open, toggle } = useContext(GuideCtx);
  if (!available) return null;
  const common = {
    type: "button" as const,
    onClick: toggle,
    "aria-expanded": open,
    "aria-controls": GUIDE_PANEL_ID,
    "data-guide-toggle": "",
  };
  if (variant === "header") {
    return (
      <button
        {...common}
        className={`no-print inline-flex h-11 items-center gap-1 rounded-lg px-2.5 text-xs font-bold ${
          open ? "bg-[#b4632c] text-white" : "text-[#b4632c] hover:bg-[#faf6ef]"
        }`}
      >
        <BookOpen className="h-5 w-5" />
        ガイド
      </button>
    );
  }
  return (
    <button
      {...common}
      className={`no-print flex h-11 w-full items-center gap-2 rounded-lg border px-3 text-xs font-bold transition-colors ${
        open
          ? "border-[#b4632c] bg-[#b4632c] text-white hover:bg-[#96521f]"
          : "border-[#e8cdb6] bg-[#faf6ef] text-[#8a4a1f] hover:bg-[#f5ebdd]"
      }`}
    >
      <BookOpen className="h-4 w-4 shrink-0" />
      <span className="grow text-left">{open ? "ガイドを閉じる" : "ガイドを見ながら作業"}</span>
    </button>
  );
}

/** 枠の見出しの横の小さな操作ボタン（押しやすさのため 44px 四方を取る） */
export function PanelIconButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[#707070] hover:bg-[#f7f7f5] hover:text-[#333333]"
    >
      {children}
    </button>
  );
}

/** 枠そのもの（置き場所・大きさ・閉じる）。中身は GuidePanelContent */
function GuidePanelFrame({
  side,
  width,
  setWidth,
  sheet,
  setSheet,
  audience,
  slideId,
  select,
  routeIds,
  follow,
  onClose,
  focusOnOpenRef,
}: {
  side: boolean;
  width: PanelWidth;
  setWidth: (w: PanelWidth) => void;
  sheet: SheetSize;
  setSheet: (s: SheetSize) => void;
  audience: GuideAudience;
  slideId: GuideSlideId;
  select: (id: GuideSlideId) => void;
  routeIds: GuideSlideId[];
  follow: boolean;
  onClose: () => void;
  focusOnOpenRef: React.RefObject<boolean>;
}) {
  const minimized = !side && sheet === "min";

  // 大きさの切り替えと閉じる（見出しの右に並べる）
  const controls = (
    <>
      {side ? (
        <PanelIconButton
          onClick={() => setWidth(width === "wide" ? "narrow" : "wide")}
          label={width === "wide" ? "幅を狭くする" : "幅を広くする"}
        >
          {width === "wide" ? <ChevronsRight className="h-5 w-5" /> : <ChevronsLeft className="h-5 w-5" />}
        </PanelIconButton>
      ) : (
        <>
          {sheet !== "min" && (
            <PanelIconButton onClick={() => setSheet("min")} label="たたむ（帯だけにする）">
              <Minus className="h-5 w-5" />
            </PanelIconButton>
          )}
          {sheet !== "half" && (
            <PanelIconButton onClick={() => setSheet("half")} label="半分の高さにする">
              {sheet === "min" ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </PanelIconButton>
          )}
          {sheet !== "full" && (
            <PanelIconButton onClick={() => setSheet("full")} label="全体に広げる">
              <Maximize2 className="h-5 w-5" />
            </PanelIconButton>
          )}
        </>
      )}
      <PanelIconButton onClick={onClose} label="ガイドを閉じる">
        <X className="h-5 w-5" />
      </PanelIconButton>
    </>
  );

  const style: React.CSSProperties = side
    ? { width: WIDTH_PX[width], top: "calc(4px + env(safe-area-inset-top))" }
    : { height: SHEET_HEIGHT[sheet], paddingBottom: "env(safe-area-inset-bottom)" };

  return (
    <section
      id={GUIDE_PANEL_ID}
      aria-labelledby="guide-panel-title"
      onKeyDown={(e) => {
        // 枠の中で Esc を押したら閉じる（画面側で押した Esc は各画面のものなので奪わない）
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.stopPropagation();
          onClose();
        }
      }}
      style={style}
      // z-[35]: 日次記録の保存の帯（z-30）より上、スマホのメニュー（z-40）・カメラや確認の画面（z-50）より下
      className={`no-print fixed z-[35] flex flex-col bg-white ${
        side
          ? "right-0 bottom-0 border-l border-[#e5e5e5] shadow-[-4px_0_12px_rgba(0,0,0,0.05)]"
          : "inset-x-0 bottom-0 rounded-t-2xl border-t border-[#d9d9d9] shadow-[0_-6px_16px_rgba(0,0,0,0.12)] wide:left-64"
      }`}
    >
      {!side && (
        // シートのつまみ（押すと 帯 → 半分 → 全体 → 帯 の順に変わる。ボタンでも同じことができる）
        <button
          type="button"
          tabIndex={-1}
          aria-hidden="true"
          onClick={() => setSheet(sheet === "min" ? "half" : sheet === "half" ? "full" : "min")}
          className="flex h-3.5 w-full shrink-0 items-center justify-center"
        >
          <span className="h-1 w-10 rounded-full bg-[#cfcac3]" />
        </button>
      )}
      <Suspense
        fallback={
          <div className="flex items-center gap-1 px-2">
            <BookOpen className="ml-1 h-4 w-4 shrink-0 text-[#b4632c]" />
            <h2 id="guide-panel-title" className="grow text-sm font-bold text-[#333333]">
              ガイド
              <span className="ml-2 text-xs font-normal text-[#909090]">読み込み中…</span>
            </h2>
            {controls}
          </div>
        }
      >
        <GuidePanelContent
          audience={audience}
          slideId={slideId}
          select={select}
          routeIds={routeIds}
          follow={follow}
          minimized={minimized}
          onExpand={() => setSheet("half")}
          controls={controls}
          focusOnOpenRef={focusOnOpenRef}
        />
      </Suspense>
    </section>
  );
}
