"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  "rounded-lg border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-sm focus:border-[#b4632c] focus:outline-none";

/** ③ 初品測定: 品目QR読み取り → 実測重量登録（＝管理者へ申請）→ 承認で計算に反映。 */
export default function FirstArticlePanel({
  candidates,
  latest,
  history,
  userName,
  isAdmin,
}: {
  candidates: ScrapItem[];
  latest: Record<string, { date: string; weight: number }>;
  history: FirstArticle[];
  userName: string;
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<ScrapItem | null>(null);
  const [qrInput, setQrInput] = useState("");
  const [scanOpen, setScanOpen] = useState(false);
  const scannerRef = useRef<{ stop: () => Promise<void>; clear: () => void } | null>(null);
  const [weight, setWeight] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function onQrCode(code: string) {
    const trimmed = code.trim();
    if (!trimmed) return;
    setQrInput("");
    startTransition(async () => {
      const item = await lookupItemByQrAction(trimmed);
      if (item) {
        setSelected(item);
        setMessage({ ok: true, text: `品目「${item.hinmei || item.key}」を選択しました。` });
      } else {
        setMessage({
          ok: false,
          text: `QRコード「${trimmed}」の品目が見つかりません。品目マスターの登録を管理者に確認してください。`,
        });
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
      setMessage({ ok: false, text: "品目を選択してください（QR読み取り or 一覧から選択）。" });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const res = await saveFirstArticleAction({ itemKey: selected.key, weight });
      setMessage({ ok: res.ok, text: res.message ?? "" });
      if (res.ok) {
        setWeight("");
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
    <div className="space-y-6">
      {/* 品目の選択（QR読み取り） */}
      <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <h2 className="mb-1 text-sm font-bold text-[#333333]">品目を選択（QRコード読み取り）</h2>
        <p className="mb-3 text-xs text-[#909090]">
          職場毎の品目QR一覧（管理者が品目マスターから印刷）を読み取るか、下の検索結果から選択します。
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
              placeholder="品目QRを読み取り（スキャナ/手入力→Enter）"
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
          {selected && (
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-[#faf6ef] px-3 py-1.5 text-sm font-semibold text-[#b4632c]">
              <CheckCircle2 className="h-4 w-4" />
              選択中: {selected.hinmei || selected.key}（{selected.seizoBashoMei || selected.kubun}）
            </span>
          )}
        </div>

        {/* 検索候補（QRが読めない場合のフォールバック） */}
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}></th>
                <th className={th}>KEY</th>
                <th className={th}>品名</th>
                <th className={th}>子図番</th>
                <th className={th}>職場（製造場所）</th>
                <th className={th}>区分</th>
                <th className={`${th} text-right`}>理論完成重量</th>
                <th className={`${th} text-right`}>最新実測（承認済み）</th>
              </tr>
            </thead>
            <tbody>
              {candidates.length === 0 && (
                <tr>
                  <td className={td} colSpan={8}>
                    該当する品目がありません。検索条件を変えるか、品目マスターへの登録を管理者に依頼してください。
                  </td>
                </tr>
              )}
              {candidates.map((it) => {
                const la = latest[it.key];
                const isSel = selected?.key === it.key;
                return (
                  <tr key={it.key} className={isSel ? "bg-[#faf6ef]" : "hover:bg-[#faf9f7]"}>
                    <td className={td}>
                      <button
                        onClick={() => setSelected(it)}
                        className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${
                          isSel
                            ? "bg-[#b4632c] text-white"
                            : "border border-[#e5e5e5] text-[#555555] hover:bg-[#f7f7f5]"
                        }`}
                      >
                        {isSel ? "選択中" : "選択"}
                      </button>
                    </td>
                    <td className={td}>{it.key}</td>
                    <td className={td}>{it.hinmei}</td>
                    <td className={td}>{it.koZuban}</td>
                    <td className={td}>{it.seizoBashoMei}</td>
                    <td className={td}>{it.kubun}</td>
                    <td className={tdNum}>{fmt(it.kanseiJuryo, 6)}</td>
                    <td className={tdNum}>{la ? `${fmt(la.weight, 6)}（${la.date}）` : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 登録フォーム（測定日・測定者は自動） */}
        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl bg-[#f7f7f5] p-3">
          <div className="text-sm">
            選択品目:{" "}
            <span className="font-semibold">
              {selected ? `${selected.key} ${selected.hinmei}` : "未選択"}
            </span>
          </div>
          <div className="flex flex-col gap-1 text-xs text-[#707070]">
            測定日（自動）
            <span className="rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-sm tabular-nums">
              {todayStr()}
            </span>
          </div>
          <div className="flex flex-col gap-1 text-xs text-[#707070]">
            測定者（自動）
            <span className="rounded-lg border border-[#e5e5e5] bg-white px-3 py-1.5 text-sm">
              {userName}
            </span>
          </div>
          <label className="flex flex-col gap-1 text-xs text-[#707070]">
            実測完成品重量(kg/個)
            <input
              type="number"
              step="0.000001"
              min="0"
              value={weight}
              onChange={(e) => setWeight(e.target.value)}
              className={`${input} w-36 text-right`}
            />
          </label>
          <button
            onClick={save}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#b4632c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#96521f] disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {pending ? "登録中…" : "登録して管理者へ申請"}
          </button>
          {message && (
            <span className={`text-sm ${message.ok ? "text-[#2f6b2f]" : "text-[#dc000c]"}`}>
              {message.text}
            </span>
          )}
        </div>
      </section>

      {/* 測定履歴（承認状況つき） */}
      <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-bold text-[#333333]">測定履歴</h2>
        <div className="overflow-x-auto">
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
