"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Camera, CheckCircle2, QrCode, Save, Send, Stamp, Undo2, X } from "lucide-react";
import {
  approveDailyRecordAction,
  lookupScaleByQrAction,
  rejectDailyRecordAction,
  saveDailyRecordAction,
  submitDailyRecordAction,
} from "@/lib/actions";
import { DAILY_STATUS_LABEL, type DailyRecord, type DailyStatus, type Scale } from "@/lib/scrapTypes";
import { fmt, fmtPct, toNum, toNumOrNull } from "@/lib/format";

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
  kirokusha: string;
  ijo: string;
};

const input =
  "rounded-lg border border-[#e5e5e5] bg-white px-2 py-1.5 text-sm focus:border-[#b4632c] focus:outline-none disabled:bg-[#f0f0ee] disabled:text-[#909090]";
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

/**
 * スクラップ日次記録票。計量の流れ:
 *   1. 投入先のスクラップ箱（重量計）をQR読み取り or 一覧から選択（上銅/銅ダライ）
 *   2. 投入前重量(箱含む) − 箱重量(空き箱) = スクラップ重量（自動計算）
 *   3. スクラップ箱の重量計の累積値（投入前/投入後）を記録し、差分との整合を確認
 *   4. 「この投入を記録」→ 時刻・記録者は自動 → 保存 → 管理者へ申請
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

  // ===== 箱（重量計）選択 =====
  const [selectedScale, setSelectedScale] = useState<Scale | null>(null);
  const [qrInput, setQrInput] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);

  // ===== 計量入力 =====
  const [gross, setGross] = useState("");
  const [tare, setTare] = useState("");
  const [cumBefore, setCumBefore] = useState("");
  const [cumAfter, setCumAfter] = useState("");
  const [ijo, setIjo] = useState("");

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

  function moveTo(next: { date?: string; factory?: string }) {
    const q = new URLSearchParams(searchParams.toString());
    if (next.date) q.set("date", next.date);
    if (next.factory) q.set("factory", next.factory);
    router.push(`${pathname}?${q.toString()}`);
  }

  function selectScale(scale: Scale) {
    setSelectedScale(scale);
    // 同じ箱の直近の「投入後累積」を次の「投入前累積」に自動引き継ぎ
    const last = [...entries].reverse().find((e) => e.scaleId === scale.id && e.cumAfter !== "");
    setCumBefore(last ? last.cumAfter : "");
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
        kirokusha: userName, // 記録者はログインユーザー
        ijo,
      },
    ]);
    // 次の投入に備えてクリア（累積は投入後→次の投入前へ引き継ぎ）
    setGross("");
    setTare("");
    setCumBefore(cumAfter);
    setCumAfter("");
    setIjo("");
  }

  function buildPayload() {
    return {
      recordDate: date,
      factory,
      sekininsha,
      zenjitsuOk,
      hakoZanryo,
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

  const scalesByKind = useMemo(() => {
    const map = new Map<string, Scale[]>();
    for (const s of scales.filter((s) => s.active)) {
      if (!map.has(s.kind)) map.set(s.kind, []);
      map.get(s.kind)!.push(s);
    }
    return map;
  }, [scales]);

  return (
    <div className="space-y-4">
      {/* 対象の日付・工場・状態・操作 */}
      <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs text-[#707070]">
            日付
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && moveTo({ date: e.target.value })}
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[#707070]">
            工場
            {factoryLocked ? (
              <span className="rounded-lg border border-[#e5e5e5] bg-[#f7f7f5] px-3 py-1.5 text-sm text-[#333333]">
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
          </label>
          <label className="flex flex-col gap-1 text-xs text-[#707070]">
            当番責任者
            <input
              type="text"
              value={sekininsha}
              onChange={(e) => setSekininsha(e.target.value)}
              className={input}
              placeholder={userName}
              disabled={locked}
            />
          </label>
          <div className="flex flex-col gap-1 text-xs text-[#707070]">
            状態
            <div className="py-1">
              <StatusBadge status={status} />
              {status === "approved" && initial?.approvedBy && (
                <span className="ml-2 text-xs text-[#707070]">承認: {initial.approvedBy}</span>
              )}
              {status === "pending" && initial?.appliedBy && (
                <span className="ml-2 text-xs text-[#707070]">申請: {initial.appliedBy}</span>
              )}
            </div>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {!locked && (
              <button
                onClick={save}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#b4632c] px-4 py-2 text-sm font-semibold text-[#b4632c] hover:bg-[#faf6ef] disabled:opacity-50"
              >
                <Save className="h-4 w-4" />
                保存
              </button>
            )}
            {!locked && status !== "approved" && status !== "pending" && (
              <button
                onClick={submit}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[#b4632c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#96521f] disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                管理者へ申請
              </button>
            )}
            {isAdmin && status === "pending" && (
              <>
                <button
                  onClick={approve}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#2f6b2f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#255525] disabled:opacity-50"
                >
                  <Stamp className="h-4 w-4" />
                  承認
                </button>
                <button
                  onClick={reject}
                  disabled={pending}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[#dc000c] px-4 py-2 text-sm font-semibold text-[#dc000c] hover:bg-[#fdecea] disabled:opacity-50"
                >
                  <Undo2 className="h-4 w-4" />
                  差し戻し
                </button>
              </>
            )}
            {isAdmin && status === "approved" && (
              <button
                onClick={reject}
                disabled={pending}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#dc000c] px-4 py-2 text-sm font-semibold text-[#dc000c] hover:bg-[#fdecea] disabled:opacity-50"
              >
                <Undo2 className="h-4 w-4" />
                差し戻し
              </button>
            )}
          </div>
        </div>
        {locked && (
          <p className="mt-2 rounded-lg bg-[#fff3e0] px-3 py-2 text-sm text-[#a15c00]">
            {status === "pending"
              ? "管理者へ申請中のため編集できません。承認または差し戻しをお待ちください。"
              : "承認済みの記録です。修正が必要な場合は管理者へ連絡してください。"}
          </p>
        )}
        {status === "rejected" && initial?.rejectComment && (
          <p className="mt-2 rounded-lg bg-[#fdecea] px-3 py-2 text-sm text-[#dc000c]">
            差し戻し（{initial.approvedBy}）: {initial.rejectComment}
          </p>
        )}
        {message && (
          <p className={`mt-2 text-sm ${message.ok ? "text-[#2f6b2f]" : "text-[#dc000c]"}`}>
            {message.text}
          </p>
        )}
      </section>

      {/* 【1】朝礼確認 */}
      <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-bold text-[#333333]">【1】朝礼確認</h2>
        <div className="flex flex-wrap items-center gap-6 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={zenjitsuOk}
              onChange={(e) => setZenjitsuOk(e.target.checked)}
              className="h-4 w-4 accent-[#b4632c]"
              disabled={locked}
            />
            前日の記録は完備されている
          </label>
          <label className="flex items-center gap-2">
            始業時スクラップ箱残量(kg)
            <input
              type="number"
              step="0.1"
              min="0"
              value={hakoZanryo}
              onChange={(e) => setHakoZanryo(e.target.value)}
              className={`${input} w-24 text-right`}
              disabled={locked}
            />
            <span className="text-xs text-[#909090]">0=空</span>
          </label>
        </div>
      </section>

      {/* 【2】スクラップ箱（重量計）の選択 */}
      {!locked && (
        <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
          <h2 className="mb-1 text-sm font-bold text-[#333333]">
            【2】投入先のスクラップ箱（重量計）を選択
          </h2>
          <p className="mb-3 text-xs text-[#909090]">
            重量計に貼られたQRコードを読み取るか、一覧から選択します（上銅 / 銅ダライ）。
          </p>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <div className="relative">
              <QrCode className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#909090]" />
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
                className={`${input} w-80 pl-8`}
              />
            </div>
            <button
              onClick={openCameraScan}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] px-3 py-1.5 text-sm text-[#555555] hover:bg-[#f7f7f5]"
            >
              <Camera className="h-4 w-4" />
              カメラで読み取り
            </button>
            {selectedScale && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#faf6ef] px-3 py-1.5 text-sm font-semibold text-[#b4632c]">
                <CheckCircle2 className="h-4 w-4" />
                選択中: {selectedScale.name}（{selectedScale.kind}）
              </span>
            )}
          </div>
          {scales.length === 0 ? (
            <p className="rounded-lg bg-[#fff3e0] px-3 py-2 text-sm text-[#a15c00]">
              重量計（スクラップ箱）が未登録です。管理者に「重量計マスター」への登録を依頼してください。
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {["上銅", "銅ダライ"].map((kind) => (
                <div key={kind} className="rounded-xl border border-[#e5e5e5] p-3">
                  <div className="mb-2 text-xs font-bold text-[#707070]">{kind}</div>
                  <div className="flex flex-wrap gap-2">
                    {(scalesByKind.get(kind) ?? []).map((scale) => (
                      <button
                        key={scale.id}
                        onClick={() => selectScale(scale)}
                        className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
                          selectedScale?.id === scale.id
                            ? "bg-[#b4632c] text-white"
                            : "border border-[#e5e5e5] text-[#555555] hover:bg-[#f7f7f5]"
                        }`}
                      >
                        {scale.name}
                      </button>
                    ))}
                    {(scalesByKind.get(kind) ?? []).length === 0 && (
                      <span className="text-xs text-[#909090]">未登録</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* 【3】計量・投入記録 */}
      <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <h2 className="mb-1 text-sm font-bold text-[#333333]">
          【3】計量・投入記録（時刻・記録者は自動）
        </h2>
        <p className="mb-3 text-xs text-[#909090]">
          スクラップ重量 = 投入前重量(箱含む) − 箱重量(空き箱)。スクラップ箱の重量計の累積値（投入前/投入後）も記録し、自動計算と整合を確認します。
        </p>

        {!locked && (
          <div className="mb-4 rounded-xl bg-[#f7f7f5] p-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs text-[#707070]">
                投入前重量(箱含む) kg
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={gross}
                  onChange={(e) => setGross(e.target.value)}
                  className={`${input} w-32 text-right`}
                />
              </label>
              <span className="pb-2 text-sm text-[#707070]">−</span>
              <label className="flex flex-col gap-1 text-xs text-[#707070]">
                箱重量(空き箱) kg
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={tare}
                  onChange={(e) => setTare(e.target.value)}
                  className={`${input} w-32 text-right`}
                />
              </label>
              <span className="pb-2 text-sm text-[#707070]">=</span>
              <div className="flex flex-col gap-1 text-xs text-[#707070]">
                スクラップ重量
                <span
                  className={`rounded-lg border px-3 py-1.5 text-right text-sm font-bold tabular-nums ${
                    scrapWeight !== null && scrapWeight < 0
                      ? "border-[#dc000c] bg-[#fdecea] text-[#dc000c]"
                      : "border-[#e5e5e5] bg-white"
                  }`}
                >
                  {scrapWeight !== null ? `${fmt(scrapWeight)} kg` : "—"}
                </span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs text-[#707070]">
                箱の重量計・累積(投入前) kg
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={cumBefore}
                  onChange={(e) => setCumBefore(e.target.value)}
                  className={`${input} w-36 text-right`}
                />
              </label>
              <span className="pb-2 text-sm text-[#707070]">→</span>
              <label className="flex flex-col gap-1 text-xs text-[#707070]">
                累積(投入後) kg
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={cumAfter}
                  onChange={(e) => setCumAfter(e.target.value)}
                  className={`${input} w-36 text-right`}
                />
              </label>
              <div className="flex flex-col gap-1 text-xs text-[#707070]">
                累積差 / 整合Δ
                <span
                  className={`rounded-lg border px-3 py-1.5 text-right text-sm font-bold tabular-nums ${
                    gap !== null && Math.abs(gap) > 0.5
                      ? "border-[#dc000c] bg-[#fdecea] text-[#dc000c]"
                      : "border-[#e5e5e5] bg-white"
                  }`}
                >
                  {cumDiff !== null ? `${fmt(cumDiff)} kg` : "—"}
                  {gap !== null ? `（Δ ${gap > 0 ? "+" : ""}${fmt(gap)}）` : ""}
                </span>
              </div>
              <label className="flex flex-col gap-1 text-xs text-[#707070]">
                異常メモ
                <input
                  type="text"
                  value={ijo}
                  onChange={(e) => setIjo(e.target.value)}
                  className={`${input} w-44`}
                />
              </label>
              <button
                onClick={addEntry}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[#333333] px-4 py-2 text-sm font-semibold text-white hover:bg-[#111111]"
              >
                この投入を記録
              </button>
            </div>
            {gap !== null && Math.abs(gap) > 0.5 && (
              <p className="mt-2 text-xs text-[#dc000c]">
                累積差と自動計算のスクラップ重量に {fmt(Math.abs(gap))} kg の差があります。計量を確認してください（そのまま記録も可能です）。
              </p>
            )}
          </div>
        )}

        <div className="overflow-x-auto">
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
                <th className={th}>記録者</th>
                <th className={th}>異常</th>
                {!locked && <th className={th}></th>}
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr>
                  <td className={td} colSpan={locked ? 11 : 12}>
                    投入記録がありません
                  </td>
                </tr>
              )}
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
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
                          e.kind === "上銅"
                            ? "bg-[#faf6ef] text-[#b4632c]"
                            : "bg-[#eef1f4] text-[#0b5ca8]"
                        }`}
                      >
                        {e.kind}
                      </span>
                    </td>
                    <td className={tdNum}>{fmt(toNumOrNull(e.gross))}</td>
                    <td className={tdNum}>{fmt(toNumOrNull(e.tare))}</td>
                    <td className={`${tdNum} font-semibold`}>{fmt(w)}</td>
                    <td className={tdNum}>{fmt(cb)}</td>
                    <td className={tdNum}>{fmt(ca)}</td>
                    <td
                      className={`${tdNum} ${d !== null && Math.abs(d) > 0.5 ? "bg-[#fdecea] text-[#dc000c]" : ""}`}
                    >
                      {d !== null ? `${d > 0 ? "+" : ""}${fmt(d)}` : "-"}
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
      </section>

      {/* 【4】終礼集計 */}
      <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-bold text-[#333333]">【4】終礼集計</h2>
        <div className="flex flex-wrap items-center gap-6 text-sm">
          <div>
            当日合計 <span className="text-base font-bold tabular-nums">{fmt(total)}</span> kg
          </div>
          <label className="flex items-center gap-2">
            回収箱測定値(kg)
            <input
              type="number"
              step="0.1"
              min="0"
              value={kaishu}
              onChange={(e) => setKaishu(e.target.value)}
              className={`${input} w-28 text-right`}
              disabled={locked}
            />
          </label>
          <div>
            差異率{" "}
            <span
              className={`font-bold tabular-nums ${
                sairitsu !== null && Math.abs(sairitsu) > 0.05 ? "text-[#dc000c]" : ""
              }`}
            >
              {fmtPct(sairitsu)}
            </span>
          </div>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={tonyuKanryo}
              onChange={(e) => setTonyuKanryo(e.target.checked)}
              className="h-4 w-4 accent-[#b4632c]"
              disabled={locked}
            />
            当日スクラップを全量、指定箱に投入した
          </label>
        </div>
        <p className="mt-2 text-xs text-[#909090]">
          記録が済んだら「管理者へ申請」してください。管理者の承認をもって当日の記録が確定します。
        </p>
      </section>

      {/* 【5】備考 */}
      <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-bold text-[#333333]">【5】備考（異常事項・気付き等）</h2>
        <textarea
          rows={3}
          value={biko}
          onChange={(e) => setBiko(e.target.value)}
          className={`${input} w-full`}
          disabled={locked}
        />
        <p className="mt-2 text-xs text-[#909090]">
          ※ 記録保管期間：日次記録3年 / 月次集計5年。月間集計はCSV出力して品管・経営層へ報告。
        </p>
      </section>

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
