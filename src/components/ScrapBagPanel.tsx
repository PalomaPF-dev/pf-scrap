"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, PackageCheck, PackagePlus, Pencil, Sparkles, Stamp, Undo2 } from "lucide-react";
import {
  approveBagAction,
  closeBagAction,
  correctBagCloseAction,
  openBagAction,
  reopenBagAction,
} from "@/lib/actions";
import {
  BAG_STATUS_LABEL,
  BAG_TARGET_KG,
  bagGap,
  bagWeight,
  type Scale,
  type ScrapBag,
} from "@/lib/scrapTypes";
import { fmt, toNumOrNull } from "@/lib/format";
import ScaleCamera from "@/components/ScaleCamera";

const input =
  "h-11 rounded-lg border border-[#e5e5e5] bg-white px-3 text-base focus:border-[#b4632c] focus:outline-none disabled:bg-[#f0f0ee] disabled:text-[#909090] sm:h-10 sm:text-sm";
const numInput = `${input} text-right tabular-nums`;
const td = "border border-[#e5e5e5] px-2 py-1.5 whitespace-nowrap";
const tdNum = `${td} text-right tabular-nums`;
const th = "border border-[#e5e5e5] bg-[#f0f0ee] px-2 py-1.5 text-left font-semibold whitespace-nowrap";

/**
 * 操作の結果。title は大きく太く、text はその下に添える。
 * 現場から「赤の注意書きを見落としそうになる」と報告があったので、
 * 結果は小さな文字ではなく、見出しのある枠で出す。
 */
export type PanelMessage = { ok: boolean; title?: string; text: string };

/** 操作の結果を出す枠。成功は緑、失敗・注意は赤。読み飛ばせない大きさにする。 */
export function ResultBanner({ msg, className = "" }: { msg: PanelMessage; className?: string }) {
  const title = msg.title ?? msg.text;
  const detail = msg.title ? msg.text : "";
  return (
    <div
      role="status"
      aria-live="polite"
      className={`rounded-xl border-2 px-4 py-3 ${
        msg.ok ? "border-[#2f6b2f] bg-[#eef4ee]" : "border-[#dc000c] bg-[#fdecea]"
      } ${className}`}
    >
      <p
        className={`flex items-start gap-2 text-lg font-bold leading-snug sm:text-base ${
          msg.ok ? "text-[#2f6b2f]" : "text-[#dc000c]"
        }`}
      >
        {msg.ok ? (
          <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0" />
        ) : (
          <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0" />
        )}
        <span>{title}</span>
      </p>
      {detail && (
        <p
          className={`mt-1.5 pl-8 text-base font-medium leading-snug sm:text-sm ${
            msg.ok ? "text-[#2f6b2f]" : "text-[#b00010]"
          }`}
        >
          {detail}
        </p>
      )}
    </div>
  );
}

/** 袋の状態バッジ。記録中＝進行中の色、締め済み＝承認待ち、承認済み＝確定。 */
export function BagBadge({ bag }: { bag: ScrapBag }) {
  const style =
    bag.status === "approved"
      ? "bg-[#eef4ee] text-[#2f6b2f]"
      : bag.status === "closed"
        ? "bg-[#fff3e0] text-[#a15c00]"
        : "bg-[#faf6ef] text-[#b4632c]";
  return (
    <span className={`rounded-md px-2 py-0.5 text-xs font-bold ${style}`}>
      {BAG_STATUS_LABEL[bag.status]}
    </span>
  );
}

/** この重量計の交換の目安 kg（重量計ごとの設定 → 既定値）。 */
function targetOf(scale: Scale): number {
  return scale.bagTargetKg && scale.bagTargetKg > 0 ? scale.bagTargetKg : BAG_TARGET_KG;
}

/**
 * いま載っている袋のカード。袋は「開いてから交換するまで」が1区切りで、
 * 1日に何度も変わり、夜勤帯の投入で翌日まで続くこともある。
 *
 * - 袋が無ければ「袋を開始する」（新しいカゴを載せて風袋引きしたところ）
 * - 袋があれば、これまでの累計と目安までの残りを出し、「袋を交換する」で締める
 *
 * 締めると「この袋は◯◯kgでした」が記録として残り、管理者の承認対象になる。
 */
export default function ScrapBagPanel({
  date,
  factory,
  scale,
  bag,
  unsavedCount,
  unsavedWeight,
  onMessage,
}: {
  date: string;
  factory: string;
  scale: Scale;
  bag: ScrapBag | null;
  /** 未保存の投入件数。締める前に保存してもらう（締めの合計に入らないため） */
  unsavedCount: number;
  unsavedWeight: number;
  onMessage: (m: PanelMessage) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  // 袋を開く
  const [openForm, setOpenForm] = useState(false);
  const [startCum, setStartCum] = useState("0");
  const [taraOk, setTaraOk] = useState(false);

  // 袋を締める（交換）
  const [closeForm, setCloseForm] = useState(false);
  const [closeRead, setCloseRead] = useState<{ readId: string; value: number } | null>(null);
  const [closeFix, setCloseFix] = useState(false);
  const [closeManual, setCloseManual] = useState("");
  const [closeReason, setCloseReason] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [openNext, setOpenNext] = useState(true);
  const [nextTaraOk, setNextTaraOk] = useState(false);

  const target = targetOf(scale);
  // 締めるまでの累計は「保存済みの合計 + まだ保存していない投入」
  const running = (bag?.runningTotal ?? 0) + unsavedWeight;
  const remain = Math.round((target - running) * 10) / 10;
  const over = running > target;

  const machineClose = closeRead ? String(closeRead.value) : "";
  const closeLinked = machineClose !== "";
  const closeEditable = !closeLinked || closeFix;
  const closeCum = closeEditable ? closeManual : machineClose;
  const closeCorrected =
    closeLinked &&
    closeFix &&
    closeManual.trim() !== "" &&
    toNumOrNull(closeManual) !== toNumOrNull(machineClose);

  // 締めの表示値は、この袋の最後の投入後と一致するはず（誰も触っていなければ）
  const expectedClose = bag ? (bag.lastCum ?? (bag.startCum > 0 ? bag.startCum : null)) : null;
  const closeWeight = bag !== null && toNumOrNull(closeCum) !== null
    ? Math.round((toNumOrNull(closeCum)! - bag.startCum) * 1000) / 1000
    : null;
  const closeGap = closeWeight !== null ? Math.round((closeWeight - running) * 1000) / 1000 : null;

  function resetClose() {
    setCloseForm(false);
    setCloseRead(null);
    setCloseFix(false);
    setCloseManual("");
    setCloseReason("");
    setCloseNote("");
    setOpenNext(true);
    setNextTaraOk(false);
  }

  function doOpen() {
    startTransition(async () => {
      const res = await openBagAction({
        factory,
        scaleId: scale.id,
        date,
        startCum,
        taraOk,
        note: "",
      });
      onMessage({ ok: res.ok, text: res.message ?? "" });
      if (res.ok) {
        setOpenForm(false);
        setStartCum("0");
        setTaraOk(false);
        router.refresh();
      }
    });
  }

  function doClose() {
    if (!bag) return;
    if (toNumOrNull(closeCum) === null) {
      onMessage({
        ok: false,
        text: "交換直前の表示値がありません。カゴを降ろす前に読み取るか、手入力してください。",
      });
      return;
    }
    if (closeCorrected && !closeReason.trim()) {
      onMessage({
        ok: false,
        text: `交換直前の表示値を ${machineClose} kg から変更しています。訂正理由を入力してください。`,
      });
      return;
    }
    startTransition(async () => {
      const res = await closeBagAction({
        bagId: bag.id,
        date,
        closeCum,
        closeCumReadId: closeRead?.readId ?? null,
        closeCumReason: closeCorrected ? closeReason.trim() : "",
        note: closeNote,
        openNext,
        taraOk: nextTaraOk,
      });
      onMessage({ ok: res.ok, text: res.message ?? "" });
      if (res.ok) {
        resetClose();
        router.refresh();
      }
    });
  }

  // ===== 袋がまだ無い =====
  if (!bag) {
    return (
      <div className="mb-3 rounded-xl border-2 border-[#a15c00] bg-[#fff8ec] p-3.5">
        <p className="flex items-center gap-2 text-sm font-bold text-[#a15c00]">
          <PackagePlus className="h-5 w-5 shrink-0" />
          「{scale.name}」の袋が開いていません
        </p>
        <p className="mt-1 text-xs text-[#96521f]">
          新しいカゴと袋をセットしたら、袋を開始してください。開始しないと投入を記録できません。
        </p>
        {!openForm ? (
          <button
            type="button"
            onClick={() => setOpenForm(true)}
            className="mt-3 inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-[#b4632c] px-4 text-sm font-semibold text-white hover:bg-[#96521f]"
          >
            <PackagePlus className="h-4 w-4" />
            袋を開始する
          </button>
        ) : (
          <div className="mt-3 space-y-3 rounded-lg border border-[#e5e5e5] bg-white p-3">
            <label className="flex flex-col gap-1 text-xs text-[#707070]">
              開始の表示値 kg
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                value={startCum}
                onChange={(e) => setStartCum(e.target.value)}
                className={`${numInput} w-full sm:w-48`}
              />
              <span className="text-xs text-[#909090]">
                風袋引きして 0kg を確認していれば 0 のまま。使いかけの袋から記録を始めるときだけ、
                いまの表示値を入れてください。
              </span>
            </label>
            {toNumOrNull(startCum) === 0 && (
              <label className="flex items-start gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={taraOk}
                  onChange={(e) => setTaraOk(e.target.checked)}
                  className="mt-0.5 h-5 w-5 accent-[#b4632c]"
                />
                新しいカゴを載せ、風袋引きして 0kg の表示を確認した
              </label>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={doOpen}
                disabled={pending}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-[#b4632c] px-4 text-sm font-semibold text-white hover:bg-[#96521f] disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" />
                この内容で開始する
              </button>
              <button
                type="button"
                onClick={() => setOpenForm(false)}
                className="inline-flex h-11 items-center justify-center rounded-lg border border-[#e5e5e5] px-4 text-sm font-medium text-[#555555]"
              >
                やめる
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ===== 記録中の袋がある =====
  const pct = Math.max(0, Math.min(100, (running / target) * 100));
  return (
    <div className="mb-3 rounded-xl border border-[#b4632c] bg-[#faf6ef] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-2 text-sm font-bold text-[#b4632c]">
          <PackageCheck className="h-5 w-5 shrink-0" />
          袋 {bag.bagNo}
          <BagBadge bag={bag} />
        </span>
        <span className="text-xs text-[#96521f]">
          {bag.openedOn} 開始
          {bag.openedOn !== date && "（前の日から続いています）"}
        </span>
      </div>

      <div className="mt-2 flex items-end justify-between gap-3">
        <span className="text-xs text-[#96521f]">この袋の累計</span>
        <span className="text-2xl font-bold tabular-nums text-[#333333]">{fmt(running)} kg</span>
      </div>
      <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-[#e9ddcb]">
        <div
          className={`h-full rounded-full ${over ? "bg-[#dc000c]" : "bg-[#b4632c]"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className={`mt-1 text-xs ${over ? "font-bold text-[#dc000c]" : "text-[#96521f]"}`}>
        {over
          ? `目安の ${fmt(target, 0)} kg を ${fmt(running - target)} kg 超えています。破損防止のため交換してください。`
          : `交換の目安 ${fmt(target, 0)} kg まで あと ${fmt(remain)} kg`}
      </p>
      {unsavedCount > 0 && (
        <p className="mt-1 text-xs text-[#a15c00]">
          未保存の投入が {unsavedCount} 件あります（{fmt(unsavedWeight)} kg）。締める前に保存してください。
        </p>
      )}

      {!closeForm ? (
        <button
          type="button"
          onClick={() => setCloseForm(true)}
          className="mt-3 inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-lg border border-[#b4632c] bg-white px-4 text-sm font-semibold text-[#b4632c] hover:bg-[#f7efe4] sm:w-auto"
        >
          <PackageCheck className="h-4 w-4" />
          袋を交換する（この袋を締める）
        </button>
      ) : (
        <div className="mt-3 space-y-3 rounded-lg border border-[#e5e5e5] bg-white p-3">
          <p className="text-xs text-[#707070]">
            カゴを降ろす<strong>前</strong>に、表示値を読み取ってください。この値が
            「この袋は◯◯kgでした」として残ります。
          </p>

          {unsavedCount > 0 && (
            <p className="rounded-lg bg-[#fdecea] px-3 py-2 text-sm text-[#dc000c]">
              未保存の投入があります。先に画面下の「保存」を押してから締めてください。
            </p>
          )}

          <ScaleCamera
            phase="after"
            recordDate={date}
            factory={factory}
            scaleId={scale.id}
            expectedFor={() => expectedClose}
            needQr={false}
            label="交換直前の表示値を撮って読み取る"
            onResult={(r) => {
              if (r.value === null) {
                setCloseFix(true);
                onMessage({
                  ok: false,
                  text:
                    (r.note ? `表示値を読み取れませんでした（${r.note}）。` : "表示値を読み取れませんでした。") +
                    "もう一度撮るか、手入力してください。",
                });
                return;
              }
              setCloseRead({ readId: r.readId, value: r.value });
              setCloseFix(false);
              setCloseManual("");
              setCloseReason("");
              onMessage({ ok: true, text: `交換直前の表示値 ${fmt(r.value)} kg を読み取りました。` });
            }}
            onError={(text) => onMessage({ ok: false, text })}
          />

          <div className="flex flex-col gap-1 text-xs text-[#707070]">
            <span className="flex items-center justify-between gap-1">
              <span className="flex items-center gap-1.5">
                交換直前の表示値 kg
                {closeRead && !closeFix && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-[#eef1f4] px-1.5 py-0.5 text-[11px] font-bold text-[#0b5ca8]">
                    <Sparkles className="h-3 w-3" />
                    AI読取
                  </span>
                )}
              </span>
              {closeLinked && !closeFix && (
                <button
                  type="button"
                  onClick={() => {
                    setCloseFix(true);
                    setCloseManual(machineClose);
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
              value={closeCum}
              onChange={(e) => setCloseManual(e.target.value)}
              readOnly={!closeEditable}
              aria-label="交換直前の表示値 kg"
              className={`${numInput} w-full sm:w-56 ${!closeEditable ? "bg-[#f0f0ee] text-[#555555]" : ""}`}
            />
          </div>

          {closeFix && closeLinked && (
            <input
              type="text"
              value={closeReason}
              onChange={(e) => setCloseReason(e.target.value)}
              placeholder="訂正理由（例: 表示が反射して読めない）"
              aria-label="締めの訂正理由"
              className={`${input} w-full`}
            />
          )}

          {closeWeight !== null && (
            <div className="rounded-lg bg-[#f7f7f5] px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-sm text-[#707070]">この袋の重量</span>
                <span className="text-xl font-bold tabular-nums">{fmt(closeWeight)} kg</span>
              </div>
              <div className="mt-1 flex items-center justify-between text-xs text-[#707070]">
                <span>記録した投入の合計</span>
                <span className="tabular-nums">{fmt(running)} kg</span>
              </div>
              {closeGap !== null && Math.abs(closeGap) > 0.05 && (
                <p className="mt-1 text-xs text-[#dc000c]">
                  記録との差が {fmt(closeGap)} kg あります。記録していない投入、読み取りの誤り、
                  他部署の投入などが考えられます。備考に理由を残してください。
                </p>
              )}
            </div>
          )}

          <label className="flex flex-col gap-1 text-xs text-[#707070]">
            備考（差が出た理由・引き取りへの申し送りなど）
            <input
              type="text"
              value={closeNote}
              onChange={(e) => setCloseNote(e.target.value)}
              className={`${input} w-full`}
            />
          </label>

          <label className="flex items-start gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={openNext}
              onChange={(e) => setOpenNext(e.target.checked)}
              className="mt-0.5 h-5 w-5 accent-[#b4632c]"
            />
            続けて次の袋を開始する
          </label>
          {openNext && (
            <label className="flex items-start gap-2.5 pl-7 text-sm">
              <input
                type="checkbox"
                checked={nextTaraOk}
                onChange={(e) => setNextTaraOk(e.target.checked)}
                className="mt-0.5 h-5 w-5 accent-[#b4632c]"
              />
              新しいカゴを載せ、風袋引きして 0kg の表示を確認した
            </label>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={doClose}
              disabled={pending || unsavedCount > 0}
              className="inline-flex h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#b4632c] text-base font-semibold text-white hover:bg-[#96521f] disabled:opacity-50 sm:h-11 sm:flex-none sm:px-6 sm:text-sm"
            >
              <PackageCheck className="h-5 w-5" />
              この袋を締める
            </button>
            <button
              type="button"
              onClick={resetClose}
              className="inline-flex h-12 items-center justify-center rounded-xl border border-[#e5e5e5] px-4 text-sm font-medium text-[#555555] sm:h-11"
            >
              やめる
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * その日に関わった袋の一覧（記録中・締め済み・承認済み）。
 * 紙の記入用紙・Excelの1枚に対応する単位で、締めの数字と記録の差が並ぶ。
 * 承認は日ごとの終礼とは別に、袋ごとに管理者が行う。
 */
export function ScrapBagList({
  bags,
  isAdmin,
  onMessage,
}: {
  bags: ScrapBag[];
  isAdmin: boolean;
  onMessage: (m: PanelMessage) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  // 操作の結果はボタンのすぐそばにも出す。画面上部だけだと、一覧から押したときに
  // 何が起きたのか（なぜ戻せないのか）が見えない。
  const [msg, setMsg] = useState<PanelMessage | null>(null);
  // 締め値の訂正フォーム（袋ごとに開く）
  const [correct, setCorrect] = useState<{ bagId: string; value: string; reason: string } | null>(
    null
  );

  function report(m: PanelMessage) {
    setMsg(m);
    onMessage(m);
  }

  function run(fn: () => Promise<{ ok: boolean; message?: string }>, after?: () => void) {
    startTransition(async () => {
      const res = await fn();
      report({ ok: res.ok, text: res.message ?? "" });
      if (res.ok) {
        after?.();
        router.refresh();
      }
    });
  }

  const approve = (bag: ScrapBag) => run(() => approveBagAction(bag.id));
  const reopen = (bag: ScrapBag) => run(() => reopenBagAction(bag.id));
  const startCorrect = (bag: ScrapBag) => {
    setMsg(null);
    setCorrect({
      bagId: bag.id,
      value: bag.closeCum !== null ? String(bag.closeCum) : "",
      reason: "",
    });
  };
  const saveCorrect = () => {
    if (!correct) return;
    run(
      () =>
        correctBagCloseAction({
          bagId: correct.bagId,
          closeCum: correct.value,
          reason: correct.reason,
        }),
      () => setCorrect(null)
    );
  };

  /** 管理者用の操作ボタン（締め済み・承認済みの袋に出る）。 */
  function AdminActions({ bag, compact }: { bag: ScrapBag; compact?: boolean }) {
    if (!isAdmin || bag.status === "open") return null;
    // モバイルは2列のグリッドに並べる。3つを横一列にすると文字が折り返して読めない。
    const base = compact
      ? "inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-[13px] font-semibold disabled:opacity-50"
      : "rounded-md px-2 py-1 text-xs font-semibold disabled:opacity-50";
    return (
      <>
        {bag.status === "closed" && (
          <button
            onClick={() => approve(bag)}
            disabled={pending}
            className={`${base} ${compact ? "col-span-2 bg-[#2f6b2f] text-white" : "mr-1 bg-[#2f6b2f] text-white"}`}
          >
            {compact && <Stamp className="h-4 w-4" />}
            承認
          </button>
        )}
        <button
          onClick={() => startCorrect(bag)}
          disabled={pending}
          className={`${base} ${compact ? "border border-[#b4632c] text-[#b4632c]" : "mr-1 border border-[#b4632c] text-[#b4632c]"}`}
        >
          {compact && <Pencil className="h-4 w-4" />}
          締め値を直す
        </button>
        <button
          onClick={() => reopen(bag)}
          disabled={pending}
          className={`${base} ${compact ? "border border-[#dc000c] text-[#dc000c]" : "border border-[#dc000c] text-[#dc000c]"}`}
        >
          {compact && <Undo2 className="h-4 w-4" />}
          記録中に戻す
        </button>
      </>
    );
  }

  const target = correct ? bags.find((b) => b.id === correct.bagId) : null;

  return (
    <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
      <div className="mb-3">
        <h2 className="text-base font-bold text-[#333333] sm:text-sm">袋の記録（{bags.length}件）</h2>
        <p className="mt-0.5 text-xs text-[#909090]">
          袋の重量 = 交換直前の表示値 − 開始の表示値。締めた袋は管理者が承認します。
        </p>
      </div>

      {msg && <ResultBanner msg={msg} className="mb-3" />}

      {/* 締め値の訂正。読み違い・撮り直しはここで直す（記録中に戻す必要はない） */}
      {correct && target && (
        <div className="mb-3 space-y-3 rounded-xl border border-[#b4632c] bg-[#faf6ef] p-3.5">
          <p className="text-sm font-bold text-[#b4632c]">袋 {target.bagNo} の締め値を直す</p>
          <p className="text-xs text-[#96521f]">
            いまの締め値 {fmt(target.closeCum)} kg（この袋は {fmt(bagWeight(target))} kg）。
            承認済みの袋は、直すと承認待ちに戻ります。
          </p>
          <label className="flex flex-col gap-1 text-xs text-[#707070]">
            直したあとの表示値 kg
            <input
              type="number"
              inputMode="decimal"
              step="0.1"
              min="0"
              value={correct.value}
              onChange={(e) => setCorrect({ ...correct, value: e.target.value })}
              className={`${numInput} w-full sm:w-56`}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[#707070]">
            訂正理由（記録として残ります）
            <input
              type="text"
              value={correct.reason}
              onChange={(e) => setCorrect({ ...correct, reason: e.target.value })}
              placeholder="例: 撮り直したら 320kg だった"
              className={`${input} w-full`}
            />
          </label>
          <div className="flex gap-2">
            <button
              onClick={saveCorrect}
              disabled={pending}
              className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-[#b4632c] px-4 text-sm font-semibold text-white hover:bg-[#96521f] disabled:opacity-50"
            >
              <CheckCircle2 className="h-4 w-4" />
              この内容で直す
            </button>
            <button
              onClick={() => setCorrect(null)}
              className="inline-flex h-11 items-center justify-center rounded-lg border border-[#e5e5e5] px-4 text-sm font-medium text-[#555555]"
            >
              やめる
            </button>
          </div>
        </div>
      )}

      {bags.length === 0 ? (
        <p className="rounded-lg bg-[#f7f7f5] px-3 py-3 text-sm text-[#707070]">
          この日に関わった袋がありません。重量計を選ぶと袋を開始できます。
        </p>
      ) : (
        <>
          {/* モバイル: カード */}
          <ul className="space-y-2 sm:hidden">
            {bags.map((b) => {
              const w = bagWeight(b);
              const gap = bagGap(b);
              return (
                <li key={b.id} className="rounded-xl border border-[#e5e5e5] p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-bold">{b.bagNo}</span>
                        <BagBadge bag={b} />
                      </div>
                      <div className="mt-0.5 text-xs text-[#909090]">
                        {b.scaleName} ／ {b.openedOn}
                        {b.closedOn && b.closedOn !== b.openedOn ? ` → ${b.closedOn}` : ""}
                      </div>
                      <div className="mt-0.5 text-xs text-[#707070]">
                        記録 {fmt(b.totalWeight ?? b.runningTotal)} kg（{b.entryCount}件）
                        {gap !== null && Math.abs(gap) > 0.05 && (
                          <span className="text-[#dc000c]"> ／ 差 {fmt(gap)} kg</span>
                        )}
                      </div>
                      {b.closeCumReason && (
                        <div className="mt-0.5 text-xs text-[#a15c00]">訂正: {b.closeCumReason}</div>
                      )}
                      {b.note && <div className="mt-0.5 text-xs text-[#a15c00]">{b.note}</div>}
                    </div>
                    <span className="shrink-0 text-lg font-bold tabular-nums">
                      {w !== null ? `${fmt(w)}` : "—"}
                    </span>
                  </div>
                  {isAdmin && b.status !== "open" && (
                    <div className="mt-2 grid grid-cols-2 gap-2">
                      <AdminActions bag={b} compact />
                    </div>
                  )}
                </li>
              );
            })}
          </ul>

          {/* PC: 表 */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={th}>袋No</th>
                  <th className={th}>重量計</th>
                  <th className={th}>期間</th>
                  <th className={`${th} text-right`}>開始</th>
                  <th className={`${th} text-right`}>締め</th>
                  <th className={`${th} text-right`}>袋の重量</th>
                  <th className={`${th} text-right`}>記録合計</th>
                  <th className={`${th} text-right`}>差</th>
                  <th className={th}>状態</th>
                  <th className={th}>備考</th>
                  {isAdmin && <th className={th}>操作</th>}
                </tr>
              </thead>
              <tbody>
                {bags.map((b) => {
                  const w = bagWeight(b);
                  const gap = bagGap(b);
                  return (
                    <tr key={b.id}>
                      <td className={`${td} font-semibold`}>{b.bagNo}</td>
                      <td className={td}>{b.scaleName}</td>
                      <td className={td}>
                        {b.openedOn}
                        {b.closedOn && b.closedOn !== b.openedOn ? ` → ${b.closedOn}` : ""}
                      </td>
                      <td className={tdNum}>{fmt(b.startCum)}</td>
                      <td className={tdNum}>{fmt(b.closeCum)}</td>
                      <td className={`${tdNum} font-bold`}>{fmt(w)}</td>
                      <td className={tdNum}>{fmt(b.totalWeight ?? b.runningTotal)}</td>
                      <td className={`${tdNum} ${gap !== null && Math.abs(gap) > 0.05 ? "text-[#dc000c]" : ""}`}>
                        {fmt(gap)}
                      </td>
                      <td className={td}>
                        <BagBadge bag={b} />
                        {b.status === "approved" && b.approvedBy && (
                          <span className="ml-1 text-xs text-[#707070]">{b.approvedBy}</span>
                        )}
                      </td>
                      <td className={td}>
                        {b.closeCumReason && (
                          <span className="text-[#a15c00]">訂正: {b.closeCumReason} </span>
                        )}
                        {b.note}
                      </td>
                      {isAdmin && (
                        <td className={td}>
                          <AdminActions bag={b} />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
