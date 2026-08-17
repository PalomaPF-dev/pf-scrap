"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plus, Save, X } from "lucide-react";
import { saveDailyRecordAction } from "@/lib/actions";
import type { DailyEntry, DailyRecord } from "@/lib/db";
import { fmt, fmtPct, toNum } from "@/lib/format";

const BUSHO_OPTIONS = ["内胴", "プレス", "加工"];
const KOTEI_OPTIONS = ["切断", "プレス", "曲げ", "溶接", "その他"];
const HINSHU_OPTIONS = ["銅条", "銅管", "その他"];

type EntryDraft = DailyEntry & { weightStr: string };

const emptyEntry = (): EntryDraft => ({
  jikoku: "",
  busho: "",
  kikai: "",
  hinshu: "銅条",
  kotei: "",
  weight: 0,
  weightStr: "",
  kirokusha: "",
  ijo: "",
});

const toDraft = (e: DailyEntry): EntryDraft => ({ ...e, weightStr: e.weight ? String(e.weight) : "" });

const input =
  "rounded-lg border border-[#e5e5e5] bg-white px-2 py-1.5 text-sm focus:border-[#b4632c] focus:outline-none";

/** 日次記録票の入力フォーム（紙の様式と同じ【1】〜【4】の構成）。 */
export default function DailyRecordForm({
  date,
  factory,
  factoryOptions,
  factoryLocked,
  initial,
  userName,
}: {
  date: string;
  factory: string;
  factoryOptions: string[];
  /** 所属工場ユーザーは工場を変更できない */
  factoryLocked: boolean;
  initial: DailyRecord | null;
  userName: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [sekininsha, setSekininsha] = useState(initial?.sekininsha ?? "");
  const [zenjitsuOk, setZenjitsuOk] = useState(initial?.zenjitsuOk ?? false);
  const [hakoZanryo, setHakoZanryo] = useState(initial ? String(initial.hakoZanryo) : "0");
  const [entries, setEntries] = useState<EntryDraft[]>(
    initial?.entries.length ? initial.entries.map(toDraft) : [emptyEntry(), emptyEntry(), emptyEntry()]
  );
  const [kaishu, setKaishu] = useState(
    initial?.kaishuSokuteichi !== null && initial?.kaishuSokuteichi !== undefined
      ? String(initial.kaishuSokuteichi)
      : ""
  );
  const [tonyuKanryo, setTonyuKanryo] = useState(initial?.tonyuKanryo ?? false);
  const [shonin, setShonin] = useState(initial?.shonin ?? "");
  const [biko, setBiko] = useState(initial?.biko ?? "");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const total = useMemo(
    () => entries.reduce((t, e) => t + toNum(e.weightStr), 0),
    [entries]
  );
  const sairitsu = kaishu !== "" && total > 0 ? (toNum(kaishu) - total) / total : null;

  function moveTo(next: { date?: string; factory?: string }) {
    const q = new URLSearchParams(searchParams.toString());
    if (next.date) q.set("date", next.date);
    if (next.factory) q.set("factory", next.factory);
    router.push(`${pathname}?${q.toString()}`);
  }

  function setEntry(i: number, patch: Partial<EntryDraft>) {
    setEntries((prev) => prev.map((e, j) => (j === i ? { ...e, ...patch } : e)));
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      const res = await saveDailyRecordAction({
        recordDate: date,
        factory,
        sekininsha,
        zenjitsuOk,
        hakoZanryo,
        kaishuSokuteichi: kaishu,
        tonyuKanryo,
        shonin,
        biko,
        entries: entries.map((e) => ({ ...e, weight: toNum(e.weightStr) })),
      });
      setMessage({ ok: res.ok, text: res.message ?? (res.ok ? "保存しました。" : "保存に失敗しました。") });
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* 対象の日付・工場・責任者 */}
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
            />
          </label>
          <button
            onClick={save}
            disabled={pending}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[#b4632c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#96521f] disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {pending ? "保存中…" : "保存"}
          </button>
        </div>
        {message && (
          <p className={`mt-2 text-sm ${message.ok ? "text-[#2f6b2f]" : "text-[#dc000c]"}`}>{message.text}</p>
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
            />
            <span className="text-xs text-[#909090]">0=空</span>
          </label>
        </div>
      </section>

      {/* 【2】日中記録 */}
      <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-bold text-[#333333]">【2】日中記録（スクラップ発生のたびに記入）</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                {["時刻", "部署", "機械", "品種", "工程", "重量(kg)", "記録者", "異常", ""].map((h) => (
                  <th
                    key={h}
                    className="border border-[#e5e5e5] bg-[#f0f0ee] px-2 py-1.5 text-left font-semibold whitespace-nowrap"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {entries.map((e, i) => (
                <tr key={i}>
                  <td className="border border-[#e5e5e5] p-1">
                    <input
                      type="time"
                      value={e.jikoku}
                      onChange={(ev) => setEntry(i, { jikoku: ev.target.value })}
                      className={input}
                    />
                  </td>
                  <td className="border border-[#e5e5e5] p-1">
                    <select
                      value={e.busho}
                      onChange={(ev) => setEntry(i, { busho: ev.target.value })}
                      className={input}
                    >
                      <option value=""></option>
                      {BUSHO_OPTIONS.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  </td>
                  <td className="border border-[#e5e5e5] p-1">
                    <input
                      value={e.kikai}
                      onChange={(ev) => setEntry(i, { kikai: ev.target.value })}
                      className={`${input} w-24`}
                    />
                  </td>
                  <td className="border border-[#e5e5e5] p-1">
                    <select
                      value={e.hinshu}
                      onChange={(ev) => setEntry(i, { hinshu: ev.target.value })}
                      className={input}
                    >
                      {HINSHU_OPTIONS.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  </td>
                  <td className="border border-[#e5e5e5] p-1">
                    <select
                      value={e.kotei}
                      onChange={(ev) => setEntry(i, { kotei: ev.target.value })}
                      className={input}
                    >
                      <option value=""></option>
                      {KOTEI_OPTIONS.map((o) => (
                        <option key={o}>{o}</option>
                      ))}
                    </select>
                  </td>
                  <td className="border border-[#e5e5e5] p-1">
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      value={e.weightStr}
                      onChange={(ev) => setEntry(i, { weightStr: ev.target.value })}
                      className={`${input} w-24 text-right`}
                    />
                  </td>
                  <td className="border border-[#e5e5e5] p-1">
                    <input
                      value={e.kirokusha}
                      onChange={(ev) => setEntry(i, { kirokusha: ev.target.value })}
                      className={`${input} w-20`}
                    />
                  </td>
                  <td className="border border-[#e5e5e5] p-1">
                    <input
                      value={e.ijo}
                      onChange={(ev) => setEntry(i, { ijo: ev.target.value })}
                      className={`${input} w-28`}
                      placeholder=""
                    />
                  </td>
                  <td className="border border-[#e5e5e5] p-1 text-center">
                    <button
                      onClick={() => setEntries((prev) => prev.filter((_, j) => j !== i))}
                      className="rounded p-1 text-[#dc000c] hover:bg-[#fdecea]"
                      aria-label="行を削除"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button
          onClick={() => setEntries((prev) => [...prev, emptyEntry()])}
          className="mt-2 inline-flex items-center gap-1 rounded-lg border border-[#e5e5e5] px-3 py-1.5 text-sm text-[#555555] hover:bg-[#f7f7f5]"
        >
          <Plus className="h-4 w-4" />
          行を追加
        </button>
      </section>

      {/* 【3】終礼集計 */}
      <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-bold text-[#333333]">【3】終礼集計</h2>
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
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-6 text-sm">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={tonyuKanryo}
              onChange={(e) => setTonyuKanryo(e.target.checked)}
              className="h-4 w-4 accent-[#b4632c]"
            />
            当日スクラップを全量、指定箱に投入した
          </label>
          <label className="flex items-center gap-2">
            責任者承認（サイン）
            <input
              type="text"
              value={shonin}
              onChange={(e) => setShonin(e.target.value)}
              className={`${input} w-32`}
            />
          </label>
        </div>
      </section>

      {/* 【4】備考 */}
      <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-bold text-[#333333]">【4】備考（異常事項・気付き等）</h2>
        <textarea
          rows={3}
          value={biko}
          onChange={(e) => setBiko(e.target.value)}
          className={`${input} w-full`}
        />
        <p className="mt-2 text-xs text-[#909090]">
          ※ 記録保管期間：日次記録3年 / 月次集計5年。月間集計はCSV出力して品管・経営層へ報告。
        </p>
      </section>
    </div>
  );
}
