"use client";

import { Fragment, useCallback, useMemo, useState, useSyncExternalStore, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  PackagePlus,
  Pencil,
  Plus,
  QrCode,
  Save,
  Sparkles,
  Stamp,
  Trash2,
  Truck,
  Undo2,
} from "lucide-react";
import {
  approveDailyRecordAction,
  lookupScaleByQrAction,
  rejectDailyRecordAction,
  saveDailyRecordAction,
} from "@/lib/actions";
import {
  DAILY_STATUS_LABEL,
  kindColor,
  type DailyRecord,
  type DailyStatus,
  type Scale,
  type ScalePhotoResult,
  type ScrapBag,
  type ScrapKind,
  type Shipment,
  shipmentGap,
  shipmentGapLarge,
  shipmentNeedsPolyTare,
  shipmentPair,
} from "@/lib/scrapTypes";
import { fmt, fmtPct, toNum, toNumOrNull } from "@/lib/format";
import DateNav from "@/components/DateNav";
import ScaleCamera from "@/components/ScaleCamera";
import ScrapBagPanel, {
  ResultBanner,
  ScrapBagList,
  type PanelMessage,
} from "@/components/ScrapBagPanel";

/** 明細行のドラフト（入力値は文字列で保持し、表示時に計算） */
type EntryDraft = {
  jikoku: string;
  scaleId: string | null;
  scaleName: string;
  /** この投入が入った袋。袋管理より前の明細は null */
  bagId: string | null;
  kind: string;
  gross: string;
  tare: string;
  cumBefore: string;
  cumAfter: string;
  /** 投入前の表示値を機械の値（AI読取／連携値）から変えたときの理由 */
  cumBeforeReason: string;
  /** 投入後の表示値をAI読取値から変えたときの理由 */
  cumAfterReason: string;
  /** 元になったAI読取のID（監査で突き合わせる）。手入力なら null */
  cumBeforeReadId: string | null;
  cumAfterReadId: string | null;
  kirokusha: string;
  ijo: string;
  /**
   * Excel（紙様式）から取り込んだ行だけが持つ発生元。画面では表示のみで、
   * 保存し直しても消えないようにそのまま持ち回る。
   */
  busho: string;
  kikai: string;
  zairyo: string;
  kotei: string;
  /** 他工場から届いたプラ箱を投入した行だけ。発生元の工場はサーバーがプラ箱から決める */
  shipmentId: string | null;
  /** 空けたあとに量ったプラ箱の重さ（プラ箱を投入した行だけ） */
  polyTare: string;
};

/** モバイルでの拡大表示を避けるため、入力は 16px（text-base）を基準にする */
const input =
  "h-11 rounded-lg border border-[#e5e5e5] bg-white px-3 text-base focus:border-[#b4632c] focus:outline-none disabled:bg-[#f0f0ee] disabled:text-[#909090] sm:h-10 sm:text-sm";
const numInput = `${input} text-right tabular-nums`;
const td = "border border-[#e5e5e5] px-2 py-1.5 whitespace-nowrap";
const tdNum = `${td} text-right tabular-nums`;
const th = "border border-[#e5e5e5] bg-[#f0f0ee] px-2 py-1.5 text-left font-semibold whitespace-nowrap";

/**
 * 明細1行の重量。新様式は「投入後の表示値 − 投入前の表示値」。
 * AI読取の導入前に記録した行は投入前重量・箱重量を持つので、そちらで出す
 * （再表示・再保存で過去の数字が変わらないようにする）。
 */
function entryWeight(e: EntryDraft): number | null {
  const g = toNumOrNull(e.gross);
  const t = toNumOrNull(e.tare);
  if (g !== null && t !== null) return Math.round((g - t) * 1000) / 1000;
  const b = toNumOrNull(e.cumBefore);
  const a = toNumOrNull(e.cumAfter);
  if (b === null || a === null) return null;
  return Math.round((a - b) * 1000) / 1000;
}

/** 明細の訂正理由（投入前・投入後）をまとめた表示文字列。 */
function entryReason(e: EntryDraft): string {
  return [
    e.cumBeforeReason ? `投入前: ${e.cumBeforeReason}` : "",
    e.cumAfterReason ? `投入後: ${e.cumAfterReason}` : "",
  ]
    .filter(Boolean)
    .join(" ／ ");
}

/**
 * 発生元の補足（機械 / 品種 / 工程）。Excelの記録票から取り込んだ行だけが持つ。
 * 職場（部署）は独立した列で出すので、ここには含めない。
 */
function entryOrigin(e: EntryDraft): string {
  return [e.kikai, e.zairyo, e.kotei].filter(Boolean).join(" / ");
}

/**
 * 同じ累積で繋がる次の明細の位置（無ければ -1）。
 * 袋がある明細は同じ袋、袋管理より前の明細は同じ重量計で繋がる（サーバーの照合と同じ）。
 */
function nextInChain(list: EntryDraft[], i: number): number {
  const e = list[i];
  for (let j = i + 1; j < list.length; j++) {
    const n = list[j];
    if (e.bagId ? n.bagId === e.bagId : !n.bagId && n.scaleId === e.scaleId) return j;
  }
  return -1;
}

/**
 * 前の明細を直した・取り消したことで、次の明細の投入前が前の投入後と合わなくなったら、
 * その旨を訂正理由に入れる（サーバーは理由の無い食い違いを保存させないため）。
 * AI読取の投入前は読取値と照合されるので触らない。既に理由がある行もそのまま。
 */
function noteChainBreak(list: EntryDraft[], j: number, expected: string, note: string) {
  if (j < 0) return;
  const n = list[j];
  if (n.cumBeforeReadId || n.cumBeforeReason) return;
  if (toNumOrNull(n.cumBefore) === toNumOrNull(expected)) return;
  list[j] = { ...n, cumBeforeReason: note.slice(0, 200) };
}

/** 備考に残す履歴の日時（例: 10/6 16:40）。 */
function stampNow(): string {
  const day = new Date().toLocaleDateString("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "numeric",
    day: "numeric",
  });
  return `${day} ${nowTime()}`;
}

/** 端末の保存（localStorage）の変化を購読する。別タブで選び直したときにも追従する。 */
function subscribeStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** 端末の保存から読む。使えない端末（プライベートモード等）では null。 */
function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** 現在時刻 HH:MM（JST）。時刻は入力した時間が自動で入る。 */
function nowTime(): string {
  return new Date().toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function StatusBadge({ status }: { status: DailyStatus }) {
  const style =
    status === "approved"
      ? "bg-[#eef4ee] text-[#2f6b2f]"
      : status === "pending"
        ? "bg-[#fff3e0] text-[#a15c00]"
        : status === "rejected"
          ? "bg-[#fdecea] text-[#dc000c]"
          : "bg-[#eeeeee] text-[#555555]";
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${style}`}>
      {DAILY_STATUS_LABEL[status]}
    </span>
  );
}

/** 種類タグ。色は種類マスタの並び順で決まる（order を渡すと一覧と同じ色になる）。 */
function KindTag({ kind, order }: { kind: string; order?: number }) {
  return (
    <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${kindColor(kind, order)}`}>
      {kind}
    </span>
  );
}

/** 入力項目の通し番号（①②③④）。記録票の項目と対応づけて迷わないようにする */
function FieldNo({ n }: { n: string }) {
  return <span className="mr-1 font-bold text-[#b4632c]">{n}</span>;
}

/** 手順番号つきの見出し（現場で迷わないよう「いま何をするか」を明示する） */
function Step({
  n,
  title,
  hint,
  children,
}: {
  n: number;
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
      <div className="mb-3 flex items-start gap-2.5">
        <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#b4632c] text-xs font-bold text-white">
          {n}
        </span>
        <div>
          <h2 className="text-base font-bold text-[#333333] sm:text-sm">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-[#909090]">{hint}</p>}
        </div>
      </div>
      {children}
    </section>
  );
}

/**
 * スクラップ日次記録票（モバイル優先）。計量の流れ:
 *   1. 投入先のスクラップ箱（重量計）をQR読み取り or 一覧から選択
 *   2. 投入前重量(箱含む) − 箱重量(空き箱) = スクラップ重量（自動計算）
 *   3. 「この投入を記録」→ 時刻・記録者は自動
 *   3. 終礼集計で当日を確認し、承認者が「終礼確認して承認する」で当日を確定
 * 始業時のスクラップ箱残量は管理者のみが入力する（サーバー側でも強制）。
 */
export default function DailyRecordForm({
  date,
  factory,
  factoryOptions,
  factoryLocked,
  initial,
  scales,
  openBags,
  dayBags,
  bagEra,
  bagStartOn,
  workplaces,
  myWorkplace,
  shipFrom = [],
  shipments = [],
  kinds,
  userName,
  isAdmin,
}: {
  date: string;
  factory: string;
  factoryOptions: string[];
  factoryLocked: boolean;
  initial: DailyRecord | null;
  scales: Scale[];
  /** 記録中の袋（重量計ごとに最大1つ）。投入はこの袋に入る */
  openBags: ScrapBag[];
  /** その日に関わった袋（記録中・締め済み・承認済み） */
  dayBags: ScrapBag[];
  /** この日が袋単位の管理の対象か（袋運用の開始日以降か） */
  bagEra: boolean;
  /** 袋運用の開始日 YYYY-MM-DD（表示用） */
  bagStartOn: string;
  /** この工場で選べる職場（設定で「使う」にしたもの）。空なら職場は聞かない */
  workplaces: string[];
  /** ログインユーザーの所属職場（候補にあれば最初から選んでおく） */
  myWorkplace: string;
  /** この工場へプラ箱を送ってくる工場。空なら他工場の受け入れは無い */
  shipFrom?: string[];
  /** 未処理のプラ箱と、この日の記録で処理済みのプラ箱 */
  shipments?: Shipment[];
  /** スクラップ種類（設定マスタ。並び順＝表示順・色の順） */
  kinds: ScrapKind[];
  userName: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const status: DailyStatus = initial?.status ?? "draft";
  // 承認済み（と旧データの申請中）は記録者はロック。承認者は編集・承認の取り消しができる。
  const locked = (status === "pending" || status === "approved") && !isAdmin;

  const [sekininsha, setSekininsha] = useState(initial?.sekininsha ?? "");
  const [entries, setEntries] = useState<EntryDraft[]>(
    (initial?.entries ?? []).map((e) => ({
      jikoku: e.jikoku,
      scaleId: e.scaleId,
      scaleName: e.scaleName || e.hinshu,
      bagId: e.bagId ?? null,
      kind: e.hinshu,
      gross: e.grossWeight !== null ? String(e.grossWeight) : "",
      tare: e.tareWeight !== null ? String(e.tareWeight) : "",
      cumBefore: e.cumBefore !== null ? String(e.cumBefore) : "",
      cumAfter: e.cumAfter !== null ? String(e.cumAfter) : "",
      cumBeforeReason: e.cumBeforeReason ?? "",
      cumAfterReason: e.cumAfterReason ?? "",
      cumBeforeReadId: e.cumBeforeReadId ?? null,
      cumAfterReadId: e.cumAfterReadId ?? null,
      kirokusha: e.kirokusha,
      ijo: e.ijo,
      busho: e.busho ?? "",
      kikai: e.kikai ?? "",
      zairyo: e.zairyo ?? "",
      kotei: e.kotei ?? "",
      shipmentId: e.shipmentId ?? null,
      polyTare: e.polyTare !== null && e.polyTare !== undefined ? String(e.polyTare) : "",
    }))
  );
  const [kaishu, setKaishu] = useState(
    initial?.kaishuSokuteichi !== null && initial?.kaishuSokuteichi !== undefined
      ? String(initial.kaishuSokuteichi)
      : ""
  );
  const [tonyuKanryo, setTonyuKanryo] = useState(initial?.tonyuKanryo ?? false);
  const [biko, setBiko] = useState(initial?.biko ?? "");
  const [message, setMessage] = useState<PanelMessage | null>(null);
  // どこまで保存したか。「先頭から savedCount 件までが保存済み」。
  // 行を直す・取り消すときは保存できてから画面に反映するので、この前提は崩れない。
  // 締めの合計は保存済みの明細から出すため、未保存があるうちは袋を締めさせない。
  const [savedCount, setSavedCount] = useState(initial?.entries.length ?? 0);
  // 読み取り・記録の結果は2でも3でも出るので、同じ見た目を両方に置く。
  // 小さな文字だと見落とすため（現場から報告あり）、見出しつきの枠で大きく出す。
  const messageBanner = message ? <ResultBanner msg={message} className="mt-3" /> : null;
  // 終礼集計の入力（責任者・回収箱測定値・備考など）を触ったか。保存ボタンの強調に使う
  const [fieldsDirty, setFieldsDirty] = useState(false);

  // ===== 記録済みの行を直す・取り消す =====
  // 開いている行の位置と入力中の値。モバイルのカードとPCの表で同じ値を使う。
  const [fixIndex, setFixIndex] = useState<number | null>(null);
  const [fixDraft, setFixDraft] = useState({ before: "", after: "", polyTare: "", reason: "" });
  const [fixMessage, setFixMessage] = useState<PanelMessage | null>(null);

  // ===== 箱（重量計）選択 =====
  const [selectedScale, setSelectedScale] = useState<Scale | null>(null);
  const [qrInput, setQrInput] = useState("");

  // ===== 計量入力（AI読取） =====
  const [ijo, setIjo] = useState("");

  // ===== 他工場から届いたプラ箱 =====
  // 受け入れる工場だけ「自工場のスクラップ」と「届いたプラ箱」を切り替えられる。
  // プラ箱を選んで投入すると、その分は送った工場のスクラップとして照合に回る。
  const [source, setSource] = useState<"own" | "poly">("own");
  const [pickedShipmentId, setPickedShipmentId] = useState<string | null>(null);
  // 空けたあとのプラ箱の重さ。投入重量 ＋ これ ＝ 送った工場で量った重量（プラ箱込み）
  const [polyTare, setPolyTare] = useState("");
  const shipmentById = useMemo(() => new Map(shipments.map((sh) => [sh.id, sh])), [shipments]);

  // ===== どの職場のスクラップか =====
  // 同じ人は同じ職場のスクラップを続けて記録するので、選んだ職場は端末に覚えておき、
  // 次からは最初から選んだ状態にする（毎回選ばせると手間と押し間違いが増える）。
  const workplaceKey = `scrap.workplace.${factory}`;
  // 端末に覚えた職場。サーバーの描画では読めないので null とし、画面に出てから読む
  // （useSyncExternalStore がサーバーと画面の食い違いを吸収する）。
  const savedWorkplace = useSyncExternalStore(
    subscribeStorage,
    () => readStorage(workplaceKey),
    () => null
  );
  // この画面で選び直した職場。選んでいなければ 前回の職場 → 所属職場 の順に使う
  const [pickedWorkplace, setPickedWorkplace] = useState<string | null>(null);
  const workplace =
    pickedWorkplace ??
    (savedWorkplace && workplaces.includes(savedWorkplace)
      ? savedWorkplace
      : workplaces.includes(myWorkplace)
        ? myWorkplace
        : "");
  function setWorkplace(next: string) {
    setPickedWorkplace(next);
    try {
      window.localStorage.setItem(workplaceKey, next);
    } catch {
      // 保存できなくても選択はこの画面で効く
    }
  }
  // 投入前・投入後とも「機械が出した値」を既定にし、変えるときだけ理由を残す。
  // read = AI読取の結果（readId と値）。null は読み取っていない状態。
  const [beforeRead, setBeforeRead] = useState<{ readId: string; value: number } | null>(null);
  const [afterRead, setAfterRead] = useState<{ readId: string; value: number } | null>(null);
  const [beforeFix, setBeforeFix] = useState(false);
  const [beforeManual, setBeforeManual] = useState("");
  const [beforeReason, setBeforeReason] = useState("");
  const [afterFix, setAfterFix] = useState(false);
  const [afterManual, setAfterManual] = useState("");
  const [afterReason, setAfterReason] = useState("");

  /**
   * 選択中の箱の「次に入るはずの投入前の表示値」＝同じ箱の直前の投入後。
   * AI読取が主で、これは読めなかったときの手がかりと、読取値とのずれの確認に使う。
   */
  /** QR値から重量計を引く。写真1枚目の「どの箱を撮ったか」の判定に使う。 */
  const scaleByQr = useMemo(() => new Map(scales.map((s) => [s.qrCode, s])), [scales]);

  /**
   * 指定の重量計で、その日に記録中だった袋。投入はこの袋に入る。
   * 過去の日を開いているときは、その日より後に開いた袋には入れない。
   */
  const bagOf = useCallback(
    (scaleId: string): ScrapBag | null =>
      bagEra
        ? (openBags.find((b) => b.scaleId === scaleId && b.openedOn <= date) ?? null)
        : null,
    [openBags, date, bagEra]
  );
  const currentBag = selectedScale ? bagOf(selectedScale.id) : null;

  /**
   * 指定の重量計の「次に入るはずの投入前の表示値」。
   * 累積は袋の中だけで繋がる（袋を交換すると表示値が 0 に戻るため、重量計で繋ぐと
   * 交換のたびに前の袋の値が出てしまう）。袋の中では
   *   この画面の同じ袋の直前の投入後 → 保存済みの最後の投入後（日をまたいでも続く）
   *   → 袋の開始の表示値
   * の順に引き継ぐ。袋管理より前の明細は、従来どおり重量計で繋ぐ。
   */
  const chainValueOf = useCallback(
    (scaleId: string): number | null => {
      const bag = bagOf(scaleId);
      if (bag) {
        const last = [...entries].reverse().find((e) => e.bagId === bag.id && e.cumAfter !== "");
        if (last) return toNumOrNull(last.cumAfter);
        if (bag.lastCum !== null) return bag.lastCum;
        return bag.startCum;
      }
      const last = [...entries]
        .reverse()
        .find((e) => e.scaleId === scaleId && !e.bagId && e.cumAfter !== "");
      return last ? toNumOrNull(last.cumAfter) : null;
    },
    [entries, bagOf]
  );

  /**
   * AI読取の桁ズレ（10倍）判定に渡す「直前の表示値」。
   * 袋を開いた直後（まだ投入が無く開始が 0）は比べる相手がないので渡さない。
   * 前の袋の値と比べると、新しい袋の小さな表示を誤って弾いてしまう。
   */
  const lastCumAfterOf = useCallback(
    (scaleId: string): number | null => {
      const v = chainValueOf(scaleId);
      return v !== null && v > 0 ? v : null;
    },
    [chainValueOf]
  );

  const autoCumBefore = useMemo(() => {
    if (!selectedScale) return "";
    const v = chainValueOf(selectedScale.id);
    return v === null ? "" : String(v);
  }, [selectedScale, chainValueOf]);

  /**
   * 投入前の「機械の値」。AIで読み取れていればその値、無ければ連携値
   * （同じ箱の直前の投入後 → 朝礼後の累積値）。
   */
  const machineBefore = beforeRead ? String(beforeRead.value) : autoCumBefore;
  // 機械の値がまだ無いときは、理由なしでそのまま手入力できる
  const beforeLinked = machineBefore !== "";
  const beforeEditable = !beforeLinked || beforeFix;
  const cumBefore = beforeEditable ? beforeManual : machineBefore;
  // 機械の値から実際に変えたときだけ理由を必須にする（訂正を開いただけでは求めない）
  const beforeCorrected =
    beforeLinked &&
    beforeFix &&
    beforeManual.trim() !== "" &&
    toNumOrNull(beforeManual) !== toNumOrNull(machineBefore);

  // 投入後はAI読取だけが出どころ（連携値は無い）
  const machineAfter = afterRead ? String(afterRead.value) : "";
  const afterLinked = machineAfter !== "";
  const afterEditable = !afterLinked || afterFix;
  const cumAfter = afterEditable ? afterManual : machineAfter;
  const afterCorrected =
    afterLinked &&
    afterFix &&
    afterManual.trim() !== "" &&
    toNumOrNull(afterManual) !== toNumOrNull(machineAfter);

  /**
   * スクラップ重量 = 投入後 − 投入前。
   * スクラップ箱は常に重量計に載っているので、箱の重量は差で相殺される。
   */
  const scrapWeight = useMemo(() => {
    const b = toNumOrNull(cumBefore);
    const a = toNumOrNull(cumAfter);
    if (b === null || a === null) return null;
    return Math.round((a - b) * 1000) / 1000;
  }, [cumBefore, cumAfter]);

  /**
   * 投入前の読取値と連携値のずれ。合わないのは、前回の読み間違い・他部署の投入・
   * 箱の入れ替えのいずれか。止めはしないが必ず気づけるように出す。
   */
  const chainGap = useMemo(() => {
    if (!beforeRead || autoCumBefore === "") return null;
    const a = toNumOrNull(autoCumBefore);
    if (a === null) return null;
    return Math.round((beforeRead.value - a) * 1000) / 1000;
  }, [beforeRead, autoCumBefore]);

  const total = useMemo(
    () =>
      entries.reduce((t, e) => {
        return t + (entryWeight(e) ?? 0);
      }, 0),
    [entries]
  );
  const sairitsu = kaishu !== "" && total > 0 ? (toNum(kaishu) - total) / total : null;

  /** まだ保存していない投入のうち、いまの袋の分。締める前に保存してもらう。 */
  const currentBagUnsaved = useMemo(() => {
    if (!currentBag) return { count: 0, weight: 0 };
    const list = entries.slice(savedCount).filter((e) => e.bagId === currentBag.id);
    return {
      count: list.length,
      weight: list.reduce((t, e) => t + (entryWeight(e) ?? 0), 0),
    };
  }, [entries, savedCount, currentBag]);

  /** まだ保存できていない投入の件数と、未保存かどうか（保存ボタンの見た目に使う）。 */
  const unsavedCount = Math.max(0, entries.length - savedCount);
  const unsaved = unsavedCount > 0 || fieldsDirty;

  /** 袋に紐づいていない投入の件数（袋運用の期間なら、袋を開く前に記録した分）。 */
  const noBagCount = useMemo(() => entries.filter((e) => !e.bagId).length, [entries]);

  /** 明細に袋Noを出すための対応表（袋管理より前の明細は空欄になる）。 */
  const bagNoById = useMemo(
    () => new Map(dayBags.map((b) => [b.id, b.bagNo])),
    [dayBags]
  );

  function moveTo(next: { factory?: string }) {
    const q = new URLSearchParams(searchParams.toString());
    if (next.factory) q.set("factory", next.factory);
    router.push(`${pathname}?${q.toString()}`);
  }

  /** 投入1回分の入力をまっさらに戻す（箱を変えたとき・記録したあと）。 */
  function resetReading() {
    setBeforeRead(null);
    setAfterRead(null);
    setBeforeFix(false);
    setBeforeManual("");
    setBeforeReason("");
    setAfterFix(false);
    setAfterManual("");
    setAfterReason("");
  }

  function selectScale(scale: Scale) {
    setSelectedScale(scale);
    // 箱が変われば読み取った値も無効。投入前累積は autoCumBefore が箱ごとに引き継ぐ。
    resetReading();
    setMessage(null);
  }

  /**
   * 写真1枚の結果を受ける。QRが読めていれば箱を選び、表示値は投入前として採用する。
   * 箱が変わると読取値を捨ててしまうので、箱の確定を先に済ませてから値を入れる。
   */
  function onPhoto(phase: "before" | "after", r: ScalePhotoResult) {
    startTransition(async () => {
      let scale = selectedScale;
      if (r.qr) {
        const found = await lookupScaleByQrAction(r.qr.trim());
        if (found) {
          if (found.id !== selectedScale?.id) {
            setSelectedScale(found);
            resetReading();
          }
          scale = found;
        } else {
          setMessage({
            ok: false,
            text: `QRコード「${r.qr}」の重量計が見つかりません。一覧から選ぶか、管理者に登録を確認してください。`,
          });
        }
      }
      if (r.value === null) {
        // 理由（note）には撮り直しの案内まで入っている。二重に付けると長くて読めない。
        const note = r.note?.trim();
        setMessage({
          ok: false,
          title: "読み取れませんでした",
          text:
            note && note.includes("手入力")
              ? note
              : [note, "もう一度撮るか、手入力してください。"].filter(Boolean).join(" "),
        });
        // 読めなくても手入力できるよう、入力欄は開けておく
        if (phase === "before") setBeforeFix(true);
        else setAfterFix(true);
        return;
      }
      const read = { readId: r.readId, value: r.value };
      if (phase === "before") {
        setBeforeRead(read);
        setBeforeFix(false);
        setBeforeManual("");
        setBeforeReason("");
      } else {
        setAfterRead(read);
        setAfterFix(false);
        setAfterManual("");
        setAfterReason("");
      }
      const where = phase === "before" ? "投入前" : "投入後";
      setMessage({
        ok: true,
        title: `${where} ${fmt(r.value)} kg を読み取りました`,
        text:
          `${scale ? `「${scale.name}」の表示値です。` : ""}` +
          (r.confidence === "medium"
            ? "読み取りに少し自信がありません。値を確認してください。"
            : ""),
      });
    });
  }

  function onQrCode(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return;
    setQrInput("");
    startTransition(async () => {
      const scale = await lookupScaleByQrAction(trimmed);
      if (scale) {
        selectScale(scale);
        setMessage({ ok: true, text: `重量計「${scale.name}」（${scale.kind}）を選択しました。` });
      } else {
        setMessage({
          ok: false,
          text: `QRコード「${trimmed}」の重量計が見つかりません。重量計マスターの登録を管理者に確認してください。`,
        });
      }
    });
  }

  function addEntry() {
    setMessage(null);
    if (!selectedScale) {
      setMessage({ ok: false, text: "投入先のスクラップ箱（重量計）を選択してください。" });
      return;
    }
    const poly = source === "poly";
    const shipment = poly && pickedShipmentId ? shipmentById.get(pickedShipmentId) ?? null : null;
    if (poly && !shipment) {
      setMessage({
        ok: false,
        title: "プラ箱を選んでください",
        text: "どのプラ箱を投入するか、番号を選んでから記録してください。",
      });
      return;
    }
    if (shipment && shipment.hinshu !== selectedScale.kind) {
      setMessage({
        ok: false,
        title: "種類が違います",
        text: `プラ箱「${shipment.boxNo}」は ${shipment.hinshu} です。${shipment.hinshu} のスクラップ箱を選んでください。`,
      });
      return;
    }
    if (shipment && shipmentNeedsPolyTare(shipment) && toNumOrNull(polyTare) === null) {
      setMessage({
        ok: false,
        title: "プラ箱の重さを量ってください",
        text: `スクラップを空けたあとのプラ箱「${shipment.boxNo}」を量り、③ に入力してから記録してください。`,
      });
      return;
    }
    if (!poly && workplaces.length > 0 && !workplace) {
      setMessage({
        ok: false,
        title: "職場を選んでください",
        text: "どの職場のスクラップかを選んでから記録してください。",
      });
      return;
    }
    if (bagEra && !currentBag) {
      setMessage({
        ok: false,
        text: `「${selectedScale.name}」の袋が開いていません。新しいカゴと袋をセットして「袋を開始する」を押してください。`,
      });
      return;
    }
    if (toNumOrNull(cumBefore) === null) {
      setMessage({ ok: false, text: "投入前の表示値がありません。読み取るか手入力してください。" });
      return;
    }
    if (toNumOrNull(cumAfter) === null) {
      setMessage({ ok: false, text: "投入後の表示値がありません。読み取るか手入力してください。" });
      return;
    }
    if (scrapWeight !== null && scrapWeight < 0) {
      setMessage({
        ok: false,
        text: "投入後の表示値が投入前より小さくなっています。読み取りを確認してください。",
      });
      return;
    }
    if (beforeCorrected && !beforeReason.trim()) {
      setMessage({
        ok: false,
        text: `投入前の表示値を ${machineBefore} kg から変更しています。訂正理由を入力してください。`,
      });
      return;
    }
    if (afterCorrected && !afterReason.trim()) {
      setMessage({
        ok: false,
        text: `投入後の表示値を ${machineAfter} kg から変更しています。訂正理由を入力してください。`,
      });
      return;
    }
    const weight = scrapWeight;
    const next: EntryDraft[] = [
      ...entries,
      {
        jikoku: nowTime(), // 時刻は記録した時間が自動で入る
        scaleId: selectedScale.id,
        scaleName: selectedScale.name,
        bagId: currentBag?.id ?? null,
        kind: selectedScale.kind,
        // 新様式は表示値の差で出すので、投入前重量・箱重量は持たない
        gross: "",
        tare: "",
        cumBefore,
        cumAfter,
        cumBeforeReason: beforeCorrected ? beforeReason.trim() : "",
        cumAfterReason: afterCorrected ? afterReason.trim() : "",
        cumBeforeReadId: beforeRead?.readId ?? null,
        cumAfterReadId: afterRead?.readId ?? null,
        kirokusha: userName, // 記録者はログインユーザー
        ijo,
        // 発生元はExcelの記録票にしか無い項目（新しい画面では入力しない）
        // どの職場のスクラップか。紙の記録票の「部署」欄と同じ列に入れて、
        // 取り込んだ過去の記録と同じ切り口で集計できるようにする。
        // 届いたプラ箱は職場ではなく、送ってきた工場（プラ箱）で記録する
        busho: shipment ? "" : workplace,
        kikai: "",
        zairyo: "",
        kotei: "",
        shipmentId: shipment?.id ?? null,
        polyTare: shipment ? polyTare.trim() : "",
      },
    ];
    setEntries(next);
    // 次の投入に備えてクリア。投入前は今回の投入後が autoCumBefore として引き継がれる
    resetReading();
    setIjo("");

    // 記録したらそのまま保存する。以前は「記録する」→「保存」の2操作で、
    // 同じ見た目のボタンが並んで押し間違いが起きていた。保存に失敗したときだけ
    // 未保存として残り、画面下の「保存」で送り直せる。
    // プラ箱は送った工場で量った重量と突き合わせる
    const tareN = toNumOrNull(polyTare);
    const trial = shipment
      ? { ...shipment, received: { date, weight: weight ?? 0, polyTare: tareN, scaleName: "", kirokusha: "" } }
      : null;
    const gapText = trial ? `プラ箱「${trial.boxNo}」: ${polyGapText(trial)}。` : "";
    const gapLarge = trial ? shipmentGapLarge(trial) : false;
    if (shipment) {
      setPickedShipmentId(null);
      setPolyTare("");
    }
    setMessage({ ok: true, title: `${fmt(weight)} kg を記録しました`, text: `${gapText}保存しています…` });
    startTransition(async () => {
      const res = await saveDailyRecordAction(buildPayload(next));
      if (res.ok) {
        setSavedCount(next.length);
        setFieldsDirty(false);
        setMessage(
          gapLarge
            ? {
                ok: false,
                title: `${fmt(weight)} kg を記録しました（重量差を確認してください）`,
                text: `${gapText}送った工場で量った重量と差があります。プラ箱の取り違え・量り間違いがないか確かめてください。`,
              }
            : {
                ok: true,
                title: `${fmt(weight)} kg を記録しました`,
                text: `${gapText}保存しました。次の投入に進めます。`,
              }
        );
        router.refresh();
      } else {
        setMessage({
          ok: false,
          title: "保存できませんでした",
          text: `${res.message ?? ""} 記録は画面に残っています。画面下の「保存」でもう一度お試しください。`,
        });
      }
    });
  }

  function buildPayload(list: EntryDraft[] = entries) {
    return {
      recordDate: date,
      factory,
      sekininsha,
      kaishuSokuteichi: kaishu,
      tonyuKanryo,
      biko,
      entries: list.map((e) => ({
        jikoku: e.jikoku,
        hinshu: e.kind,
        scaleId: e.scaleId,
        scaleName: e.scaleName,
        bagId: e.bagId,
        grossWeight: e.gross,
        tareWeight: e.tare,
        cumBefore: e.cumBefore,
        cumAfter: e.cumAfter,
        cumBeforeReason: e.cumBeforeReason,
        cumAfterReason: e.cumAfterReason,
        cumBeforeReadId: e.cumBeforeReadId,
        cumAfterReadId: e.cumAfterReadId,
        kirokusha: e.kirokusha,
        ijo: e.ijo,
        busho: e.busho,
        kikai: e.kikai,
        zairyo: e.zairyo,
        kotei: e.kotei,
        shipmentId: e.shipmentId,
        polyTare: e.polyTare,
      })),
    };
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      const saving = entries.length;
      const res = await saveDailyRecordAction(buildPayload());
      setMessage({
        ok: res.ok,
        title: res.ok ? "保存しました" : "保存できませんでした",
        text: res.message ?? "",
      });
      if (res.ok) {
        setSavedCount(saving);
        setFieldsDirty(false);
        router.refresh();
      }
    });
  }

  function openFix(i: number) {
    const e = entries[i];
    setFixIndex(i);
    setFixDraft({ before: e.cumBefore, after: e.cumAfter, polyTare: e.polyTare, reason: "" });
    setFixMessage(null);
  }

  /** 明細の要約（備考に残す履歴用）。例: 10:32 銅ダライ 12→24.3 kg（12.3 kg） プラ箱 本社工場-1005-01 */
  function entrySummary(e: EntryDraft): string {
    const sh = e.shipmentId ? shipmentById.get(e.shipmentId) : undefined;
    return [
      e.jikoku,
      e.kind,
      `${fmt(toNumOrNull(e.cumBefore))}→${fmt(toNumOrNull(e.cumAfter))} kg（${fmt(entryWeight(e))} kg）`,
      e.busho,
      sh ? `プラ箱 ${sh.boxNo}` : "",
    ]
      .filter(Boolean)
      .join(" ");
  }

  /**
   * 直した・取り消した明細を保存する。保存できたときだけ画面に反映し、
   * 元の値は備考に履歴として残す（明細からは消えるため、誰がいつ何を変えたかを残す）。
   */
  function commitFix(next: EntryDraft[], log: string, doneTitle: string) {
    const nextBiko = [biko.trim(), log].filter(Boolean).join("\n");
    setFixMessage(null);
    startTransition(async () => {
      const res = await saveDailyRecordAction({ ...buildPayload(next), biko: nextBiko });
      if (res.ok) {
        setEntries(next);
        setBiko(nextBiko);
        setSavedCount(next.length);
        setFieldsDirty(false);
        setFixIndex(null);
        setFixMessage({ ok: true, title: doneTitle, text: res.message ?? "" });
        router.refresh();
      } else {
        setFixMessage({ ok: false, title: "保存できませんでした", text: res.message ?? "" });
      }
    });
  }

  /** 記録済みの行の表示値（とプラ箱の重さ）を直す。 */
  function fixEntry() {
    if (fixIndex === null) return;
    const e = entries[fixIndex];
    const reason = fixDraft.reason.trim();
    const b = toNumOrNull(fixDraft.before);
    const a = toNumOrNull(fixDraft.after);
    const sh = e.shipmentId ? shipmentById.get(e.shipmentId) : undefined;
    const fail = (text: string) => setFixMessage({ ok: false, title: "直せません", text });
    if (b === null || a === null) return fail("投入前と投入後の表示値を入力してください。");
    if (a < b) return fail("投入後の表示値が投入前より小さくなっています。");
    const tare = toNumOrNull(fixDraft.polyTare);
    if (sh && shipmentNeedsPolyTare(sh) && tare === null) {
      return fail(`プラ箱「${sh.boxNo}」の重さ（空けたあと）を入力してください。`);
    }
    const beforeChanged = b !== toNumOrNull(e.cumBefore);
    const afterChanged = a !== toNumOrNull(e.cumAfter);
    const tareChanged = Boolean(sh) && tare !== toNumOrNull(e.polyTare);
    if (!beforeChanged && !afterChanged && !tareChanged) return fail("値が変わっていません。");
    if (!reason) return fail("直す理由を入力してください（例: 投入後の読み間違い）。");

    const fixed: EntryDraft = {
      ...e,
      cumBefore: String(b),
      cumAfter: String(a),
      cumBeforeReason: beforeChanged ? reason.slice(0, 200) : e.cumBeforeReason,
      cumAfterReason: afterChanged ? reason.slice(0, 200) : e.cumAfterReason,
      polyTare: sh ? (tare === null ? "" : String(tare)) : e.polyTare,
    };
    const next = [...entries];
    next[fixIndex] = fixed;
    if (afterChanged) {
      noteChainBreak(next, nextInChain(next, fixIndex), fixed.cumAfter, `前の記録（${e.jikoku}）の投入後を訂正したため`);
    }
    const changes = [
      beforeChanged ? `投入前 ${fmt(toNumOrNull(e.cumBefore))}→${fmt(b)}` : "",
      afterChanged ? `投入後 ${fmt(toNumOrNull(e.cumAfter))}→${fmt(a)}` : "",
      tareChanged ? `プラ箱の重さ ${fmt(toNumOrNull(e.polyTare))}→${fmt(tare)}` : "",
    ].filter(Boolean);
    commitFix(
      next,
      `【訂正 ${stampNow()} ${userName}】${entrySummary(e)}：${changes.join("、")}。理由: ${reason}`,
      `${e.jikoku} の記録を直しました`
    );
  }

  /** 記録済みの行を取り消す（明細から外す）。プラ箱の行なら、そのプラ箱は未処理に戻る。 */
  function deleteEntry() {
    if (fixIndex === null) return;
    const e = entries[fixIndex];
    const reason = fixDraft.reason.trim();
    if (!reason) {
      setFixMessage({
        ok: false,
        title: "取り消せません",
        text: "取り消す理由を入力してください（例: 重量の入力ミスのため入れ直す）。",
      });
      return;
    }
    const sh = e.shipmentId ? shipmentById.get(e.shipmentId) : undefined;
    if (!confirm(`${e.jikoku} ${e.kind} ${fmt(entryWeight(e))} kg の記録を取り消します。よろしいですか？`)) return;
    const j = nextInChain(entries, fixIndex);
    const next = entries.filter((_, k) => k !== fixIndex);
    // 取り消した行の投入前が、次の行の本来の投入前になる
    noteChainBreak(next, j < 0 ? -1 : j - 1, e.cumBefore, `前の記録（${e.jikoku}）を取り消したため`);
    commitFix(
      next,
      `【取り消し ${stampNow()} ${userName}】${entrySummary(e)}。理由: ${reason}`,
      sh
        ? `${e.jikoku} の記録を取り消しました（プラ箱「${sh.boxNo}」は未処理に戻りました）`
        : `${e.jikoku} の記録を取り消しました`
    );
  }

  function approve() {
    startTransition(async () => {
      const res = await approveDailyRecordAction(date, factory);
      setMessage({ ok: res.ok, text: res.message ?? "" });
      if (res.ok) router.refresh();
    });
  }

  function reject() {
    const comment = prompt("承認を取り消す理由（記録者に表示されます）");
    if (comment === null) return;
    startTransition(async () => {
      const res = await rejectDailyRecordAction(date, factory, comment);
      setMessage({ ok: res.ok, text: res.message ?? "" });
      if (res.ok) router.refresh();
    });
  }

  /** 記録済みの行を直す・取り消す欄（開いている行の下に出す）。 */
  function fixPanel(e: EntryDraft) {
    const legacy = e.gross !== "" || e.tare !== "";
    const sh = e.shipmentId ? shipmentById.get(e.shipmentId) : undefined;
    const set = (k: keyof typeof fixDraft) => (ev: React.ChangeEvent<HTMLInputElement>) =>
      setFixDraft((d) => ({ ...d, [k]: ev.target.value }));
    return (
      <div className="mt-2 space-y-3 rounded-xl border border-[#b4632c] bg-[#fff8f2] p-3 text-left text-sm whitespace-normal">
        <p className="font-bold text-[#333333]">
          {e.jikoku} {e.kind} {fmt(entryWeight(e))} kg の記録を直す・取り消す
        </p>
        {!legacy && (
          <div className="grid grid-cols-2 gap-2 sm:max-w-md">
            <label className="flex flex-col gap-1 text-xs text-[#707070]">
              投入前の表示値(kg)
              <input type="number" inputMode="decimal" step="0.1" value={fixDraft.before} onChange={set("before")} className={numInput} />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[#707070]">
              投入後の表示値(kg)
              <input type="number" inputMode="decimal" step="0.1" value={fixDraft.after} onChange={set("after")} className={numInput} />
            </label>
            {sh && (
              <label className="col-span-2 flex flex-col gap-1 text-xs text-[#707070]">
                空けたあとのプラ箱の重さ(kg)
                <input type="number" inputMode="decimal" step="0.1" value={fixDraft.polyTare} onChange={set("polyTare")} className={numInput} />
              </label>
            )}
          </div>
        )}
        <label className="flex flex-col gap-1 text-xs text-[#707070] sm:max-w-md">
          理由（必須）
          <input
            type="text"
            value={fixDraft.reason}
            onChange={set("reason")}
            className={input}
            placeholder="例: 投入後の読み間違い／入力ミスのため入れ直す"
          />
        </label>
        <p className="text-xs text-[#707070]">
          元の値・理由・直した人は備考に残ります。
          {sh && `取り消すと、プラ箱「${sh.boxNo}」は未処理に戻り、選び直して記録できます。`}
        </p>
        {fixMessage && !fixMessage.ok && <ResultBanner msg={fixMessage} />}
        <div className="flex flex-wrap gap-2">
          {!legacy && (
            <button
              type="button"
              onClick={fixEntry}
              disabled={pending}
              className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-[#b4632c] px-4 font-bold text-white disabled:opacity-50 sm:h-10"
            >
              <Pencil className="h-4 w-4" />
              この値に直す
            </button>
          )}
          <button
            type="button"
            onClick={deleteEntry}
            disabled={pending}
            className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-[#dc000c] bg-white px-4 font-bold text-[#dc000c] disabled:opacity-50 sm:h-10"
          >
            <Trash2 className="h-4 w-4" />
            この記録を取り消す
          </button>
          <button
            type="button"
            onClick={() => {
              setFixIndex(null);
              setFixMessage(null);
            }}
            disabled={pending}
            className="h-11 rounded-lg px-3 text-[#707070] sm:h-10"
          >
            やめる
          </button>
        </div>
      </div>
    );
  }

  /** 行の「直す・取り消す」ボタン。編集できる日だけ出す。 */
  function fixButton(i: number) {
    if (locked) return null;
    return (
      <button
        type="button"
        onClick={() => (fixIndex === i ? setFixIndex(null) : openFix(i))}
        disabled={pending}
        aria-expanded={fixIndex === i}
        className="inline-flex items-center gap-1 rounded-md border border-[#e5e5e5] bg-white px-2 py-1 text-xs font-bold text-[#555555] hover:border-[#b4632c] disabled:opacity-50"
      >
        <Pencil className="h-3 w-3" />
        直す・取り消す
      </button>
    );
  }

  // 一覧選択用。種類ごとにまとめ、種類マスタの並び順で出す（マスタに無い種類は末尾）
  const kindOrder = useMemo(() => new Map(kinds.map((k, i) => [k.name, i])), [kinds]);
  const scaleGroups = useMemo(() => {
    const map = new Map<string, Scale[]>();
    for (const s of scales.filter((s) => s.active)) {
      if (!map.has(s.kind)) map.set(s.kind, []);
      map.get(s.kind)!.push(s);
    }
    return [...map.keys()]
      .sort((a, b) => (kindOrder.get(a) ?? 999) - (kindOrder.get(b) ?? 999) || a.localeCompare(b))
      .map((kind) => ({ kind, items: map.get(kind)! }));
  }, [scales, kindOrder]);

  /** 選択肢の表示名。設備番号があれば先頭に付けて現場の呼び名と一致させる */
  const scaleLabel = (s: Scale) => (s.equipNo ? `${s.equipNo}　${s.name}` : s.name);

  return (
    <div className="space-y-3 pb-24 sm:space-y-4 sm:pb-0">
      {/* 対象日・工場・状態 */}
      <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="flex flex-col gap-1 text-xs text-[#707070]">
            対象日
            <DateNav date={date} />
          </div>
          <div className="flex flex-col gap-1 text-xs text-[#707070] sm:w-44">
            工場
            {factoryLocked ? (
              <span className="flex h-11 items-center rounded-lg border border-[#e5e5e5] bg-[#f7f7f5] px-3 text-sm text-[#333333] sm:h-10">
                {factory}
              </span>
            ) : (
              <select
                value={factory}
                onChange={(e) => moveTo({ factory: e.target.value })}
                className={input}
              >
                {!factoryOptions.includes(factory) && <option value={factory}>{factory}</option>}
                {factoryOptions.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="flex flex-col gap-1 text-xs text-[#707070] sm:w-56">
            当番責任者
            <input
              type="text"
              value={sekininsha}
              onChange={(e) => {
                setSekininsha(e.target.value);
                setFieldsDirty(true);
              }}
              className={input}
              placeholder={userName}
              disabled={locked}
            />
          </div>
          <div className="flex items-center gap-2 text-xs text-[#707070] sm:flex-col sm:items-start sm:gap-1">
            状態
            <span className="sm:py-1">
              <StatusBadge status={status} />
              {status === "approved" && initial?.approvedBy && (
                <span className="ml-2 text-xs text-[#707070]">承認: {initial.approvedBy}</span>
              )}
              {status === "pending" && initial?.appliedBy && (
                <span className="ml-2 text-xs text-[#707070]">申請: {initial.appliedBy}</span>
              )}
            </span>
          </div>
        </div>
        {locked && (
          <p className="mt-3 rounded-lg bg-[#fff3e0] px-3 py-2 text-sm text-[#a15c00]">
            {status === "pending"
              ? "申請中のため編集できません。承認者の確認をお待ちください。"
              : "承認済みの記録です。修正が必要な場合は承認者へ連絡してください。"}
          </p>
        )}
        {status === "rejected" && initial?.rejectComment && (
          <p className="mt-3 rounded-lg bg-[#fdecea] px-3 py-2 text-sm text-[#dc000c]">
            差し戻し（{initial.approvedBy}）: {initial.rejectComment}
          </p>
        )}
      </section>

      {/* 【1】スクラップ箱と投入前の表示値を、写真1枚から読み取る */}
      {!locked && (
        <Step
          n={1}
          title="スクラップ箱と投入前を読み取る"
          hint="重量計のQRコードと表示部の両方が写るように1枚撮ると、箱の種類と投入前の表示値が自動で入ります。"
        >
          {selectedScale ? (
            <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-[#b4632c] bg-[#faf6ef] px-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-[#b4632c]">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <span className="truncate">{scaleLabel(selectedScale)}</span>
                <KindTag kind={selectedScale.kind} order={kindOrder.get(selectedScale.kind)} />
              </span>
              <button
                onClick={() => {
                  setSelectedScale(null);
                  resetReading();
                }}
                className="shrink-0 rounded-lg px-2 py-1 text-xs text-[#96521f] underline"
              >
                変更
              </button>
            </div>
          ) : (
            <p className="mb-3 rounded-lg bg-[#f7f7f5] px-3 py-2 text-sm text-[#707070]">
              スクラップ箱が未選択です。
            </p>
          )}

          {/*
            いまの袋。袋は「開いてから交換するまで」が1区切りで、1日に何度も変わり、
            夜勤帯の投入で翌日まで続くこともある。袋が開いていないと投入は記録できない。
          */}
          {selectedScale && bagEra && (
            <ScrapBagPanel
              date={date}
              factory={factory}
              scale={selectedScale}
              bag={currentBag}
              unsavedCount={currentBagUnsaved.count}
              unsavedWeight={currentBagUnsaved.weight}
              onMessage={setMessage}
            />
          )}

          <div className="mb-3">
            <ScaleCamera
              phase="before"
              recordDate={date}
              factory={factory}
              scaleId={selectedScale?.id ?? null}
              expectedFor={(qr) => {
                // 撮った写真のQRで箱を決めてから、その箱の引き継ぎ値を返す
                const target = (qr && scaleByQr.get(qr.trim())) || selectedScale;
                return target ? lastCumAfterOf(target.id) : null;
              }}
              needQr
              label="重量計を撮って読み取る"
              onResult={(r) => onPhoto("before", r)}
              onError={(text) => setMessage({ ok: false, text })}
            />
            {messageBanner}
          </div>

          {/* 投入前の表示値。読み取れた値をそのまま使い、違うときだけ訂正する */}
          <div className="flex flex-col gap-1 text-xs text-[#707070]">
            <span className="flex items-center justify-between gap-1">
              <span className="flex items-center gap-1.5">
                <FieldNo n="①" />
                投入前の表示値 kg
                {beforeRead && !beforeFix && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[#eef1f4] px-1.5 py-0.5 text-[11px] font-bold text-[#0b5ca8]">
                    <Sparkles className="h-3 w-3" />
                    AI読取
                  </span>
                )}
              </span>
              {beforeLinked && !beforeFix && (
                <button
                  type="button"
                  onClick={() => {
                    setBeforeFix(true);
                    setBeforeManual(machineBefore);
                  }}
                  className="rounded px-1 text-xs font-semibold text-[#b4632c] underline"
                >
                  訂正
                </button>
              )}
            </span>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              value={cumBefore}
              onChange={(e) => setBeforeManual(e.target.value)}
              readOnly={!beforeEditable}
              aria-label="投入前の表示値 kg"
              className={`${numInput} w-full sm:w-56 ${!beforeEditable ? "bg-[#f0f0ee] text-[#555555]" : ""}`}
            />
          </div>

          {beforeRead && !beforeFix && chainGap !== null && Math.abs(chainGap) > 0.5 && (
            <p className="mt-1.5 text-xs text-[#dc000c]">
              前回の投入後の {autoCumBefore} kg と {fmt(Math.abs(chainGap))} kg
              ずれています。別の人が投入した、箱を入れ替えた、前回の読み取り誤りなどが考えられます。
            </p>
          )}
          {!beforeRead && beforeLinked && !beforeFix && (
            <p className="mt-1.5 text-xs text-[#909090]">
              前の投入の「投入後の表示値」が自動で入っています。
              　写真を撮ると読み取った値に置き換わります。
            </p>
          )}
          {!beforeLinked && selectedScale && (
            <p className="mt-1.5 text-xs text-[#a15c00]">
              まだ読み取っていません。写真を撮るか、表示値を手入力してください。
            </p>
          )}
          {beforeFix && (
            <div className="mt-2 rounded-lg border border-[#b4632c] bg-[#faf6ef] p-3">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#96521f]">
                  手入力中（機械の値 {machineBefore || "—"} kg）
                </span>
                {beforeLinked && (
                  <button
                    type="button"
                    onClick={() => {
                      setBeforeFix(false);
                      setBeforeManual("");
                      setBeforeReason("");
                    }}
                    className="rounded px-1 text-xs font-semibold text-[#96521f] underline"
                  >
                    機械の値に戻す
                  </button>
                )}
              </div>
              {beforeLinked && (
                <>
                  <input
                    type="text"
                    value={beforeReason}
                    onChange={(e) => setBeforeReason(e.target.value)}
                    placeholder="訂正理由（例: 表示が反射して読めない、前回の読み取り誤り）"
                    aria-label="投入前の訂正理由"
                    className={`${input} w-full`}
                  />
                  {beforeCorrected && !beforeReason.trim() && (
                    <p className="mt-1 text-xs text-[#dc000c]">訂正理由を入力してください。</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* QRが読めないとき・貼り付けが剥がれたときのために一覧からも選べるようにする */}
          {scales.length === 0 ? (
            <p className="mt-3 rounded-lg bg-[#fff3e0] px-3 py-2 text-sm text-[#a15c00]">
              重量計（スクラップ箱）が未登録です。管理者に「重量計マスター」への登録を依頼してください。
            </p>
          ) : (
            <label className="mt-3 flex flex-col gap-1 text-xs font-bold text-[#707070]">
              一覧から選ぶ（QRが読めないとき）
              <select
                value={selectedScale?.id ?? ""}
                onChange={(e) => {
                  const next = scales.find((s) => s.id === e.target.value);
                  if (next) selectScale(next);
                  else {
                    setSelectedScale(null);
                    resetReading();
                  }
                }}
                className={`${input} w-full sm:w-96`}
              >
                <option value="">選択してください（{scales.length}台）</option>
                {scaleGroups.map((g) => (
                  <optgroup key={g.kind} label={`${g.kind}（${g.items.length}台）`}>
                    {g.items.map((scale) => (
                      <option key={scale.id} value={scale.id}>
                        {scaleLabel(scale)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          )}

          {/* ハンディスキャナ入力（PC/据置端末向け） */}
          <div className="relative mt-3 hidden sm:block">
            <QrCode className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#909090]" />
            <input
              type="text"
              value={qrInput}
              onChange={(e) => setQrInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onQrCode(qrInput);
                }
              }}
              placeholder="QRコードを読み取り（スキャナ/手入力→Enter）"
              className={`${input} w-full pl-9 sm:w-96`}
            />
          </div>
        </Step>
      )}

      {/* 【2】投入して、投入後の表示値を読み取る */}
      {!locked && (
        <Step
          n={2}
          title="投入して、投入後を読み取る"
          hint="スクラップ重量 = 投入後の表示値 − 投入前の表示値。箱は重量計に載ったままなので箱の重量は相殺されます。"
        >
          {/*
            どの職場のスクラップか。前回選んだ職場（無ければ所属職場）が最初から選ばれている。
            ボタンの色は読み取り（青）・記録（オレンジ）と重ならないよう、濃いグレーにする。
          */}
          {shipFrom.length > 0 && (
            <div className="mb-4">
              <div className="mb-1.5 text-sm font-bold text-[#333333]">どこのスクラップですか</div>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="どこのスクラップか">
                {(
                  [
                    ["own", `${factory}（自工場）`],
                    ["poly", "他工場から届いたプラ箱"],
                  ] as const
                ).map(([v, label]) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={source === v}
                    onClick={() => {
                      setSource(v);
                      setPickedShipmentId(null);
                    }}
                    className={`inline-flex h-11 items-center gap-1.5 rounded-lg border px-4 text-base font-semibold sm:h-10 sm:text-sm ${
                      source === v
                        ? "border-[#333333] bg-[#333333] text-white"
                        : "border-[#cfcac3] bg-white text-[#555555] hover:bg-[#f7f7f5]"
                    }`}
                  >
                    {v === "poly" && <Truck className="h-4 w-4" />}
                    {label}
                  </button>
                ))}
              </div>
              {source === "poly" &&
                (() => {
                  // まだ処理していないプラ箱（この画面で記録済みのものは除く）
                  const usedIds = new Set(entries.map((e) => e.shipmentId).filter(Boolean));
                  const open = shipments.filter((sh) => !sh.received && !usedIds.has(sh.id));
                  const fit = selectedScale ? open.filter((sh) => sh.hinshu === selectedScale.kind) : open;
                  const otherKind = open.length - fit.length;
                  return (
                    <div className="mt-3">
                      <div className="mb-1.5 text-sm font-bold text-[#333333]">
                        投入するプラ箱の番号を選んでください
                      </div>
                      {fit.length === 0 ? (
                        <p className="rounded-lg bg-[#fff3e0] px-3 py-2 text-sm text-[#a15c00]">
                          {open.length === 0
                            ? `届いているプラ箱はありません（${shipFrom.join("・")}で出荷を登録すると出ます）。`
                            : `${selectedScale?.kind ?? ""} のプラ箱はありません。`}
                        </p>
                      ) : (
                        <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="プラ箱">
                          {fit.map((sh) => (
                            <button
                              key={sh.id}
                              type="button"
                              role="radio"
                              aria-checked={pickedShipmentId === sh.id}
                              onClick={() => {
                                if (pickedShipmentId !== sh.id) setPolyTare("");
                                setPickedShipmentId(sh.id);
                              }}
                              className={`rounded-xl border-2 px-3 py-2 text-left ${
                                pickedShipmentId === sh.id
                                  ? "border-[#333333] bg-[#f0f0ee]"
                                  : "border-[#e5e5e5] bg-white hover:bg-[#f7f7f5]"
                              }`}
                            >
                              <div className="font-mono text-base font-bold text-[#333333] sm:text-sm">{sh.boxNo}</div>
                              <div className="text-xs text-[#707070]">
                                {sh.fromFactory} ／ {sh.shipDate} 出荷 ／ {sh.hinshu} ／ 出荷時{" "}
                                {sh.grossWeight !== null && sh.tareWeight === null
                                  ? `${fmt(sh.grossWeight)} kg（プラ箱込み）`
                                  : `${fmt(sh.weight)} kg`}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                      {otherKind > 0 && (
                        <p className="mt-1.5 text-xs text-[#707070]">
                          ほかの種類のプラ箱が {otherKind} 箱あります。その種類のスクラップ箱を選ぶと出ます。
                        </p>
                      )}
                    </div>
                  );
                })()}
            </div>
          )}

          {source === "own" && workplaces.length > 0 && (
            <div className="mb-4">
              <div className="mb-1.5 text-sm font-bold text-[#333333]">どの職場のスクラップですか</div>
              {workplaces.length <= 8 ? (
                <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="職場">
                  {workplaces.map((w) => (
                    <button
                      key={w}
                      type="button"
                      role="radio"
                      aria-checked={workplace === w}
                      onClick={() => setWorkplace(w)}
                      className={`inline-flex h-11 items-center rounded-lg border px-4 text-base font-semibold sm:h-10 sm:text-sm ${
                        workplace === w
                          ? "border-[#333333] bg-[#333333] text-white"
                          : "border-[#cfcac3] bg-white text-[#555555] hover:bg-[#f7f7f5]"
                      }`}
                    >
                      {w}
                    </button>
                  ))}
                </div>
              ) : (
                <select
                  value={workplace}
                  onChange={(e) => setWorkplace(e.target.value)}
                  aria-label="職場"
                  className={`${input} w-full sm:w-72`}
                >
                  <option value="">選択してください</option>
                  {workplaces.map((w) => (
                    <option key={w} value={w}>
                      {w}
                    </option>
                  ))}
                </select>
              )}
              {!workplace && (
                <p className="mt-1.5 text-xs text-[#a15c00]">職場を選んでから記録してください。</p>
              )}
            </div>
          )}

          {/* ③ 投入のアナウンス。どの箱に入れるのかを取り違えないように大きく出す */}
          {selectedScale && toNumOrNull(cumBefore) !== null ? (
            <div className="mb-4 flex items-start gap-3 rounded-xl border-2 border-[#b4632c] bg-[#faf6ef] px-4 py-3.5">
              <PackagePlus className="mt-0.5 h-6 w-6 shrink-0 text-[#b4632c]" />
              <div className="min-w-0">
                <p className="text-base font-bold text-[#b4632c] sm:text-sm">
                  「{selectedScale.name}」にスクラップを投入してください
                </p>
                <p className="mt-0.5 text-xs text-[#96521f]">
                  種類は{selectedScale.kind}です。投入が終わったら、下のボタンで投入後の表示値を読み取ります。
                </p>
              </div>
            </div>
          ) : (
            <p className="mb-4 rounded-lg bg-[#f7f7f5] px-3 py-3 text-sm text-[#707070]">
              先に1でスクラップ箱と投入前の表示値を読み取ってください。
            </p>
          )}

          <div className="mb-3">
            <ScaleCamera
              phase="after"
              recordDate={date}
              factory={factory}
              scaleId={selectedScale?.id ?? null}
              expectedFor={() => toNumOrNull(cumBefore)}
              needQr={false}
              label="投入後を撮って読み取る"
              disabled={!selectedScale || toNumOrNull(cumBefore) === null}
              onResult={(r) => onPhoto("after", r)}
              onError={(text) => setMessage({ ok: false, text })}
            />
          </div>

          {/* ④ 投入後の表示値 */}
          <div className="flex flex-col gap-1 text-xs text-[#707070]">
            <span className="flex items-center justify-between gap-1">
              <span className="flex items-center gap-1.5">
                <FieldNo n="②" />
                投入後の表示値 kg
                {afterRead && !afterFix && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[#eef1f4] px-1.5 py-0.5 text-[11px] font-bold text-[#0b5ca8]">
                    <Sparkles className="h-3 w-3" />
                    AI読取
                  </span>
                )}
              </span>
              {afterLinked && !afterFix && (
                <button
                  type="button"
                  onClick={() => {
                    setAfterFix(true);
                    setAfterManual(machineAfter);
                  }}
                  className="rounded px-1 text-xs font-semibold text-[#b4632c] underline"
                >
                  訂正
                </button>
              )}
            </span>
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              value={cumAfter}
              onChange={(e) => setAfterManual(e.target.value)}
              readOnly={!afterEditable}
              aria-label="投入後の表示値 kg"
              className={`${numInput} w-full sm:w-56 ${!afterEditable ? "bg-[#f0f0ee] text-[#555555]" : ""}`}
            />
          </div>
          {afterFix && (
            <div className="mt-2 rounded-lg border border-[#b4632c] bg-[#faf6ef] p-3">
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#96521f]">
                  手入力中（AI読取値 {machineAfter || "—"} kg）
                </span>
                {afterLinked && (
                  <button
                    type="button"
                    onClick={() => {
                      setAfterFix(false);
                      setAfterManual("");
                      setAfterReason("");
                    }}
                    className="rounded px-1 text-xs font-semibold text-[#96521f] underline"
                  >
                    AI読取値に戻す
                  </button>
                )}
              </div>
              {afterLinked && (
                <>
                  <input
                    type="text"
                    value={afterReason}
                    onChange={(e) => setAfterReason(e.target.value)}
                    placeholder="訂正理由（例: 表示が揺れていた、桁を読み違えていた）"
                    aria-label="投入後の訂正理由"
                    className={`${input} w-full`}
                  />
                  {afterCorrected && !afterReason.trim() && (
                    <p className="mt-1 text-xs text-[#dc000c]">訂正理由を入力してください。</p>
                  )}
                </>
              )}
            </div>
          )}

          <div
            className={`mt-4 flex items-center justify-between rounded-xl border px-4 py-3 ${
              scrapWeight !== null && scrapWeight < 0
                ? "border-[#dc000c] bg-[#fdecea]"
                : "border-[#e5e5e5] bg-[#f7f7f5]"
            }`}
          >
            <span className="text-sm text-[#707070]">スクラップ重量（②−①）</span>
            <span
              className={`text-2xl font-bold tabular-nums ${
                scrapWeight !== null && scrapWeight < 0 ? "text-[#dc000c]" : "text-[#333333]"
              }`}
            >
              {scrapWeight !== null ? `${fmt(scrapWeight)} kg` : "—"}
            </span>
          </div>
          {scrapWeight !== null && scrapWeight < 0 && (
            <p className="mt-1.5 text-xs text-[#dc000c]">
              投入後の表示値が投入前より小さくなっています。読み取りを確認してください。
            </p>
          )}

          {/*
            ③ 他工場のプラ箱は、スクラップを空けたあとのプラ箱を量る（異常メモは ④ に繰り下げる）。
            送った工場はプラ箱ごと量っているので、投入重量 ＋ プラ箱 で突き合わせる。
          */}
          {source === "poly" &&
            pickedShipmentId &&
            (() => {
              const sh = shipmentById.get(pickedShipmentId);
              if (!sh) return null;
              const tareN = toNumOrNull(polyTare);
              const sum = scrapWeight !== null && tareN !== null ? scrapWeight + tareN : null;
              return (
                <div className="mt-4 rounded-xl border-2 border-[#0b5ca8] bg-[#f3f7fb] p-3">
                  <label className="flex flex-col gap-1 text-xs text-[#707070]">
                    <span className="flex items-center gap-1.5 text-sm font-bold text-[#333333]">
                      <FieldNo n="③" />
                      空けたあとのプラ箱の重さ kg
                    </span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      min="0"
                      value={polyTare}
                      onChange={(e) => setPolyTare(e.target.value)}
                      aria-label="空けたあとのプラ箱の重さ kg"
                      className={`${numInput} w-full`}
                    />
                  </label>
                  <div className="mt-2">
                    <ScaleCamera
                      phase="after"
                      recordDate={date}
                      factory={factory}
                      needQr={false}
                      label="空のプラ箱を撮って読み取る"
                      disabled={pending}
                      onResult={(r) => {
                        if (r.value === null) {
                          const n = r.note?.trim();
                          setMessage({
                            ok: false,
                            title: "読み取れませんでした",
                            text:
                              n && n.includes("手入力")
                                ? n
                                : [n, "もう一度撮るか、手入力してください。"].filter(Boolean).join(" "),
                          });
                          return;
                        }
                        setPolyTare(String(r.value));
                        setMessage({ ok: true, title: `プラ箱の重さ ${fmt(r.value)} kg を読み取りました`, text: "" });
                      }}
                      onError={(text) => setMessage({ ok: false, text })}
                    />
                  </div>
                  <p className="mt-2 text-sm tabular-nums text-[#333333]">
                    スクラップ {fmt(scrapWeight)} ＋ プラ箱 {fmt(tareN)} ＝{" "}
                    <strong>{fmt(sum)} kg</strong>
                    <span className="text-[#707070]">
                      {" "}
                      ／ {sh.fromFactory}で{" "}
                      {fmt(sh.grossWeight !== null && sh.tareWeight === null ? sh.grossWeight : sh.weight)} kg
                      {sh.grossWeight !== null && sh.tareWeight === null ? "（プラ箱込み）" : ""}
                    </span>
                  </p>
                </div>
              );
            })()}

          {/* 異常メモ */}
          <label className="mt-4 flex flex-col gap-1 text-xs text-[#707070]">
            <span className="flex items-center gap-1.5">
              <FieldNo n={source === "poly" && pickedShipmentId ? "④" : "③"} />
              異常メモ
            </span>
            <input
              type="text"
              value={ijo}
              onChange={(e) => setIjo(e.target.value)}
              placeholder="異常があれば記入（例: 異物混入、表示が不安定）"
              className={`${input} w-full`}
            />
          </label>

          {/*
            結果は記録ボタンの「上」に出す。下に置くと、画面下に固定した保存バーに
            隠れて読み飛ばされる（現場から報告あり）。
          */}
          {messageBanner}

          <button
            onClick={addEntry}
            disabled={pending || (bagEra && !currentBag)}
            /*
              この画面の主操作。読み取り（青・高さ12）と間違えないよう、オレンジの塗りは
              このボタンだけにし、背を高く（16）して間隔も広く取る。
            */
            className="mt-6 inline-flex h-16 w-full items-center justify-center gap-2 rounded-2xl bg-[#b4632c] text-lg font-bold text-white shadow-sm hover:bg-[#96521f] disabled:opacity-50 sm:h-12 sm:w-auto sm:px-8 sm:text-base"
          >
            <Plus className="h-6 w-6 sm:h-5 sm:w-5" />
            投入完了として記録する
          </button>
          {selectedScale && bagEra && !currentBag && (
            <p className="mt-1.5 text-xs text-[#a15c00]">
              「{selectedScale.name}」の袋が開いていません。1の「袋を開始する」から始めてください。
            </p>
          )}
        </Step>
      )}

      {/* 本日の記録一覧（モバイル=カード、PC=表） */}
      <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-[#333333] sm:text-sm">
            本日の記録（{entries.length}件）
          </h2>
          <span className="text-sm">
            合計 <span className="text-lg font-bold tabular-nums">{fmt(total)}</span> kg
          </span>
        </div>

        {fixMessage?.ok && <ResultBanner msg={fixMessage} className="mb-3" />}
        {entries.length === 0 ? (
          <p className="rounded-lg bg-[#f7f7f5] px-3 py-3 text-sm text-[#707070]">
            まだ投入記録がありません。
          </p>
        ) : (
          <>
            {/* モバイル: カード */}
            <ul className="space-y-2 sm:hidden">
              {entries.map((e, i) => {
                const w = entryWeight(e);
                const cb = toNumOrNull(e.cumBefore);
                const ca = toNumOrNull(e.cumAfter);
                const reason = entryReason(e);
                const origin = entryOrigin(e);
                return (
                  <li key={i} className="rounded-xl border border-[#e5e5e5] p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold tabular-nums">{e.jikoku}</span>
                          <KindTag kind={e.kind} order={kindOrder.get(e.kind)} />
                          {e.busho && (
                            <span className="rounded-md bg-[#f0f0ee] px-1.5 py-0.5 text-[11px] font-bold text-[#333333]">
                              {e.busho}
                            </span>
                          )}
                          {e.shipmentId && <PolyTag sh={shipmentById.get(e.shipmentId)} weight={toNumOrNull(e.cumAfter) !== null && toNumOrNull(e.cumBefore) !== null ? toNum(e.cumAfter) - toNum(e.cumBefore) : null} polyTare={toNumOrNull(e.polyTare)} />}
                        </div>
                        <div className="mt-0.5 text-xs text-[#909090]">
                          {fmt(cb)} → {fmt(ca)}
                          {e.bagId && bagNoById.has(e.bagId) ? ` ／ 袋 ${bagNoById.get(e.bagId)}` : ""}
                          {" ／ 記録者 "}
                          {e.kirokusha}
                        </div>
                        {origin && <div className="mt-0.5 text-xs text-[#909090]">{origin}</div>}
                        {reason && (
                          <div className="mt-0.5 text-xs text-[#a15c00]">訂正: {reason}</div>
                        )}
                        {e.ijo && <div className="mt-0.5 text-xs text-[#dc000c]">異常: {e.ijo}</div>}
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <span className="text-lg font-bold tabular-nums">{fmt(w)}</span>
                        {fixButton(i)}
                      </div>
                    </div>
                    {fixIndex === i && fixPanel(e)}
                  </li>
                );
              })}
            </ul>

            {/* PC: 表 */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className={th}>時刻</th>
                    <th className={th}>袋</th>
                    <th className={th}>職場・プラ箱</th>
                    <th className={th}>種類</th>
                    <th className={`${th} text-right`}>投入前</th>
                    <th className={`${th} text-right`}>投入後</th>
                    <th className={`${th} text-right`}>スクラップ重量</th>
                    <th className={th}>読取</th>
                    <th className={th}>訂正理由</th>
                    <th className={th}>記録者</th>
                    <th className={th}>異常</th>
                    {!locked && <th className={th}></th>}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => {
                    const w = entryWeight(e);
                    const cb = toNumOrNull(e.cumBefore);
                    const ca = toNumOrNull(e.cumAfter);
                    const reason = entryReason(e);
                    // AI読取のIDが残っている＝機械が読んだ値が元になっている
                    const aiUsed = Boolean(e.cumBeforeReadId) || Boolean(e.cumAfterReadId);
                    return (
                      <Fragment key={i}>
                      <tr>
                        <td className={td}>{e.jikoku}</td>
                        <td className={td}>{(e.bagId && bagNoById.get(e.bagId)) || ""}</td>
                        <td className={td}>
                          {e.busho}
                          {e.shipmentId && <PolyTag sh={shipmentById.get(e.shipmentId)} weight={toNumOrNull(e.cumAfter) !== null && toNumOrNull(e.cumBefore) !== null ? toNum(e.cumAfter) - toNum(e.cumBefore) : null} polyTare={toNumOrNull(e.polyTare)} />}
                        </td>
                        <td className={td}>
                          <KindTag kind={e.kind} order={kindOrder.get(e.kind)} />
                          {/* Excelから取り込んだ行は発生元（機械・品種・工程）を添える */}
                          {entryOrigin(e) && (
                            <div className="mt-0.5 text-xs text-[#909090]">{entryOrigin(e)}</div>
                          )}
                        </td>
                        <td className={tdNum}>{fmt(cb)}</td>
                        <td className={tdNum}>{fmt(ca)}</td>
                        <td className={`${tdNum} font-semibold`}>{fmt(w)}</td>
                        <td className={td}>
                          {aiUsed ? (
                            <span className="inline-flex items-center gap-1 rounded-md bg-[#eef1f4] px-1.5 py-0.5 text-[11px] font-bold text-[#0b5ca8]">
                              <Sparkles className="h-3 w-3" />
                              AI
                            </span>
                          ) : (
                            <span className="text-xs text-[#909090]">手入力</span>
                          )}
                        </td>
                        <td className={`${td} ${reason ? "text-[#a15c00]" : ""}`}>{reason}</td>
                        <td className={td}>{e.kirokusha}</td>
                        <td className={td}>{e.ijo}</td>
                        {!locked && <td className={td}>{fixButton(i)}</td>}
                      </tr>
                      {fixIndex === i && (
                        <tr>
                          <td colSpan={12} className="border border-[#e5e5e5] px-2 pb-2">
                            {fixPanel(e)}
                          </td>
                        </tr>
                      )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* 袋の記録（紙の記入用紙・Excelの1枚に対応する単位）。袋運用の期間だけ出す */}
      {bagEra ? (
        <>
          {noBagCount > 0 && (
            <p className="rounded-2xl border border-[#dc000c] bg-[#fdecea] px-4 py-3 text-sm text-[#dc000c]">
              袋に紐づいていない投入が {noBagCount} 件あります。袋を開く前に記録した分です。
              重量は当日合計に入っていますが、袋の重量には入りません。
            </p>
          )}
          <ScrapBagList bags={dayBags} isAdmin={isAdmin} onMessage={setMessage} />
        </>
      ) : (
        <section className="rounded-2xl border border-[#e5e5e5] bg-[#f7f7f5] p-4 text-sm text-[#707070] sm:p-5">
          この日は袋単位の管理を始める前です（{bagStartOn} から袋単位）。
          従来どおり日単位の記録として扱います。
        </section>
      )}

      {/* 【3】終礼集計（承認者はここで当日を承認する） */}
      <Step n={3} title="終礼集計">
        <div className="space-y-3 text-sm">
          <div className="flex items-center justify-between rounded-xl bg-[#f7f7f5] px-4 py-3">
            <span className="text-[#707070]">当日合計</span>
            <span className="text-xl font-bold tabular-nums">{fmt(total)} kg</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-[#707070]">
              回収箱測定値(kg)
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                value={kaishu}
                onChange={(e) => {
                  setKaishu(e.target.value);
                  setFieldsDirty(true);
                }}
                className={numInput}
                disabled={locked}
              />
            </label>
            <div className="flex flex-col gap-1 text-xs text-[#707070]">
              差異率
              <span
                className={`flex h-11 items-center justify-end rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm font-bold tabular-nums sm:h-10 ${
                  sairitsu !== null && Math.abs(sairitsu) > 0.05 ? "text-[#dc000c]" : ""
                }`}
              >
                {fmtPct(sairitsu)}
              </span>
            </div>
          </div>
          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={tonyuKanryo}
              onChange={(e) => {
                setTonyuKanryo(e.target.checked);
                setFieldsDirty(true);
              }}
              className="h-5 w-5 accent-[#b4632c]"
              disabled={locked}
            />
            当日スクラップを全量、指定箱に投入した
          </label>
          <label className="flex flex-col gap-1 text-xs text-[#707070]">
            備考（異常事項・気付き等）
            <textarea
              rows={3}
              value={biko}
              onChange={(e) => {
                setBiko(e.target.value);
                setFieldsDirty(true);
              }}
              className="rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-base focus:border-[#b4632c] focus:outline-none disabled:bg-[#f0f0ee] sm:text-sm"
              disabled={locked}
            />
          </label>

          {/*
            承認は終礼時に1日1回。記録のたびに申請・承認を繰り返さない。
            承認者がここで当日合計と差異率を確認したうえで押す。
          */}
          <div className="rounded-xl border border-[#e5e5e5] bg-[#f7f7f5] p-3">
            {status === "approved" ? (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-sm font-bold text-[#2f6b2f]">
                  <Stamp className="h-5 w-5" />
                  終礼確認済み（承認: {initial?.approvedBy || "—"}）
                </span>
                {isAdmin && (
                  <button
                    onClick={reject}
                    disabled={pending}
                    className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-[#dc000c] px-4 text-sm font-semibold text-[#dc000c] hover:bg-[#fdecea] disabled:opacity-50"
                  >
                    <Undo2 className="h-4 w-4" />
                    承認を取り消す
                  </button>
                )}
              </div>
            ) : isAdmin ? (
              <>
                <p className="mb-2 text-xs text-[#707070]">
                  当日合計と差異率を確認して押してください。押した時点でこの日の記録が確定し、
                  記録者は編集できなくなります。
                </p>
                <button
                  onClick={approve}
                  disabled={pending || entries.length === 0}
                  className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#2f6b2f] text-base font-semibold text-white hover:bg-[#255525] disabled:opacity-50 sm:h-11 sm:w-auto sm:px-6 sm:text-sm"
                >
                  <Stamp className="h-5 w-5" />
                  終礼確認して承認する
                </button>
                {entries.length === 0 && (
                  <p className="mt-1.5 text-xs text-[#909090]">
                    投入の記録が1件もありません。記録されてから承認してください。
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-[#707070]">
                終礼時に承認者が確認して承認します。投入は記録した時点で保存されています。
              </p>
            )}
          </div>
        </div>
      </Step>

      {/* 操作バー（モバイルは画面下に固定。ガイドのシートを開いているときはその上に持ち上げる） */}
      {!locked && (
        <div className="guide-avoid-bottom fixed inset-x-0 bottom-0 z-30 border-t border-[#e5e5e5] bg-white/95 p-3 backdrop-blur sm:static sm:z-auto sm:rounded-2xl sm:border sm:p-4">
          <div className="flex items-center gap-2">
            {/*
              記録すると自動で保存されるので、ふだんこのボタンは押さなくてよい。
              未保存が残っているとき（保存に失敗した・終礼の欄を直した）だけ目立たせる。
              いつもオレンジの塗りだと、記録ボタンと見分けがつかず押し間違いの元になる。
            */}
            <button
              onClick={save}
              disabled={pending}
              className={`inline-flex h-11 flex-1 items-center justify-center gap-1.5 rounded-lg px-4 text-sm font-semibold disabled:opacity-50 sm:flex-none ${
                unsaved
                  ? "bg-[#b4632c] text-white hover:bg-[#96521f]"
                  : "border border-[#cfcac3] bg-white text-[#555555] hover:bg-[#f7f7f5]"
              }`}
            >
              {unsaved ? <Save className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              {unsaved
                ? `保存${unsavedCount > 0 ? `（未保存 ${unsavedCount}件）` : ""}`
                : "保存済み"}
            </button>
            <span className="text-xs text-[#909090]">
              {unsaved
                ? "未保存の入力があります。押して保存してください。"
                : "記録すると自動で保存されます。"}
            </span>
          </div>
        </div>
      )}

      {/* カメラ読み取りモーダル */}
    </div>
  );
}

/** 突き合わせの文言（例「本社工場で 15.3 kg（プラ箱込み）→ ここで 13.6 ＋ プラ箱 1.6 ＝ 15.2 kg（差 -0.1 kg）」） */
function polyGapText(sh: Shipment): string {
  const p = shipmentPair(sh);
  const gap = shipmentGap(sh);
  if (!p || gap === null || !sh.received) return "";
  const sign = gap > 0 ? "+" : "";
  return p.withBox
    ? `${sh.fromFactory}で ${fmt(p.sent)} kg（プラ箱込み）→ ここで ${fmt(sh.received.weight)} ＋ プラ箱 ${fmt(sh.received.polyTare)} ＝ ${fmt(p.received)} kg（差 ${sign}${fmt(gap)} kg）`
    : `${sh.fromFactory}で ${fmt(p.sent)} kg → ここで ${fmt(p.received)} kg（差 ${sign}${fmt(gap)} kg）`;
}

/** 他工場から届いたプラ箱を投入した行の目印。送った工場で量った重量との差も出す。 */
function PolyTag({
  sh,
  weight,
  polyTare,
}: {
  sh: Shipment | undefined;
  weight: number | null;
  polyTare: number | null;
}) {
  if (!sh) {
    return (
      <span className="rounded-md bg-[#e8f0f8] px-1.5 py-0.5 text-[11px] font-bold text-[#0b5ca8]">プラ箱</span>
    );
  }
  const trial =
    weight !== null
      ? { ...sh, received: { date: "", weight, polyTare, scaleName: "", kirokusha: "" } }
      : null;
  const gap = trial ? shipmentGap(trial) : null;
  const large = trial ? shipmentGapLarge(trial) : false;
  const p = trial ? shipmentPair(trial) : null;
  return (
    <span
      className={`inline-block rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
        large ? "bg-[#fdecea] text-[#dc000c]" : "bg-[#e8f0f8] text-[#0b5ca8]"
      }`}
      title={trial ? polyGapText(trial) : `出荷 ${sh.shipDate}`}
    >
      プラ箱 {sh.boxNo}
      {p && gap !== null &&
        (p.withBox
          ? `（箱 ${fmt(polyTare)}・計 ${fmt(p.received)}／出荷 ${fmt(p.sent)}・差 ${gap > 0 ? "+" : ""}${fmt(gap)}）`
          : `（出荷時 ${fmt(p.sent)}・差 ${gap > 0 ? "+" : ""}${fmt(gap)}）`)}
    </span>
  );
}
