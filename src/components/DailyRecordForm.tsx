"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Camera,
  CheckCircle2,
  Plus,
  QrCode,
  Save,
  Send,
  Stamp,
  Undo2,
  X,
} from "lucide-react";
import {
  approveDailyRecordAction,
  lookupScaleByQrAction,
  rejectDailyRecordAction,
  saveDailyRecordAction,
  submitDailyRecordAction,
} from "@/lib/actions";
import {
  DAILY_STATUS_LABEL,
  SCALE_KIND_LIST,
  type DailyRecord,
  type DailyStatus,
  type Scale,
  type ScaleKind,
} from "@/lib/scrapTypes";
import { fmt, fmtPct, toNum, toNumOrNull } from "@/lib/format";
import DateNav from "@/components/DateNav";

/** 明細行のドラフト（入力値は文字列で保持し、表示時に計算） */
type EntryDraft = {
  jikoku: string;
  scaleId: string | null;
  scaleName: string;
  kind: string;
  gross: string;
  tare: string;
  cumBefore: string;
  cumAfter: string;
  /** 投入前累積を自動値から変えたときの理由（空＝自動値のまま） */
  cumBeforeReason: string;
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

function KindTag({ kind }: { kind: string }) {
  return (
    <span
      className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
        kind === "上銅" ? "bg-[#faf6ef] text-[#b4632c]" : "bg-[#eef1f4] text-[#0b5ca8]"
      }`}
    >
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
 *   1. 投入先のスクラップ箱（重量計）をQR読み取り or ボタンで選択（上銅/銅ダライ）
 *   2. 投入前重量(箱含む) − 箱重量(空き箱) = スクラップ重量（自動計算）
 *   3. 「この投入を記録」→ 時刻・記録者は自動
 *   4. 終礼後に「管理者へ申請」→ 管理者が承認
 * 始業時のスクラップ箱残量は管理者のみが入力する（サーバー側でも強制）。
 */
export default function DailyRecordForm({
  date,
  factory,
  factoryOptions,
  factoryLocked,
  initial,
  scales,
  userName,
  isAdmin,
}: {
  date: string;
  factory: string;
  factoryOptions: string[];
  factoryLocked: boolean;
  initial: DailyRecord | null;
  scales: Scale[];
  userName: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const status: DailyStatus = initial?.status ?? "draft";
  // 申請中・承認済みは記録者はロック（管理者は編集・承認・差し戻し可）
  const locked = (status === "pending" || status === "approved") && !isAdmin;

  const [sekininsha, setSekininsha] = useState(initial?.sekininsha ?? "");
  const [zenjitsuOk, setZenjitsuOk] = useState(initial?.zenjitsuOk ?? false);
  const [hakoZanryo, setHakoZanryo] = useState(initial ? String(initial.hakoZanryo) : "0");
  const [entries, setEntries] = useState<EntryDraft[]>(
    (initial?.entries ?? []).map((e) => ({
      jikoku: e.jikoku,
      scaleId: e.scaleId,
      scaleName: e.scaleName || e.hinshu,
      kind: e.hinshu,
      gross: e.grossWeight !== null ? String(e.grossWeight) : "",
      tare: e.tareWeight !== null ? String(e.tareWeight) : "",
      cumBefore: e.cumBefore !== null ? String(e.cumBefore) : "",
      cumAfter: e.cumAfter !== null ? String(e.cumAfter) : "",
      cumBeforeReason: e.cumBeforeReason ?? "",
      kirokusha: e.kirokusha,
      ijo: e.ijo,
    }))
  );
  // 箱ごとの朝礼後の累積値（scaleId → 入力文字列）。その日の最初の投入前累積になる。
  const [kaishiCum, setKaishiCum] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const [id, v] of Object.entries(initial?.kaishiCum ?? {})) out[id] = String(v);
    return out;
  });
  const [kaishu, setKaishu] = useState(
    initial?.kaishuSokuteichi !== null && initial?.kaishuSokuteichi !== undefined
      ? String(initial.kaishuSokuteichi)
      : ""
  );
  const [tonyuKanryo, setTonyuKanryo] = useState(initial?.tonyuKanryo ?? false);
  const [biko, setBiko] = useState(initial?.biko ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // ===== 箱（重量計）選択 =====
  const [selectedScale, setSelectedScale] = useState<Scale | null>(null);
  const [qrInput, setQrInput] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);

  // ===== 計量入力 =====
  const [gross, setGross] = useState("");
  const [tare, setTare] = useState("");
  const [cumAfter, setCumAfter] = useState("");
  const [ijo, setIjo] = useState("");
  // 累積(投入前)は自動値。訂正するときだけ手入力に切り替え、理由を残す。
  const [cumFix, setCumFix] = useState(false);
  const [cumManual, setCumManual] = useState("");
  const [cumReason, setCumReason] = useState("");

  /**
   * 選択中の箱の「次に入るはずの累積(投入前)」。
   * 同じ箱の直前の投入後累積 → 無ければ朝礼後の累積値、の順で引き継ぐ。
   */
  const autoCumBefore = useMemo(() => {
    if (!selectedScale) return "";
    const last = [...entries]
      .reverse()
      .find((e) => e.scaleId === selectedScale.id && e.cumAfter !== "");
    if (last) return last.cumAfter;
    return kaishiCum[selectedScale.id] ?? "";
  }, [selectedScale, entries, kaishiCum]);

  // 自動値がまだ無い（朝礼後の累積値も前回の投入も無い）ときは、理由なしでそのまま手入力できる
  const cumLinked = autoCumBefore !== "";
  const cumEditable = !cumLinked || cumFix;
  const cumBefore = cumEditable ? cumManual : autoCumBefore;
  // 自動値から実際に変えたときだけ理由を必須にする（訂正を開いただけでは求めない）
  const cumCorrected =
    cumLinked && cumFix && cumManual.trim() !== "" && toNumOrNull(cumManual) !== toNumOrNull(autoCumBefore);

  const scrapWeight = useMemo(() => {
    const g = toNumOrNull(gross);
    const t = toNumOrNull(tare);
    if (g === null || t === null) return null;
    return Math.round((g - t) * 1000) / 1000;
  }, [gross, tare]);

  const cumDiff = useMemo(() => {
    const b = toNumOrNull(cumBefore);
    const a = toNumOrNull(cumAfter);
    if (b === null || a === null) return null;
    return Math.round((a - b) * 1000) / 1000;
  }, [cumBefore, cumAfter]);

  // 整合Δ = 累積差 − 自動計算のスクラップ重量。0.5kg超は要確認表示
  const gap =
    cumDiff !== null && scrapWeight !== null
      ? Math.round((cumDiff - scrapWeight) * 1000) / 1000
      : null;

  const total = useMemo(
    () =>
      entries.reduce((t, e) => {
        const g = toNumOrNull(e.gross);
        const ta = toNumOrNull(e.tare);
        return t + (g !== null && ta !== null ? g - ta : 0);
      }, 0),
    [entries]
  );
  const sairitsu = kaishu !== "" && total > 0 ? (toNum(kaishu) - total) / total : null;

  function moveTo(next: { factory?: string }) {
    const q = new URLSearchParams(searchParams.toString());
    if (next.factory) q.set("factory", next.factory);
    router.push(`${pathname}?${q.toString()}`);
  }

  function selectScale(scale: Scale) {
    setSelectedScale(scale);
    // 投入前累積は autoCumBefore が箱ごとに引き継ぐので、訂正の状態だけ解除する
    setCumFix(false);
    setCumManual("");
    setCumReason("");
    setMessage(null);
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

  async function openCameraScan() {
    setScanOpen(true);
    // カメラ読み取りは html5-qrcode を遅延ロード（初回のみ）
    setTimeout(async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        const scanner = new Html5Qrcode("scale-qr-reader");
        scannerRef.current = scanner as unknown as { stop: () => Promise<void>; clear: () => void };
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (text: string) => {
            void closeCameraScan();
            onQrCode(text);
          },
          () => {}
        );
      } catch (e) {
        setMessage({ ok: false, text: "カメラを起動できませんでした: " + (e as Error).message });
        setScanOpen(false);
      }
    }, 50);
  }

  async function closeCameraScan() {
    setScanOpen(false);
    const s = scannerRef.current;
    scannerRef.current = null;
    if (s) {
      try {
        await s.stop();
        s.clear();
      } catch {
        /* すでに停止済みなら無視 */
      }
    }
  }

  function addEntry() {
    setMessage(null);
    if (!selectedScale) {
      setMessage({ ok: false, text: "投入先のスクラップ箱（重量計）を選択してください。" });
      return;
    }
    if (scrapWeight === null) {
      setMessage({ ok: false, text: "投入前重量（箱含む）と箱重量（空き箱）を入力してください。" });
      return;
    }
    if (scrapWeight < 0) {
      setMessage({ ok: false, text: "投入前重量（箱含む）が箱重量より小さくなっています。" });
      return;
    }
    if (cumCorrected && !cumReason.trim()) {
      setMessage({
        ok: false,
        text: `累積(投入前)を自動値 ${autoCumBefore} kg から変更しています。訂正理由を入力してください。`,
      });
      return;
    }
    setEntries((prev) => [
      ...prev,
      {
        jikoku: nowTime(), // 時刻は記録した時間が自動で入る
        scaleId: selectedScale.id,
        scaleName: selectedScale.name,
        kind: selectedScale.kind,
        gross,
        tare,
        cumBefore,
        cumAfter,
        cumBeforeReason: cumCorrected ? cumReason.trim() : "",
        kirokusha: userName, // 記録者はログインユーザー
        ijo,
      },
    ]);
    // 次の投入に備えてクリア。投入前累積は今回の投入後累積が autoCumBefore として自動で入る
    setGross("");
    setTare("");
    setCumAfter("");
    setCumFix(false);
    setCumManual("");
    setCumReason("");
    setIjo("");
    setMessage({ ok: true, text: `${fmt(scrapWeight)} kg を記録しました。忘れずに保存してください。` });
  }

  function buildPayload() {
    return {
      recordDate: date,
      factory,
      sekininsha,
      zenjitsuOk,
      hakoZanryo,
      // 空欄の箱は送らない（未読取と 0kg を区別する）
      kaishiCum: Object.fromEntries(
        Object.entries(kaishiCum).filter(([, v]) => v.trim() !== "")
      ),
      kaishuSokuteichi: kaishu,
      tonyuKanryo,
      biko,
      entries: entries.map((e) => ({
        jikoku: e.jikoku,
        hinshu: e.kind,
        scaleId: e.scaleId,
        scaleName: e.scaleName,
        grossWeight: e.gross,
        tareWeight: e.tare,
        cumBefore: e.cumBefore,
        cumAfter: e.cumAfter,
        cumBeforeReason: e.cumBeforeReason,
        kirokusha: e.kirokusha,
        ijo: e.ijo,
      })),
    };
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      const res = await saveDailyRecordAction(buildPayload());
      setMessage({ ok: res.ok, text: res.message ?? "" });
      if (res.ok) router.refresh();
    });
  }

  function submit() {
    setMessage(null);
    startTransition(async () => {
      // 保存してから申請（未保存の入力を落とさない）
      const saved = await saveDailyRecordAction(buildPayload());
      if (!saved.ok) {
        setMessage({ ok: false, text: saved.message });
        return;
      }
      const res = await submitDailyRecordAction(date, factory);
      setMessage({ ok: res.ok, text: res.message ?? "" });
      if (res.ok) router.refresh();
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
    const comment = prompt("差し戻しの理由（記録者に表示されます）");
    if (comment === null) return;
    startTransition(async () => {
      const res = await rejectDailyRecordAction(date, factory, comment);
      setMessage({ ok: res.ok, text: res.message ?? "" });
      if (res.ok) router.refresh();
    });
  }

  // 一覧選択用。種類（上銅／銅ダライ）ごとにまとめ、マスター未定義の種類も末尾に出す
  const scaleGroups = useMemo(() => {
    const map = new Map<string, Scale[]>();
    for (const s of scales.filter((s) => s.active)) {
      if (!map.has(s.kind)) map.set(s.kind, []);
      map.get(s.kind)!.push(s);
    }
    const known = SCALE_KIND_LIST.filter((k) => map.has(k));
    const others = [...map.keys()].filter((k) => !SCALE_KIND_LIST.includes(k as ScaleKind));
    return [...known, ...others].map((kind) => ({ kind, items: map.get(kind)! }));
  }, [scales]);

  /** 選択肢の表示名。設備番号があれば先頭に付けて現場の呼び名と一致させる */
  const scaleLabel = (s: Scale) => (s.equipNo ? `${s.equipNo}　${s.name}` : s.name);

  const btnPrimary =
    "inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-[#b4632c] px-4 text-sm font-semibold text-white hover:bg-[#96521f] disabled:opacity-50";
  const btnOutline =
    "inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-[#b4632c] px-4 text-sm font-semibold text-[#b4632c] hover:bg-[#faf6ef] disabled:opacity-50";

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
          {/* 管理者の承認操作（記録者の保存/申請は画面下の操作バー） */}
          {isAdmin && (status === "pending" || status === "approved") && (
            <div className="flex flex-wrap gap-2 sm:ml-auto">
              {status === "pending" && (
                <button
                  onClick={approve}
                  disabled={pending}
                  className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-[#2f6b2f] px-4 text-sm font-semibold text-white hover:bg-[#255525] disabled:opacity-50"
                >
                  <Stamp className="h-4 w-4" />
                  承認
                </button>
              )}
              <button
                onClick={reject}
                disabled={pending}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-[#dc000c] px-4 text-sm font-semibold text-[#dc000c] hover:bg-[#fdecea] disabled:opacity-50"
              >
                <Undo2 className="h-4 w-4" />
                差し戻し
              </button>
            </div>
          )}
        </div>
        {locked && (
          <p className="mt-3 rounded-lg bg-[#fff3e0] px-3 py-2 text-sm text-[#a15c00]">
            {status === "pending"
              ? "管理者へ申請中のため編集できません。承認または差し戻しをお待ちください。"
              : "承認済みの記録です。修正が必要な場合は管理者へ連絡してください。"}
          </p>
        )}
        {status === "rejected" && initial?.rejectComment && (
          <p className="mt-3 rounded-lg bg-[#fdecea] px-3 py-2 text-sm text-[#dc000c]">
            差し戻し（{initial.approvedBy}）: {initial.rejectComment}
          </p>
        )}
      </section>

      {/* 【1】朝礼確認（始業時残量は管理者のみ入力） */}
      <Step n={1} title="朝礼確認">
        <div className="space-y-3 text-sm">
          <label className="flex items-center gap-2.5">
            <input
              type="checkbox"
              checked={zenjitsuOk}
              onChange={(e) => setZenjitsuOk(e.target.checked)}
              className="h-5 w-5 accent-[#b4632c]"
              disabled={locked}
            />
            前日の記録は完備されている
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <span>始業時スクラップ箱残量</span>
            {isAdmin ? (
              <>
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  value={hakoZanryo}
                  onChange={(e) => setHakoZanryo(e.target.value)}
                  className={`${numInput} w-28`}
                />
                <span className="text-xs text-[#909090]">kg（0=空）／ 管理者のみ入力できます</span>
              </>
            ) : (
              <>
                <span className="flex h-11 items-center rounded-lg border border-[#e5e5e5] bg-[#f7f7f5] px-3 text-sm font-semibold tabular-nums sm:h-10">
                  {fmt(toNum(hakoZanryo))} kg
                </span>
                <span className="text-xs text-[#909090]">管理者が入力します</span>
              </>
            )}
          </div>

          {/* 朝礼後の重量計の累積値。その日の最初の投入の「累積(投入前)」に自動で入る */}
          {scales.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-bold text-[#707070]">
                朝礼後の累積値（重量計の表示値）
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {scales
                  .filter((s) => s.active)
                  .map((s) => (
                    <label
                      key={s.id}
                      className="flex items-center gap-2 rounded-xl border border-[#e5e5e5] px-3 py-2"
                    >
                      <span className="min-w-0 flex-1 truncate text-sm text-[#555555]">
                        {scaleLabel(s)}
                      </span>
                      <KindTag kind={s.kind} />
                      <input
                        type="number"
                        inputMode="decimal"
                        step="0.1"
                        min="0"
                        value={kaishiCum[s.id] ?? ""}
                        onChange={(e) =>
                          setKaishiCum((prev) => ({ ...prev, [s.id]: e.target.value }))
                        }
                        className={`${numInput} w-24`}
                        disabled={locked}
                      />
                      <span className="text-xs text-[#909090]">kg</span>
                    </label>
                  ))}
              </div>
              <p className="mt-1.5 text-xs text-[#909090]">
                入力すると、その箱の最初の投入の「累積(投入前)」に自動で入ります。
                2回目以降は前の投入の「累積(投入後)」が引き継がれます。
              </p>
            </div>
          )}
        </div>
      </Step>

      {/* 【2】スクラップ箱（重量計）の選択 */}
      {!locked && (
        <Step
          n={2}
          title="スクラップ箱を選ぶ"
          hint="重量計に貼られたQRコードを読み取るか、一覧から選びます。"
        >
          {selectedScale ? (
            <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-[#b4632c] bg-[#faf6ef] px-3 py-2.5">
              <span className="flex min-w-0 items-center gap-2 text-sm font-bold text-[#b4632c]">
                <CheckCircle2 className="h-5 w-5 shrink-0" />
                <span className="truncate">{scaleLabel(selectedScale)}</span>
                <KindTag kind={selectedScale.kind} />
              </span>
              <button
                onClick={() => setSelectedScale(null)}
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

          <button
            onClick={openCameraScan}
            className="mb-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#333333] text-base font-semibold text-white hover:bg-[#111111] sm:h-11 sm:w-auto sm:px-5 sm:text-sm"
          >
            <Camera className="h-5 w-5" />
            カメラでQRを読み取る
          </button>

          {/* QRが読めないとき・貼り付けが剥がれたときのために一覧からも選べるようにする */}
          {scales.length === 0 ? (
            <p className="rounded-lg bg-[#fff3e0] px-3 py-2 text-sm text-[#a15c00]">
              重量計（スクラップ箱）が未登録です。管理者に「重量計マスター」への登録を依頼してください。
            </p>
          ) : (
            <label className="flex flex-col gap-1 text-xs font-bold text-[#707070]">
              一覧から選ぶ（QRが読めないとき）
              <select
                value={selectedScale?.id ?? ""}
                onChange={(e) => {
                  const next = scales.find((s) => s.id === e.target.value);
                  if (next) selectScale(next);
                  else setSelectedScale(null);
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

      {/* 【3】計量して記録 */}
      {!locked && (
        <Step
          n={3}
          title="計量して記録する"
          hint="スクラップ重量 = 投入前重量(箱含む) − 箱重量(空き箱)。時刻と記録者は自動で入ります。"
        >
          {/* ① 投入前重量 ② 箱重量 → スクラップ重量（自動計算） */}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-xs text-[#707070]">
              <FieldNo n="①" />
              投入前重量(箱含む) kg
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                value={gross}
                onChange={(e) => setGross(e.target.value)}
                className={numInput}
              />
            </label>
            <label className="flex flex-col gap-1 text-xs text-[#707070]">
              <FieldNo n="②" />
              箱重量(空き箱) kg
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                value={tare}
                onChange={(e) => setTare(e.target.value)}
                className={numInput}
              />
            </label>
          </div>

          <div
            className={`mt-3 flex items-center justify-between rounded-xl border px-4 py-3 ${
              scrapWeight !== null && scrapWeight < 0
                ? "border-[#dc000c] bg-[#fdecea]"
                : "border-[#e5e5e5] bg-[#f7f7f5]"
            }`}
          >
            <span className="text-sm text-[#707070]">スクラップ重量（①−②）</span>
            <span
              className={`text-2xl font-bold tabular-nums ${
                scrapWeight !== null && scrapWeight < 0 ? "text-[#dc000c]" : "text-[#333333]"
              }`}
            >
              {scrapWeight !== null ? `${fmt(scrapWeight)} kg` : "—"}
            </span>
          </div>

          {/* ③ 重量計の累積値（投入前 → 投入後）。自動計算との整合Δを確認する */}
          <div className="mt-4">
            <div className="mb-1.5 text-xs font-bold text-[#707070]">
              <FieldNo n="③" />
              重量計の累積値
            </div>
            <div className="grid grid-cols-2 gap-3">
              {/* 訂正ボタンは label の外に置く（label が指す入力欄がボタンにならないように） */}
              <div className="flex flex-col gap-1 text-xs text-[#707070]">
                <span className="flex items-center justify-between gap-1">
                  累積(投入前) kg
                  {cumLinked && !cumFix && (
                    <button
                      type="button"
                      onClick={() => {
                        setCumFix(true);
                        setCumManual(autoCumBefore);
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
                  onChange={(e) => setCumManual(e.target.value)}
                  readOnly={!cumEditable}
                  aria-label="累積(投入前) kg"
                  className={`${numInput} ${!cumEditable ? "bg-[#f0f0ee] text-[#555555]" : ""}`}
                />
              </div>
              <label className="flex flex-col gap-1 text-xs text-[#707070]">
                累積(投入後) kg
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  value={cumAfter}
                  onChange={(e) => setCumAfter(e.target.value)}
                  className={numInput}
                />
              </label>
            </div>

            {/* 自動で入った値の出どころ／訂正のときの理由入力 */}
            {cumLinked && !cumFix && (
              <p className="mt-1.5 text-xs text-[#909090]">
                {entries.some((e) => e.scaleId === selectedScale?.id && e.cumAfter !== "")
                  ? "前の投入の「累積(投入後)」が自動で入っています。"
                  : "朝礼後の累積値が自動で入っています。"}
                　違う場合は「訂正」から直せます（理由が必要です）。
              </p>
            )}
            {!cumLinked && selectedScale && (
              <p className="mt-1.5 text-xs text-[#a15c00]">
                この箱の朝礼後の累積値が未入力です。1の朝礼確認で入力すると、以降は自動で引き継がれます。
              </p>
            )}
            {cumFix && (
              <div className="mt-2 rounded-lg border border-[#b4632c] bg-[#faf6ef] p-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-xs font-bold text-[#96521f]">
                    訂正中（自動値 {autoCumBefore || "—"} kg）
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      setCumFix(false);
                      setCumManual("");
                      setCumReason("");
                    }}
                    className="rounded px-1 text-xs font-semibold text-[#96521f] underline"
                  >
                    自動値に戻す
                  </button>
                </div>
                <input
                  type="text"
                  value={cumReason}
                  onChange={(e) => setCumReason(e.target.value)}
                  placeholder="訂正理由（例: 前回の読み取り誤り、途中で他部署が投入）"
                  aria-label="累積の訂正理由"
                  className={`${input} w-full`}
                />
                {cumCorrected && !cumReason.trim() && (
                  <p className="mt-1 text-xs text-[#dc000c]">訂正理由を入力してください。</p>
                )}
              </div>
            )}
            <div className="mt-2 flex items-center justify-between rounded-lg border border-[#e5e5e5] bg-[#f7f7f5] px-3 py-2 text-sm">
              <span className="text-[#707070]">累積差 / 整合Δ</span>
              <span
                className={`font-bold tabular-nums ${
                  gap !== null && Math.abs(gap) > 0.5 ? "text-[#dc000c]" : "text-[#333333]"
                }`}
              >
                {cumDiff !== null ? `${fmt(cumDiff)} kg` : "—"}
                {gap !== null ? `（Δ ${gap > 0 ? "+" : ""}${fmt(gap)}）` : ""}
              </span>
            </div>
            {gap !== null && Math.abs(gap) > 0.5 && (
              <p className="mt-1.5 text-xs text-[#dc000c]">
                累積差と自動計算のスクラップ重量に {fmt(Math.abs(gap))} kg
                の差があります。計量を確認してください（そのまま記録も可能です）。
              </p>
            )}
          </div>

          {/* ④ 異常メモ */}
          <label className="mt-4 flex flex-col gap-1 text-xs text-[#707070]">
            <span className="text-xs font-bold text-[#707070]">
              <FieldNo n="④" />
              異常メモ
            </span>
            <input
              type="text"
              value={ijo}
              onChange={(e) => setIjo(e.target.value)}
              placeholder="異常があれば記入（例: 異物混入、計量やり直し）"
              className={input}
            />
          </label>

          <button
            onClick={addEntry}
            className="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#333333] text-base font-semibold text-white hover:bg-[#111111] sm:h-11 sm:w-auto sm:px-6 sm:text-sm"
          >
            <Plus className="h-5 w-5" />
            この投入を記録
          </button>
          {message && (
            <p className={`mt-2 text-sm ${message.ok ? "text-[#2f6b2f]" : "text-[#dc000c]"}`}>
              {message.text}
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

        {entries.length === 0 ? (
          <p className="rounded-lg bg-[#f7f7f5] px-3 py-3 text-sm text-[#707070]">
            まだ投入記録がありません。
          </p>
        ) : (
          <>
            {/* モバイル: カード */}
            <ul className="space-y-2 sm:hidden">
              {entries.map((e, i) => {
                const g = toNumOrNull(e.gross);
                const ta = toNumOrNull(e.tare);
                const w = g !== null && ta !== null ? g - ta : null;
                const cb = toNumOrNull(e.cumBefore);
                const ca = toNumOrNull(e.cumAfter);
                const d = cb !== null && ca !== null && w !== null ? ca - cb - w : null;
                return (
                  <li key={i} className="rounded-xl border border-[#e5e5e5] p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold tabular-nums">{e.jikoku}</span>
                          <KindTag kind={e.kind} />
                        </div>
                        <div className="mt-0.5 truncate text-sm text-[#555555]">{e.scaleName}</div>
                        <div className="mt-0.5 text-xs text-[#909090]">
                          {fmt(g)} − {fmt(ta)} ／ 記録者 {e.kirokusha}
                          {d !== null && Math.abs(d) > 0.5 && (
                            <span className="ml-1 font-bold text-[#dc000c]">
                              Δ {d > 0 ? "+" : ""}
                              {fmt(d)}
                            </span>
                          )}
                        </div>
                        {e.cumBeforeReason && (
                          <div className="mt-0.5 text-xs text-[#a15c00]">
                            累積訂正: {e.cumBeforeReason}
                          </div>
                        )}
                        {e.ijo && <div className="mt-0.5 text-xs text-[#dc000c]">異常: {e.ijo}</div>}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-lg font-bold tabular-nums">{fmt(w)}</span>
                        {!locked && (
                          <button
                            onClick={() => setEntries((prev) => prev.filter((_, j) => j !== i))}
                            className="rounded-lg p-2 text-[#dc000c] hover:bg-[#fdecea]"
                            aria-label="行を削除"
                          >
                            <X className="h-5 w-5" />
                          </button>
                        )}
                      </div>
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
                    <th className={th}>スクラップ箱</th>
                    <th className={th}>種類</th>
                    <th className={`${th} text-right`}>投入前(箱含む)</th>
                    <th className={`${th} text-right`}>箱重量</th>
                    <th className={`${th} text-right`}>スクラップ重量</th>
                    <th className={`${th} text-right`}>累積(前)</th>
                    <th className={`${th} text-right`}>累積(後)</th>
                    <th className={`${th} text-right`}>整合Δ</th>
                    <th className={th}>累積訂正理由</th>
                    <th className={th}>記録者</th>
                    <th className={th}>異常</th>
                    {!locked && <th className={th}></th>}
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e, i) => {
                    const g = toNumOrNull(e.gross);
                    const ta = toNumOrNull(e.tare);
                    const w = g !== null && ta !== null ? g - ta : null;
                    const cb = toNumOrNull(e.cumBefore);
                    const ca = toNumOrNull(e.cumAfter);
                    const d = cb !== null && ca !== null && w !== null ? ca - cb - w : null;
                    return (
                      <tr key={i}>
                        <td className={td}>{e.jikoku}</td>
                        <td className={td}>{e.scaleName}</td>
                        <td className={td}>
                          <KindTag kind={e.kind} />
                        </td>
                        <td className={tdNum}>{fmt(g)}</td>
                        <td className={tdNum}>{fmt(ta)}</td>
                        <td className={`${tdNum} font-semibold`}>{fmt(w)}</td>
                        <td className={tdNum}>{fmt(cb)}</td>
                        <td className={tdNum}>{fmt(ca)}</td>
                        <td
                          className={`${tdNum} ${d !== null && Math.abs(d) > 0.5 ? "bg-[#fdecea] text-[#dc000c]" : ""}`}
                        >
                          {d !== null ? `${d > 0 ? "+" : ""}${fmt(d)}` : "-"}
                        </td>
                        <td className={`${td} ${e.cumBeforeReason ? "text-[#a15c00]" : ""}`}>
                          {e.cumBeforeReason}
                        </td>
                        <td className={td}>{e.kirokusha}</td>
                        <td className={td}>{e.ijo}</td>
                        {!locked && (
                          <td className={`${td} text-center`}>
                            <button
                              onClick={() => setEntries((prev) => prev.filter((_, j) => j !== i))}
                              className="rounded p-1 text-[#dc000c] hover:bg-[#fdecea]"
                              aria-label="行を削除"
                            >
                              <X className="h-4 w-4" />
                            </button>
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

      {/* 【4】終礼集計 */}
      <Step n={4} title="終礼集計">
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
        </div>
      </Step>

      {/* 操作バー（モバイルは画面下に固定） */}
      {!locked && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#e5e5e5] bg-white/95 p-3 backdrop-blur sm:static sm:z-auto sm:rounded-2xl sm:border sm:p-4">
          <div className="flex items-center gap-2">
            <button onClick={save} disabled={pending} className={`${btnOutline} flex-1 sm:flex-none`}>
              <Save className="h-4 w-4" />
              保存
            </button>
            {status !== "approved" && status !== "pending" && (
              <button
                onClick={submit}
                disabled={pending}
                className={`${btnPrimary} flex-1 sm:flex-none`}
              >
                <Send className="h-4 w-4" />
                管理者へ申請
              </button>
            )}
            <span className="hidden text-xs text-[#909090] sm:inline">
              記録が済んだら「管理者へ申請」してください。承認をもって当日の記録が確定します。
            </span>
          </div>
        </div>
      )}

      {/* カメラ読み取りモーダル */}
      {scanOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#333333]">重量計のQRコードを読み取り</h3>
              <button
                onClick={() => void closeCameraScan()}
                className="rounded p-1.5 text-[#555555] hover:bg-[#f0f0ee]"
                aria-label="閉じる"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div id="scale-qr-reader" className="overflow-hidden rounded-lg" />
          </div>
        </div>
      )}
    </div>
  );
}
