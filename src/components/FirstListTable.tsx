"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteFirstArticlesAction } from "@/lib/actions";
import { FA_STATUS_LABEL, type FaStatus } from "@/lib/scrapTypes";
import type { FirstArticleListRow } from "@/lib/db";
import { fmt, fmtPct } from "@/lib/format";

const th = "px-3 py-2 text-left text-xs font-medium text-[#707070] whitespace-nowrap";
const td = "px-3 py-2 whitespace-nowrap";

function statusClass(status: FaStatus): string {
  return status === "approved"
    ? "bg-[#eef4ee] text-[#2f6b2f]"
    : status === "pending"
      ? "bg-[#fff3e0] text-[#a15c00]"
      : "bg-[#fdecea] text-[#dc000c]";
}

const keyOf = (r: Pick<FirstArticleListRow, "measuredOn" | "hinmokuCD" | "kakunoCD">) =>
  `${r.measuredOn}|${r.hinmokuCD}|${r.kakunoCD}`;

/**
 * 初品測定一覧の表。管理者は行ごと、または選んだ行をまとめて削除できる
 * （承認済みを消すと完成重量の計算は理論値へ戻る。確認してから消す）。
 */
export default function FirstListTable({
  rows,
  isAdmin,
}: {
  rows: FirstArticleListRow[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");

  const allKeys = rows.map(keyOf);
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selected.has(k));

  function toggle(k: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function remove(targets: FirstArticleListRow[]) {
    if (targets.length === 0) return;
    const label =
      targets.length === 1
        ? `${targets[0].measuredOn} ${targets[0].hinmokuCD}${targets[0].kakunoCD ? ` / ${targets[0].kakunoCD}` : ""} の測定記録`
        : `選択した ${targets.length} 件の測定記録`;
    if (!confirm(`${label}を削除しますか?\n承認済みの値を消すと、完成重量の計算は品目マスターの理論値に戻ります。`)) return;
    setMessage("");
    startTransition(async () => {
      const res = await deleteFirstArticlesAction(
        targets.map((t) => ({ measuredOn: t.measuredOn, hinmokuCD: t.hinmokuCD, kakunoCD: t.kakunoCD }))
      );
      setMessage(res.message ?? "");
      if (res.ok) setSelected(new Set());
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-slate-500">条件に合う初品測定の記録がありません。</div>
    );
  }

  const selectedRows = rows.filter((r) => selected.has(keyOf(r)));

  return (
    <>
      {isAdmin && (selected.size > 0 || message) && (
        <div className="flex flex-wrap items-center gap-3 border-b border-[#eeeeee] bg-[#fdf8f3] px-4 py-2 text-sm">
          {selected.size > 0 && (
            <>
              <span className="text-[#555555]">{selected.size} 件を選択中</span>
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(selectedRows)}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-[#dc000c] px-3 text-xs font-semibold text-[#dc000c] hover:bg-[#fdecea] disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {pending ? "削除中…" : "選択した記録を削除"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => setSelected(new Set())}
                className="h-9 rounded-lg border border-[#e5e5e5] bg-white px-3 text-xs text-[#555555] hover:bg-[#f7f7f5]"
              >
                選択を解除
              </button>
            </>
          )}
          {message && <span className="text-xs text-[#555555]">{message}</span>}
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#fafaf8]">
            <tr>
              {isAdmin && (
                <th className={`${th} w-8`}>
                  <input
                    type="checkbox"
                    aria-label="すべて選択"
                    checked={allSelected}
                    onChange={(e) => setSelected(e.target.checked ? new Set(allKeys) : new Set())}
                  />
                </th>
              )}
              <th className={th}>測定日</th>
              <th className={th}>工場</th>
              <th className={th}>品目CD</th>
              <th className={th}>格納場所CD</th>
              <th className={th}>品名</th>
              <th className={`${th} text-right`}>実測(kg)</th>
              <th className={`${th} text-right`}>理論値(kg)</th>
              <th className={`${th} text-right`}>差(kg)</th>
              <th className={`${th} text-right`}>差率</th>
              <th className={th}>測定者</th>
              <th className={th}>状態</th>
              <th className={th}>承認者</th>
              <th className={th}>備考</th>
              {isAdmin && <th className={`${th} text-right`}>操作</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0f0f0]">
            {rows.map((r) => {
              const k = keyOf(r);
              const diff = r.kanseiJuryo !== null ? r.weight - r.kanseiJuryo : null;
              const rate = r.kanseiJuryo ? r.weight / r.kanseiJuryo - 1 : null;
              // 理論値から大きく外れている行は目立たせる（単位・桁の誤りに気づけるように）
              const off = rate !== null && Math.abs(rate) > 0.5;
              return (
                <tr key={k} className={`hover:bg-[#fcfcfb] ${selected.has(k) ? "bg-[#fdf8f3]" : ""}`}>
                  {isAdmin && (
                    <td className={td}>
                      <input
                        type="checkbox"
                        aria-label="この行を選択"
                        checked={selected.has(k)}
                        onChange={() => toggle(k)}
                      />
                    </td>
                  )}
                  <td className={`${td} tabular-nums`}>{r.measuredOn}</td>
                  <td className={td}>{r.factory || r.itemFactory || "—"}</td>
                  <td className={`${td} font-mono text-xs`}>{r.hinmokuCD}</td>
                  <td className={`${td} font-mono text-xs`}>{r.kakunoCD || "—"}</td>
                  <td className={`${td} max-w-[16rem] truncate`} title={r.hinmei ?? ""}>
                    {r.hinmei ?? <span className="text-[#9a9a9a]">（マスター未登録）</span>}
                  </td>
                  <td className={`${td} text-right font-bold tabular-nums`}>{fmt(r.weight, 4)}</td>
                  <td className={`${td} text-right tabular-nums text-[#555555]`}>
                    {r.kanseiJuryo !== null ? fmt(r.kanseiJuryo, 4) : "—"}
                  </td>
                  <td className={`${td} text-right tabular-nums text-[#555555]`}>
                    {diff !== null ? fmt(diff, 4) : "—"}
                  </td>
                  <td
                    className={`${td} text-right tabular-nums ${off ? "font-bold text-[#dc000c]" : "text-[#555555]"}`}
                  >
                    {rate !== null ? fmtPct(rate, 1) : "—"}
                  </td>
                  <td className={td}>{r.sokuteisha}</td>
                  <td className={td}>
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusClass(r.status)}`}>
                      {FA_STATUS_LABEL[r.status]}
                    </span>
                  </td>
                  <td className={`${td} text-[#555555]`}>{r.approvedBy || "—"}</td>
                  <td className={`${td} max-w-[16rem] truncate text-xs text-[#707070]`} title={r.rejectComment || r.note}>
                    {r.rejectComment || r.note || ""}
                  </td>
                  {isAdmin && (
                    <td className={`${td} text-right`}>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => remove([r])}
                        className="rounded p-1 text-[#dc000c] hover:bg-[#fdecea] disabled:opacity-50"
                        aria-label="削除"
                        title="削除"
                      >
                        <Trash2 className="h-4 w-4" />
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
  );
}
