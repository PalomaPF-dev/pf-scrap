"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Send, Trash2 } from "lucide-react";
import {
  createShipmentAction,
  deleteShipmentAction,
  updateShipmentAction,
} from "@/lib/actions";
import { shipmentGap, shipmentGapLarge, shipmentPair, type Shipment } from "@/lib/scrapTypes";
import { fmt, toNumOrNull } from "@/lib/format";
import ScaleCamera from "./ScaleCamera";
import { ResultBanner, type PanelMessage } from "./ScrapBagPanel";

const input =
  "h-11 w-full min-w-0 rounded-lg border border-[#e5e5e5] bg-white px-3 text-base focus:border-[#b4632c] focus:outline-none sm:h-10 sm:text-sm";
const td = "border border-[#e5e5e5] px-2 py-1.5 whitespace-nowrap";
const tdNum = `${td} text-right tabular-nums`;
const th = "border border-[#e5e5e5] bg-[#f0f0ee] px-2 py-1.5 text-left font-semibold whitespace-nowrap";

/** YYYY-MM-DD どうしの日数差 */
function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
}

/**
 * ポリ箱の出荷登録（送る側）と、出荷・処理の突き合わせ一覧。
 * 受け入れ側の処理は日次記録で行う（スクラップ箱へ投入するときにポリ箱を選ぶ）。
 */
export default function ShipmentPanel({
  factory,
  shipTo,
  receivesFrom,
  kinds,
  shipments,
  ym,
  today,
  isAdmin,
  myFactory,
}: {
  /** 選んでいる工場。空＝すべて */
  factory: string;
  /** 選んでいる工場の送り先。送る工場でなければ null */
  shipTo: string | null;
  /** 選んでいる工場へ送ってくる工場 */
  receivesFrom: string[];
  kinds: string[];
  shipments: Shipment[];
  ym: string;
  today: string;
  isAdmin: boolean;
  /** ログインユーザーの所属工場（所属が無ければ null＝どの工場の箱も直せる） */
  myFactory: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [hinshu, setHinshu] = useState(kinds[0] ?? "");
  // 出荷重量はポリ箱ごと量った重さ。ポリ箱の重さは受け入れ側が、空けたあとに量る。
  const [gross, setGross] = useState("");
  const grossN = toNumOrNull(gross);
  const [shipDate, setShipDate] = useState(today);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<PanelMessage | null>(null);
  const [boxNo, setBoxNo] = useState<string | null>(null);
  const [listMsg, setListMsg] = useState<PanelMessage | null>(null);

  function ship() {
    setMessage(null);
    setBoxNo(null);
    startTransition(async () => {
      const res = await createShipmentAction({
        factory,
        shipDate,
        hinshu,
        grossWeight: gross,
        note,
      });
      if (res.ok) {
        setBoxNo(res.boxNo ?? null);
        setMessage({ ok: true, title: "出荷を登録しました", text: res.message ?? "" });
        setGross("");
        setNote("");
        router.refresh();
      } else {
        setMessage({ ok: false, title: "登録できませんでした", text: res.message });
      }
    });
  }

  /** 重量計の写真読取の結果を、指定した欄に入れる。 */
  function onRead(label: string, set: (v: string) => void) {
    return (r: { value: number | null; note?: string }) => {
      if (r.value === null) {
        const n = r.note?.trim();
        setMessage({
          ok: false,
          title: "読み取れませんでした",
          text: n && n.includes("手入力") ? n : [n, "もう一度撮るか、手入力してください。"].filter(Boolean).join(" "),
        });
        return;
      }
      set(String(r.value));
      setMessage({ ok: true, title: `${label} ${fmt(r.value)} kg を読み取りました`, text: "値を確かめてください。" });
    };
  }

  const canEdit = (sh: Shipment) =>
    !sh.received && (isAdmin || myFactory === null || myFactory === sh.fromFactory);

  function edit(sh: Shipment) {
    const run = (patch: { grossWeight?: string; tareWeight?: string; weight?: string }) =>
      startTransition(async () => {
        const res = await updateShipmentAction({ id: sh.id, hinshu: sh.hinshu, note: sh.note, ...patch });
        setListMsg({ ok: res.ok, text: res.message ?? "" });
        if (res.ok) router.refresh();
      });
    if (sh.grossWeight !== null && sh.tareWeight !== null) {
      // 試行版の登録分（送る側でポリ箱も量っていた）
      const g = prompt(`ポリ箱「${sh.boxNo}」の総重量 kg（ポリ箱込み）`, String(sh.grossWeight));
      if (g === null) return;
      const t = prompt(`ポリ箱「${sh.boxNo}」のポリ箱の重さ kg`, String(sh.tareWeight));
      if (t === null) return;
      run({ grossWeight: g, tareWeight: t });
    } else if (sh.grossWeight !== null) {
      const g = prompt(`ポリ箱「${sh.boxNo}」の出荷重量 kg（ポリ箱込み・${sh.hinshu}）`, String(sh.grossWeight));
      if (g === null) return;
      run({ grossWeight: g });
    } else {
      const v = prompt(`ポリ箱「${sh.boxNo}」の重量 kg（${sh.hinshu}）`, String(sh.weight));
      if (v === null) return;
      run({ weight: v });
    }
  }

  function remove(sh: Shipment) {
    if (!confirm(`ポリ箱「${sh.boxNo}」（${sh.hinshu} ${sh.weight} kg）の出荷を取り消しますか?`)) return;
    startTransition(async () => {
      const res = await deleteShipmentAction(sh.id);
      setListMsg({ ok: res.ok, text: res.message ?? "" });
      if (res.ok) router.refresh();
    });
  }

  // 月の集計。未処理は月に関係なく一覧に入ってくるので、出荷・処理は月で数える。
  const sum = useMemo(() => {
    const shipped = shipments.filter((sh) => sh.shipDate.startsWith(ym));
    const done = shipments.filter((sh) => sh.received?.date.startsWith(ym));
    const open = shipments.filter((sh) => !sh.received);
    const late = open.filter((sh) => daysBetween(sh.shipDate, today) >= 2);
    const large = done.filter(shipmentGapLarge);
    return {
      shippedN: shipped.length,
      shippedKg: shipped.reduce((t, sh) => t + sh.weight, 0),
      doneN: done.length,
      // 突き合わせる重さどうしで足す（ポリ箱込みの出荷 ↔ 投入重量＋ポリ箱）
      doneShipKg: done.reduce((t, sh) => t + (shipmentPair(sh)?.sent ?? 0), 0),
      doneRecvKg: done.reduce((t, sh) => t + (shipmentPair(sh)?.received ?? 0), 0),
      openN: open.length,
      openKg: open.reduce((t, sh) => t + sh.weight, 0),
      lateN: late.length,
      largeN: large.length,
    };
  }, [shipments, ym, today]);

  return (
    <div className="space-y-4">
      {/* 出荷の登録（送る側） */}
      {shipTo ? (
        <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
          <h2 className="mb-1 text-base font-bold text-[#333333]">
            ポリ箱を出荷する（{factory} → {shipTo}）
          </h2>
          <p className="mb-3 text-xs text-[#707070]">
            ポリ箱は種類ごとに分け、1箱ずつ量って登録してください。登録すると箱に書く番号が出ます。
          </p>

          <div className="space-y-3">
            <div>
              <span className="mb-1 block text-xs font-bold text-[#707070]">スクラップの種類</span>
              <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="スクラップの種類">
                {kinds.map((k) => (
                  <button
                    key={k}
                    type="button"
                    role="radio"
                    aria-checked={hinshu === k}
                    onClick={() => setHinshu(k)}
                    className={`h-11 rounded-xl border-2 px-4 text-base font-semibold sm:h-10 sm:text-sm ${
                      hinshu === k
                        ? "border-[#b4632c] bg-[#faf6ef] text-[#b4632c]"
                        : "border-[#e5e5e5] bg-white text-[#555555]"
                    }`}
                  >
                    {k}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
              <label className="flex min-w-0 flex-col gap-1 text-xs font-bold text-[#707070]">
                出荷重量 kg（スクラップを入れたポリ箱ごと量る）
                <input
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0"
                  value={gross}
                  onChange={(e) => setGross(e.target.value)}
                  aria-label="出荷重量 kg（ポリ箱込み）"
                  className={`${input} text-right tabular-nums`}
                />
              </label>
              <ScaleCamera
                phase="before"
                recordDate={shipDate}
                factory={factory}
                needQr={false}
                label="重量計を撮って読み取る"
                disabled={pending}
                onResult={onRead("出荷重量", setGross)}
                onError={(text) => setMessage({ ok: false, text })}
              />
            </div>
            <p className="-mt-1 text-xs text-[#909090]">
              ポリ箱の重さは量らなくて構いません。受け入れ側でスクラップを空けたあとに量り、
              「投入したスクラップ ＋ ポリ箱 ＝ この出荷重量」で突き合わせます。
            </p>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex min-w-0 flex-col gap-1 text-xs font-bold text-[#707070]">
                出荷日
                <input
                  type="date"
                  value={shipDate}
                  max={today}
                  onChange={(e) => setShipDate(e.target.value)}
                  aria-label="出荷日"
                  className={input}
                />
              </label>
              <label className="flex min-w-0 flex-col gap-1 text-xs font-bold text-[#707070]">
                メモ（任意）
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  maxLength={200}
                  aria-label="メモ"
                  className={input}
                />
              </label>
            </div>

            <button
              type="button"
              onClick={ship}
              disabled={pending || grossN === null || grossN <= 0 || !hinshu}
              className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[#b4632c] text-base font-bold text-white hover:bg-[#9a5424] disabled:opacity-50 sm:w-auto sm:px-6"
            >
              <Send className="h-5 w-5" />
              {pending ? "登録中…" : "出荷を登録して番号を出す"}
            </button>

            {boxNo && (
              <div className="rounded-2xl border-4 border-[#b4632c] bg-[#faf6ef] px-4 py-4 text-center">
                <p className="text-sm font-bold text-[#707070]">ポリ箱に書く番号</p>
                <p className="mt-1 break-all text-3xl font-extrabold tracking-wide text-[#b4632c] sm:text-4xl">
                  {boxNo}
                </p>
              </div>
            )}
            {message && <ResultBanner msg={message} />}
          </div>
        </section>
      ) : factory ? (
        receivesFrom.length > 0 ? (
          <p className="rounded-xl bg-[#f7f7f5] px-4 py-3 text-sm text-[#555555]">
            {factory} は {receivesFrom.join("・")} からポリ箱を受け入れます。届いたポリ箱は
            <strong>日次記録</strong>で、スクラップ箱へ投入するときに「他工場から届いたポリ箱」を選んで記録してください。
          </p>
        ) : null
      ) : (
        <p className="rounded-xl bg-[#f7f7f5] px-4 py-3 text-sm text-[#555555]">
          出荷を登録するには、上の「工場」で送る側の工場を選んでください。
        </p>
      )}

      {/* 月の集計 */}
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <Stat label="この月の出荷" value={`${sum.shippedN} 箱`} sub={`${fmt(sum.shippedKg)} kg`} />
        <Stat
          label="この月に処理"
          value={`${sum.doneN} 箱`}
          sub={`出荷 ${fmt(sum.doneShipKg)} kg → 受入 ${fmt(sum.doneRecvKg)} kg`}
        />
        <Stat
          label="未処理（全期間）"
          value={`${sum.openN} 箱`}
          sub={sum.lateN > 0 ? `うち2日以上前の出荷 ${sum.lateN} 箱` : `${fmt(sum.openKg)} kg`}
          warn={sum.lateN > 0}
        />
        <Stat
          label="重量差が要確認"
          value={`${sum.largeN} 箱`}
          sub="1kg超かつ3%超の差"
          warn={sum.largeN > 0}
        />
      </section>

      {/* 一覧 */}
      <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <h2 className="mb-1 text-base font-bold text-[#333333] sm:text-sm">ポリ箱の一覧</h2>
        <p className="mb-3 text-xs text-[#909090]">
          この月に出荷・処理したポリ箱と、まだ処理していないポリ箱（月に関係なく先頭）を表示しています。
          出荷重量は送った工場でポリ箱ごと量った重さ、受入計は「投入したスクラップ ＋ 空けたあとのポリ箱」、差は「受入計 − 出荷重量」です。
        </p>
        {listMsg && <ResultBanner msg={listMsg} className="mb-3" />}

        {/* モバイル: カード */}
        <ul className="space-y-2 sm:hidden">
          {shipments.length === 0 && (
            <li className="rounded-xl bg-[#f7f7f5] px-3 py-3 text-sm text-[#707070]">ポリ箱はありません</li>
          )}
          {shipments.map((sh) => {
            const gap = shipmentGap(sh);
            const large = shipmentGapLarge(sh);
            const p = shipmentPair(sh);
            return (
              <li key={sh.id} className="rounded-xl border border-[#e5e5e5] p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-mono text-sm font-bold">{sh.boxNo}</div>
                    <div className="text-xs text-[#707070]">
                      {sh.shipDate} 出荷 ／ {sh.fromFactory} → {sh.toFactory} ／ {sh.hinshu}
                    </div>
                  </div>
                  <StatusTag sh={sh} today={today} />
                </div>
                <div className="mt-1 text-sm tabular-nums">
                  出荷 {fmt(p?.sent ?? sh.grossWeight ?? sh.weight)} kg
                  {sh.grossWeight !== null && sh.tareWeight === null && (
                    <span className="text-xs text-[#909090]">（ポリ箱込み）</span>
                  )}
                  {sh.received && p && (
                    <>
                      {" → "}受入 {fmt(p.received)} kg
                      {p.withBox && (
                        <span className="text-xs text-[#909090]">
                          （スクラップ {fmt(sh.received.weight)} ＋ ポリ箱 {fmt(sh.received.polyTare)}）
                        </span>
                      )}
                      <span className={`ml-1 font-bold ${large ? "text-[#dc000c]" : "text-[#555555]"}`}>
                        （差 {gap !== null && gap > 0 ? "+" : ""}
                        {fmt(gap)}）
                      </span>
                    </>
                  )}
                </div>
                {sh.received && (
                  <div className="text-xs text-[#909090]">
                    {sh.received.date} 処理 ／ {sh.received.scaleName}
                  </div>
                )}
                {canEdit(sh) && (
                  <div className="mt-2 flex gap-2">
                    <button
                      onClick={() => edit(sh)}
                      disabled={pending}
                      className="inline-flex h-9 items-center gap-1 rounded-lg border border-[#e5e5e5] px-3 text-xs"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      重量を直す
                    </button>
                    <button
                      onClick={() => remove(sh)}
                      disabled={pending}
                      className="inline-flex h-9 items-center gap-1 rounded-lg border border-[#e5e5e5] px-3 text-xs text-[#dc000c]"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      取消
                    </button>
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
                <th className={th}>ポリ箱番号</th>
                <th className={th}>出荷日</th>
                <th className={th}>送り元 → 送り先</th>
                <th className={th}>種類</th>
                <th className={`${th} text-right`}>出荷重量(kg)</th>
                <th className={th}>処理日</th>
                <th className={`${th} text-right`}>投入重量(kg)</th>
                <th className={`${th} text-right`}>ポリ箱(kg)</th>
                <th className={`${th} text-right`}>受入計(kg)</th>
                <th className={`${th} text-right`}>差</th>
                <th className={th}>状態</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {shipments.length === 0 && (
                <tr>
                  <td className={td} colSpan={12}>
                    ポリ箱はありません
                  </td>
                </tr>
              )}
              {shipments.map((sh) => {
                const gap = shipmentGap(sh);
                const large = shipmentGapLarge(sh);
                const p = shipmentPair(sh);
                return (
                  <tr key={sh.id}>
                    <td className={`${td} font-mono`}>{sh.boxNo}</td>
                    <td className={td}>{sh.shipDate}</td>
                    <td className={td}>
                      {sh.fromFactory} → {sh.toFactory}
                    </td>
                    <td className={td}>{sh.hinshu}</td>
                    <td className={`${tdNum} font-semibold`}>{fmt(p?.sent ?? sh.grossWeight ?? sh.weight)}</td>
                    <td className={td}>{sh.received?.date ?? ""}</td>
                    <td className={tdNum}>{sh.received ? fmt(sh.received.weight) : ""}</td>
                    <td className={`${tdNum} text-[#909090]`}>
                      {sh.received?.polyTare !== null && sh.received?.polyTare !== undefined ? fmt(sh.received.polyTare) : ""}
                    </td>
                    <td className={`${tdNum} font-semibold`}>{p ? fmt(p.received) : ""}</td>
                    <td className={`${tdNum} ${large ? "bg-[#fdecea] font-bold text-[#dc000c]" : ""}`}>
                      {gap === null ? "" : `${gap > 0 ? "+" : ""}${fmt(gap)}`}
                    </td>
                    <td className={td}>
                      <StatusTag sh={sh} today={today} />
                    </td>
                    <td className={td}>
                      {canEdit(sh) && (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => edit(sh)}
                            disabled={pending}
                            className="rounded p-1 text-[#555555] hover:bg-[#f0f0ee]"
                            aria-label="重量を直す"
                            title="重量を直す"
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => remove(sh)}
                            disabled={pending}
                            className="rounded p-1 text-[#dc000c] hover:bg-[#fdecea]"
                            aria-label="取消"
                            title="出荷を取り消す"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Stat({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div
      className={`rounded-2xl border p-3 sm:p-4 ${warn ? "border-[#dc000c] bg-[#fdecea]" : "border-[#e5e5e5] bg-white"}`}
    >
      <div className="text-xs text-[#707070]">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${warn ? "text-[#dc000c]" : "text-[#333333]"}`}>{value}</div>
      <div className={`text-xs ${warn ? "text-[#b00010]" : "text-[#909090]"}`}>{sub}</div>
    </div>
  );
}

function StatusTag({ sh, today }: { sh: Shipment; today: string }) {
  if (sh.received) {
    return shipmentGapLarge(sh) ? (
      <span className="rounded bg-[#fdecea] px-1.5 py-0.5 text-xs font-bold text-[#dc000c]">処理済・差を確認</span>
    ) : (
      <span className="rounded bg-[#eef4ee] px-1.5 py-0.5 text-xs font-bold text-[#2f6b2f]">処理済</span>
    );
  }
  const days = daysBetween(sh.shipDate, today);
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-xs font-bold ${
        days >= 2 ? "bg-[#fdecea] text-[#dc000c]" : "bg-[#fff3e0] text-[#a15c00]"
      }`}
    >
      未処理{days > 0 ? `（${days}日経過）` : ""}
    </span>
  );
}
