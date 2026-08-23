import { Sparkles } from "lucide-react";
import type { DailyRecord, ScaleRead } from "@/lib/db";
import { fmt } from "@/lib/format";

const td = "border border-[#e5e5e5] px-2 py-1.5 whitespace-nowrap";
const tdNum = `${td} text-right tabular-nums`;
const th = "border border-[#e5e5e5] bg-[#f0f0ee] px-2 py-1.5 text-left font-semibold whitespace-nowrap";

/** ISO日時 → HH:MM（JST）。 */
function hhmm(iso: string): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString("ja-JP", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const CONFIDENCE_LABEL: Record<string, string> = {
  high: "高",
  medium: "中",
  low: "低",
};

/**
 * AI読取の履歴（改ざん確認用）。
 *
 * ログは /api/scale-read がサーバー側で書くだけで、更新も削除もしない。
 * 記録のほうを後から書き換えても、ここに残った「AIはこう読んだ」は変わらないので、
 * 採用値と突き合わせれば人が上書きした箇所が分かる。
 * 記録を消しても読取の事実は残る（下の「記録に未使用」がそれにあたる）。
 */
export default function ScaleReadLog({
  reads,
  record,
}: {
  reads: ScaleRead[];
  record: DailyRecord | null;
}) {
  if (reads.length === 0) return null;

  // 明細が採用している読取ID → 採用値。突き合わせの相手。
  const adopted = new Map<string, number | null>();
  for (const e of record?.entries ?? []) {
    if (e.cumBeforeReadId) adopted.set(e.cumBeforeReadId, e.cumBefore);
    if (e.cumAfterReadId) adopted.set(e.cumAfterReadId, e.cumAfter);
  }

  const rows = reads.map((r) => {
    const used = adopted.has(r.id);
    const finalValue = used ? (adopted.get(r.id) ?? null) : null;
    const overwritten =
      used && r.value !== null && finalValue !== null && Math.abs(finalValue - r.value) > 0.0005;
    return { r, used, finalValue, overwritten };
  });
  const overwrittenCount = rows.filter((x) => x.overwritten).length;

  return (
    <section className="mt-4 rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 text-sm font-bold text-[#333333]">
          <Sparkles className="h-4 w-4 text-[#0b5ca8]" />
          AI読取の履歴（{reads.length}件）
        </h2>
        {overwrittenCount > 0 && (
          <span className="rounded-md bg-[#fdecea] px-2 py-0.5 text-xs font-bold text-[#dc000c]">
            人が上書きした読取 {overwrittenCount}件
          </span>
        )}
      </div>
      <p className="mb-3 text-xs text-[#909090]">
        撮影のたびにサーバー側で記録され、あとから書き換えられません。記録に採用された値と
        違っていれば、誰がいつ上書きしたかを明細の訂正理由と合わせて確認できます。
      </p>
      <div className="overflow-x-auto">
        <table className="print-table w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={th}>時刻</th>
              <th className={th}>スクラップ箱</th>
              <th className={th}>区分</th>
              <th className={`${th} text-right`}>AI読取値</th>
              <th className={th}>表示</th>
              <th className={th}>確信度</th>
              <th className={`${th} text-right`}>採用値</th>
              <th className={th}>読取者</th>
              <th className={th}>備考</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, used, finalValue, overwritten }) => (
              <tr key={r.id} className={overwritten ? "bg-[#fdecea]" : ""}>
                <td className={td}>{hhmm(r.readAt)}</td>
                <td className={td}>{r.scaleName || "—"}</td>
                <td className={td}>{r.phase === "before" ? "投入前" : "投入後"}</td>
                <td className={tdNum}>{r.value !== null ? fmt(r.value) : "読取不可"}</td>
                <td className={td}>{r.digits || "—"}</td>
                <td className={td}>{CONFIDENCE_LABEL[r.confidence] ?? r.confidence}</td>
                <td className={`${tdNum} ${overwritten ? "font-bold text-[#dc000c]" : ""}`}>
                  {used ? fmt(finalValue) : "—"}
                </td>
                <td className={td}>{r.readBy}</td>
                <td className={`${td} ${overwritten ? "font-bold text-[#dc000c]" : "text-[#909090]"}`}>
                  {[overwritten ? "人が上書き" : "", !used ? "記録に未使用" : "", r.note]
                    .filter(Boolean)
                    .join(" ／ ")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
