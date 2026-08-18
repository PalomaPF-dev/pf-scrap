"use client";

import { useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Camera, CheckCircle2, QrCode, Save, Stamp, Trash2, Undo2, X } from "lucide-react";
import {
  approveFirstArticleAction,
  deleteFirstArticleAction,
  lookupItemByQrAction,
  rejectFirstArticleAction,
  saveFirstArticleAction,
} from "@/lib/actions";
import { FA_STATUS_LABEL, type FirstArticle, type ScrapItem } from "@/lib/scrapTypes";
import { fmt, todayStr } from "@/lib/format";

const td = "border border-[#e5e5e5] px-2.5 py-1.5 whitespace-nowrap";
const tdNum = `${td} text-right tabular-nums`;
const th = "border border-[#e5e5e5] bg-[#f0f0ee] px-2.5 py-1.5 text-left font-semibold whitespace-nowrap";
const input =
  "h-11 rounded-lg border border-[#e5e5e5] bg-white px-3 text-base focus:border-[#b4632c] focus:outline-none sm:h-10 sm:text-sm";

/** 手順番号つきの見出し */
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

function StatusTag({ h }: { h: FirstArticle }) {
  return (
    <span
      title={h.status === "rejected" && h.rejectComment ? h.rejectComment : undefined}
      className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${
        h.status === "approved"
          ? "bg-[#eef4ee] text-[#2f6b2f]"
          : h.status === "pending"
            ? "bg-[#fff3e0] text-[#a15c00]"
            : "bg-[#fdecea] text-[#dc000c]"
      }`}
    >
      {FA_STATUS_LABEL[h.status]}
    </span>
  );
}

/**
 * ③ 初品測定（モバイル優先）。
 *   1. 工場を選ぶ
 *   2. 品目QRを読み取る（QR一覧は品目マスターから印刷）
 *   3. 実測重量を入力して管理者へ申請
 * 品目の一覧表示は品目マスター側に集約したため、この画面には持たない。
 */
export default function FirstArticlePanel({
  factory,
  factoryOptions,
  factoryLocked,
  history,
  otherCount,
  userName,
  isAdmin,
}: {
  factory: string;
  factoryOptions: string[];
  factoryLocked: boolean;
  history: FirstArticle[];
  /** 選択中の工場に該当しない測定記録の件数（見落としを防ぐため件数だけ知らせる） */
  otherCount: number;
  userName: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [selected, setSelected] = useState<ScrapItem | null>(null);
  const [qrInput, setQrInput] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const [weight, setWeight] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function moveToFactory(next: string) {
    const q = new URLSearchParams(searchParams.toString());
    q.set("factory", next);
    router.push(`${pathname}?${q.toString()}`);
  }

  function onQrCode(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return;
    setQrInput("");
    startTransition(async () => {
      const item = await lookupItemByQrAction(trimmed);
      if (!item) {
        setMessage({
          ok: false,
          text: `QRコード「${trimmed}」の品目が見つかりません。品目マスターの登録を管理者に確認してください。`,
        });
        return;
      }
      setSelected(item);
      // 工場名の表記ゆれ（「大口」/「大口工場」など）もあるため、
      // 違っていても作業は止めず、取り違えに気付けるよう注意だけ出す
      if (factory && item.factory && item.factory !== factory) {
        setMessage({
          ok: false,
          text: `注意: この品目はマスター上「${item.factory}」の品目です（選択中の工場は「${factory}」）。取り違えでなければそのまま登録できます。`,
        });
      } else {
        setMessage({ ok: true, text: `品目「${item.hinmei || item.key}」を選択しました。` });
      }
    });
  }

  async function openCameraScan() {
    setScanOpen(true);
    setTimeout(async () => {
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        const scanner = new Html5Qrcode("item-qr-reader");
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

  function save() {
    if (!selected) {
      setMessage({ ok: false, text: "品目QRを読み取って品目を選択してください。" });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const res = await saveFirstArticleAction({ itemKey: selected.key, weight });
      setMessage({ ok: res.ok, text: res.message ?? "" });
      if (res.ok) {
        setWeight("");
        setSelected(null);
        router.refresh();
      }
    });
  }

  function approve(h: FirstArticle) {
    startTransition(async () => {
      const res = await approveFirstArticleAction(h.measuredOn, h.itemKey);
      if (!res.ok) alert(res.message);
      router.refresh();
    });
  }

  function reject(h: FirstArticle) {
    const comment = prompt("差し戻しの理由（測定者に表示されます）");
    if (comment === null) return;
    startTransition(async () => {
      const res = await rejectFirstArticleAction(h.measuredOn, h.itemKey, comment);
      if (!res.ok) alert(res.message);
      router.refresh();
    });
  }

  function remove(h: FirstArticle) {
    if (!confirm(`${h.measuredOn} ${h.itemKey} の測定記録を削除しますか?`)) return;
    startTransition(async () => {
      const res = await deleteFirstArticleAction(h.measuredOn, h.itemKey);
      if (!res.ok) alert(res.message);
      router.refresh();
    });
  }

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* 【1】工場を選ぶ */}
      <Step n={1} title="工場を選ぶ" hint="選んだ工場の品目・測定履歴だけを扱います。">
        {factoryLocked ? (
          <span className="flex h-11 w-full items-center rounded-lg border border-[#e5e5e5] bg-[#f7f7f5] px-3 text-sm text-[#333333] sm:h-10 sm:w-64">
            {factory || "（所属工場が未設定です）"}
          </span>
        ) : factoryOptions.length === 0 ? (
          <p className="rounded-lg bg-[#fff3e0] px-3 py-2 text-sm text-[#a15c00]">
            工場が登録されていません。管理者にポータルの工場マスタ配信を依頼してください。
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {factoryOptions.map((f) => (
              <button
                key={f}
                onClick={() => moveToFactory(f)}
                className={`h-12 rounded-xl px-4 text-sm font-semibold sm:h-11 ${
                  f === factory
                    ? "bg-[#b4632c] text-white"
                    : "border border-[#e5e5e5] bg-white text-[#555555] hover:bg-[#f7f7f5]"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        )}
      </Step>

      {/* 【2】品目QRを読み取る */}
      <Step
        n={2}
        title="品目QRを読み取る"
        hint="QR一覧は品目マスターの「品目QR一覧」から印刷できます（QRの値＝品目KEY）。"
      >
        {selected ? (
          <div className="mb-3 flex items-start justify-between gap-2 rounded-xl border border-[#b4632c] bg-[#faf6ef] px-3 py-2.5">
            <span className="flex min-w-0 items-start gap-2 text-sm font-bold text-[#b4632c]">
              <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" />
              <span className="min-w-0">
                <span className="block truncate">{selected.hinmei || selected.key}</span>
                <span className="block font-mono text-xs font-normal text-[#96521f]">
                  {selected.key} ／ {selected.seizoBashoMei || selected.kubun}
                </span>
                <span className="block text-xs font-normal text-[#96521f]">
                  理論完成重量 {fmt(selected.kanseiJuryo, 6)} kg
                </span>
              </span>
            </span>
            <button
              onClick={() => setSelected(null)}
              className="shrink-0 rounded-lg px-2 py-1 text-xs text-[#96521f] underline"
            >
              変更
            </button>
          </div>
        ) : (
          <p className="mb-3 rounded-lg bg-[#f7f7f5] px-3 py-2 text-sm text-[#707070]">
            品目が未選択です。
          </p>
        )}

        <button
          onClick={openCameraScan}
          className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#333333] text-base font-semibold text-white hover:bg-[#111111] sm:h-11 sm:w-auto sm:px-5 sm:text-sm"
        >
          <Camera className="h-5 w-5" />
          カメラでQRを読み取る
        </button>

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
            placeholder="品目QRを読み取り（スキャナ/手入力→Enter）"
            className={`${input} w-full pl-9 sm:w-96`}
          />
        </div>
      </Step>

      {/* 【3】実測重量を入力して申請 */}
      <Step n={3} title="実測重量を入力して申請" hint="測定日・測定者は自動で記録されます。">
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1 text-xs text-[#707070]">
            測定日（自動）
            <span className="flex h-11 items-center rounded-lg border border-[#e5e5e5] bg-[#f7f7f5] px-3 text-sm tabular-nums sm:h-10">
              {todayStr()}
            </span>
          </div>
          <div className="flex flex-col gap-1 text-xs text-[#707070]">
            測定者（自動）
            <span className="flex h-11 items-center truncate rounded-lg border border-[#e5e5e5] bg-[#f7f7f5] px-3 text-sm sm:h-10">
              {userName}
            </span>
          </div>
        </div>
        <label className="flex flex-col gap-1 text-xs text-[#707070]">
          実測完成品重量(kg/個)
          <input
            type="number"
            inputMode="decimal"
            step="0.000001"
            min="0"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            className={`${input} w-full text-right tabular-nums sm:w-48`}
          />
        </label>
        <button
          onClick={save}
          disabled={pending}
          className="mt-3 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#b4632c] text-base font-semibold text-white hover:bg-[#96521f] disabled:opacity-50 sm:h-11 sm:w-auto sm:px-6 sm:text-sm"
        >
          <Save className="h-5 w-5" />
          {pending ? "登録中…" : "登録して管理者へ申請"}
        </button>
        {message && (
          <p className={`mt-2 text-sm ${message.ok ? "text-[#2f6b2f]" : "text-[#dc000c]"}`}>
            {message.text}
          </p>
        )}
      </Step>

      {/* 測定履歴（承認状況つき） */}
      <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <h2 className="mb-1 text-base font-bold text-[#333333] sm:text-sm">
          測定履歴{factory ? `（${factory}）` : ""}
        </h2>
        <p className="mb-3 text-xs text-[#909090]">
          {otherCount > 0
            ? `他の工場（または工場未設定）の品目の測定記録が ${otherCount} 件あります。工場を切り替えると表示されます。`
            : "選択中の工場の品目の測定記録を表示しています。"}
        </p>

        {/* モバイル: カード */}
        <ul className="space-y-2 sm:hidden">
          {history.length === 0 && (
            <li className="rounded-xl bg-[#f7f7f5] px-3 py-3 text-sm text-[#707070]">
              測定記録がありません
            </li>
          )}
          {history.map((h) => (
            <li key={`c-${h.measuredOn}|${h.itemKey}`} className="rounded-xl border border-[#e5e5e5] p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold tabular-nums">{h.measuredOn}</span>
                    <StatusTag h={h} />
                  </div>
                  <div className="mt-0.5 truncate text-sm text-[#555555]">
                    {h.hinmei ?? "（マスター未登録）"}
                  </div>
                  <div className="truncate font-mono text-xs text-[#909090]">{h.itemKey}</div>
                  <div className="mt-0.5 text-xs text-[#909090]">
                    測定者 {h.sokuteisha} ／ 理論 {fmt(h.kanseiJuryo, 6)}
                  </div>
                </div>
                <span className="shrink-0 text-right text-lg font-bold tabular-nums">
                  {fmt(h.weight, 6)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {isAdmin && h.status === "pending" && (
                  <>
                    <button
                      onClick={() => approve(h)}
                      disabled={pending}
                      className="inline-flex h-9 items-center gap-1 rounded-lg bg-[#2f6b2f] px-3 text-xs font-semibold text-white disabled:opacity-50"
                    >
                      <Stamp className="h-3.5 w-3.5" />
                      承認
                    </button>
                    <button
                      onClick={() => reject(h)}
                      disabled={pending}
                      className="inline-flex h-9 items-center gap-1 rounded-lg border border-[#dc000c] px-3 text-xs font-semibold text-[#dc000c] disabled:opacity-50"
                    >
                      <Undo2 className="h-3.5 w-3.5" />
                      差し戻し
                    </button>
                  </>
                )}
                <button
                  onClick={() => remove(h)}
                  className="inline-flex h-9 items-center gap-1 rounded-lg border border-[#e5e5e5] px-3 text-xs text-[#dc000c]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  削除
                </button>
              </div>
            </li>
          ))}
        </ul>

        {/* PC: 表 */}
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>測定日</th>
                <th className={th}>KEY</th>
                <th className={th}>品名</th>
                <th className={`${th} text-right`}>実測完成重量(kg)</th>
                <th className={`${th} text-right`}>理論値(kg)</th>
                <th className={`${th} text-right`}>差</th>
                <th className={th}>測定者</th>
                <th className={th}>状態</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr>
                  <td className={td} colSpan={9}>
                    測定記録がありません
                  </td>
                </tr>
              )}
              {history.map((h) => {
                const diff =
                  h.kanseiJuryo !== null && h.kanseiJuryo !== 0 ? h.weight - h.kanseiJuryo : null;
                return (
                  <tr key={`${h.measuredOn}|${h.itemKey}`}>
                    <td className={td}>{h.measuredOn}</td>
                    <td className={td}>{h.itemKey}</td>
                    <td className={td}>{h.hinmei ?? "（マスター未登録）"}</td>
                    <td className={tdNum}>{fmt(h.weight, 6)}</td>
                    <td className={tdNum}>{fmt(h.kanseiJuryo, 6)}</td>
                    <td
                      className={`${tdNum} ${diff !== null && diff < 0 ? "text-[#dc000c]" : diff !== null && diff > 0 ? "text-[#2f6b2f]" : ""}`}
                    >
                      {fmt(diff, 6)}
                    </td>
                    <td className={td}>{h.sokuteisha}</td>
                    <td className={td}>
                      <StatusTag h={h} />
                      {h.status === "approved" && h.approvedBy && (
                        <span className="ml-1 text-xs text-[#707070]">{h.approvedBy}</span>
                      )}
                    </td>
                    <td className={td}>
                      <div className="flex items-center gap-1">
                        {isAdmin && h.status === "pending" && (
                          <>
                            <button
                              onClick={() => approve(h)}
                              disabled={pending}
                              className="inline-flex items-center gap-1 rounded-lg bg-[#2f6b2f] px-2 py-1 text-xs font-semibold text-white hover:bg-[#255525] disabled:opacity-50"
                            >
                              <Stamp className="h-3.5 w-3.5" />
                              承認
                            </button>
                            <button
                              onClick={() => reject(h)}
                              disabled={pending}
                              className="inline-flex items-center gap-1 rounded-lg border border-[#dc000c] px-2 py-1 text-xs font-semibold text-[#dc000c] hover:bg-[#fdecea] disabled:opacity-50"
                            >
                              <Undo2 className="h-3.5 w-3.5" />
                              差し戻し
                            </button>
                          </>
                        )}
                        <button
                          onClick={() => remove(h)}
                          className="rounded p-1 text-[#dc000c] hover:bg-[#fdecea]"
                          aria-label="削除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* カメラ読み取りモーダル */}
      {scanOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-bold text-[#333333]">品目QRコードを読み取り</h3>
              <button
                onClick={() => void closeCameraScan()}
                className="rounded p-1.5 text-[#555555] hover:bg-[#f0f0ee]"
                aria-label="閉じる"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div id="item-qr-reader" className="overflow-hidden rounded-lg" />
          </div>
        </div>
      )}
    </div>
  );
}
