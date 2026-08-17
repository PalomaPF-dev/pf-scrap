"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Save, Trash2 } from "lucide-react";
import { deleteFirstArticleAction, saveFirstArticleAction } from "@/lib/actions";
import type { FirstArticle, ScrapItem } from "@/lib/db";
import { fmt, todayStr } from "@/lib/format";

const td = "border border-[#e5e5e5] px-2.5 py-1.5 whitespace-nowrap";
const tdNum = `${td} text-right tabular-nums`;
const th = "border border-[#e5e5e5] bg-[#f0f0ee] px-2.5 py-1.5 text-left font-semibold whitespace-nowrap";
const input =
  "rounded-lg border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-sm focus:border-[#b4632c] focus:outline-none";

/** ③ 初品測定の登録フォーム＋候補一覧＋測定履歴。 */
export default function FirstArticlePanel({
  candidates,
  latest,
  history,
  userName,
}: {
  candidates: ScrapItem[];
  latest: Record<string, { date: string; weight: number }>;
  history: FirstArticle[];
  userName: string;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<ScrapItem | null>(null);
  const [date, setDate] = useState(todayStr());
  const [weight, setWeight] = useState("");
  const [sokuteisha, setSokuteisha] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function save() {
    if (!selected) {
      setMessage({ ok: false, text: "品目を選択してください。" });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const res = await saveFirstArticleAction({
        measuredOn: date,
        itemKey: selected.key,
        weight,
        sokuteisha,
      });
      setMessage({ ok: res.ok, text: res.message ?? "" });
      if (res.ok) {
        setWeight("");
        router.refresh();
      }
    });
  }

  function remove(measuredOn: string, itemKey: string) {
    if (!confirm(`${measuredOn} ${itemKey} の測定記録を削除しますか?`)) return;
    startTransition(async () => {
      const res = await deleteFirstArticleAction(measuredOn, itemKey);
      if (!res.ok) alert(res.message);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      {/* 候補一覧（検索結果から選択） */}
      <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <h2 className="mb-3 text-sm font-bold text-[#333333]">品目を選択</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}></th>
                <th className={th}>KEY</th>
                <th className={th}>管理図番</th>
                <th className={th}>品名</th>
                <th className={th}>子図番</th>
                <th className={th}>区分</th>
                <th className={`${th} text-right`}>理論完成重量</th>
                <th className={`${th} text-right`}>最新実測</th>
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
                    <td className={td}>{it.kanriZuban}</td>
                    <td className={td}>{it.hinmei}</td>
                    <td className={td}>{it.koZuban}</td>
                    <td className={td}>{it.kubun}</td>
                    <td className={tdNum}>{fmt(it.kanseiJuryo, 6)}</td>
                    <td className={tdNum}>{la ? `${fmt(la.weight, 6)}（${la.date}）` : "-"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* 登録フォーム */}
        <div className="mt-4 flex flex-wrap items-end gap-3 rounded-xl bg-[#f7f7f5] p-3">
          <div className="text-sm">
            選択品目:{" "}
            <span className="font-semibold">
              {selected ? `${selected.key} ${selected.hinmei}` : "未選択"}
            </span>
          </div>
          <label className="flex flex-col gap-1 text-xs text-[#707070]">
            測定日
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={input} />
          </label>
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
          <label className="flex flex-col gap-1 text-xs text-[#707070]">
            測定者
            <input
              type="text"
              value={sokuteisha}
              onChange={(e) => setSokuteisha(e.target.value)}
              placeholder={userName}
              className={`${input} w-28`}
            />
          </label>
          <button
            onClick={save}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#b4632c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#96521f] disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {pending ? "登録中…" : "登録"}
          </button>
          {message && (
            <span className={`text-sm ${message.ok ? "text-[#2f6b2f]" : "text-[#dc000c]"}`}>
              {message.text}
            </span>
          )}
        </div>
      </section>

      {/* 測定履歴 */}
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
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr>
                  <td className={td} colSpan={8}>
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
                    <td className={`${tdNum} ${diff !== null && diff < 0 ? "text-[#dc000c]" : diff !== null && diff > 0 ? "text-[#2f6b2f]" : ""}`}>
                      {fmt(diff, 6)}
                    </td>
                    <td className={td}>{h.sokuteisha}</td>
                    <td className={td}>
                      <button
                        onClick={() => remove(h.measuredOn, h.itemKey)}
                        className="rounded p-1 text-[#dc000c] hover:bg-[#fdecea]"
                        aria-label="削除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
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
