"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CheckCircle2,
  PackagePlus,
  Plus,
  QrCode,
  Save,
  Sparkles,
  Stamp,
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
} from "@/lib/scrapTypes";
import { fmt, fmtPct, toNum, toNumOrNull } from "@/lib/format";
import DateNav from "@/components/DateNav";
import ScaleCamera from "@/components/ScaleCamera";
import ScrapBagPanel, { ScrapBagList } from "@/components/ScrapBagPanel";

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
    }))
  );
  const [kaishu, setKaishu] = useState(
    initial?.kaishuSokuteichi !== null && initial?.kaishuSokuteichi !== undefined
      ? String(initial.kaishuSokuteichi)
      : ""
  );
  const [tonyuKanryo, setTonyuKanryo] = useState(initial?.tonyuKanryo ?? false);
  const [biko, setBiko] = useState(initial?.biko ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // どこまで保存したか。行の削除は無いので「先頭から savedCount 件までが保存済み」。
  // 締めの合計は保存済みの明細から出すため、未保存があるうちは袋を締めさせない。
  const [savedCount, setSavedCount] = useState(initial?.entries.length ?? 0);
  // 読み取り・記録の結果は2でも3でも出るので、同じ見た目を両方に置く
  const messageBanner = message ? (
    <p className={`mt-2 text-sm ${message.ok ? "text-[#2f6b2f]" : "text-[#dc000c]"}`}>
      {message.text}
    </p>
  ) : null;

  // ===== 箱（重量計）選択 =====
  const [selectedScale, setSelectedScale] = useState<Scale | null>(null);
  const [qrInput, setQrInput] = useState("");

  // ===== 計量入力（AI読取） =====
  const [ijo, setIjo] = useState("");
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
      openBags.find((b) => b.scaleId === scaleId && b.openedOn <= date) ?? null,
    [openBags, date]
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
        setMessage({
          ok: false,
          text:
            (r.note ? `表示値を読み取れませんでした（${r.note}）。` : "表示値を読み取れませんでした。") +
            "もう一度撮るか、手入力してください。",
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
        text:
          `${scale ? `「${scale.name}」の` : ""}${where}の表示値 ${fmt(r.value)} kg を読み取りました。` +
          (r.confidence === "medium" ? "（読み取りに少し自信がありません。値を確認してください）" : ""),
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
    if (!currentBag) {
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
    setEntries((prev) => [
      ...prev,
      {
        jikoku: nowTime(), // 時刻は記録した時間が自動で入る
        scaleId: selectedScale.id,
        scaleName: selectedScale.name,
        bagId: currentBag.id,
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
      },
    ]);
    // 次の投入に備えてクリア。投入前は今回の投入後が autoCumBefore として引き継がれる
    resetReading();
    setIjo("");
    setMessage({
      ok: true,
      text: `${fmt(scrapWeight)} kg を記録しました。忘れずに保存してください。`,
    });
  }

  function buildPayload() {
    return {
      recordDate: date,
      factory,
      sekininsha,
      kaishuSokuteichi: kaishu,
      tonyuKanryo,
      biko,
      entries: entries.map((e) => ({
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
      })),
    };
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      const saving = entries.length;
      const res = await saveDailyRecordAction(buildPayload());
      setMessage({ ok: res.ok, text: res.message ?? "" });
      if (res.ok) {
        setSavedCount(saving);
        router.refresh();
      }
    });
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

  const btnPrimary =
    "inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-[#b4632c] px-4 text-sm font-semibold text-white hover:bg-[#96521f] disabled:opacity-50";
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
              onChange={(e) => setSekininsha(e.target.value)}
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
          {selectedScale && (
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

          {/* 異常メモ */}
          <label className="mt-4 flex flex-col gap-1 text-xs text-[#707070]">
            <span className="flex items-center gap-1.5">
              <FieldNo n="③" />
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

          <button
            onClick={addEntry}
            disabled={pending || !currentBag}
            className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#b4632c] text-base font-semibold text-white hover:bg-[#96521f] disabled:opacity-50 sm:h-11 sm:w-auto sm:px-6 sm:text-sm"
          >
            <Plus className="h-5 w-5" />
            投入完了として記録する
          </button>
          {selectedScale && !currentBag && (
            <p className="mt-1.5 text-xs text-[#a15c00]">
              「{selectedScale.name}」の袋が開いていません。1の「袋を開始する」から始めてください。
            </p>
          )}
          {messageBanner}
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
                return (
                  <li key={i} className="rounded-xl border border-[#e5e5e5] p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold tabular-nums">{e.jikoku}</span>
                          <KindTag kind={e.kind} order={kindOrder.get(e.kind)} />
                        </div>
                        <div className="mt-0.5 text-xs text-[#909090]">
                          {fmt(cb)} → {fmt(ca)}
                          {e.bagId && bagNoById.has(e.bagId) ? ` ／ 袋 ${bagNoById.get(e.bagId)}` : ""}
                          {" ／ 記録者 "}
                          {e.kirokusha}
                        </div>
                        {reason && (
                          <div className="mt-0.5 text-xs text-[#a15c00]">訂正: {reason}</div>
                        )}
                        {e.ijo && <div className="mt-0.5 text-xs text-[#dc000c]">異常: {e.ijo}</div>}
                      </div>
                      <span className="shrink-0 text-lg font-bold tabular-nums">{fmt(w)}</span>
                    </div>
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
                    <th className={th}>種類</th>
                    <th className={`${th} text-right`}>投入前</th>
                    <th className={`${th} text-right`}>投入後</th>
                    <th className={`${th} text-right`}>スクラップ重量</th>
                    <th className={th}>読取</th>
                    <th className={th}>訂正理由</th>
                    <th className={th}>記録者</th>
                    <th className={th}>異常</th>
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
                      <tr key={i}>
                        <td className={td}>{e.jikoku}</td>
                        <td className={td}>{(e.bagId && bagNoById.get(e.bagId)) || ""}</td>
                        <td className={td}>
                          <KindTag kind={e.kind} order={kindOrder.get(e.kind)} />
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
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* 袋の記録（紙の記入用紙・Excelの1枚に対応する単位） */}
      <ScrapBagList bags={dayBags} isAdmin={isAdmin} onMessage={setMessage} />

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
                onChange={(e) => setKaishu(e.target.value)}
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
              onChange={(e) => setTonyuKanryo(e.target.checked)}
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
              onChange={(e) => setBiko(e.target.value)}
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
                終礼時に承認者が確認して承認します。記録が済んだら「保存」してください。
              </p>
            )}
          </div>
        </div>
      </Step>

      {/* 操作バー（モバイルは画面下に固定） */}
      {!locked && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#e5e5e5] bg-white/95 p-3 backdrop-blur sm:static sm:z-auto sm:rounded-2xl sm:border sm:p-4">
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={pending} className={`${btnPrimary} flex-1 sm:flex-none`}>
              <Save className="h-4 w-4" />
              保存
            </button>
            <span className="hidden text-xs text-[#909090] sm:inline">
              投入を記録したら「保存」してください。終礼時に承認者が確認して当日を承認します。
            </span>
          </div>
        </div>
      )}

      {/* カメラ読み取りモーダル */}
    </div>
  );
}
