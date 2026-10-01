"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, ExternalLink, FileText, Trash2 } from "lucide-react";
import type { QualitySheet } from "@/lib/scrapTypes";

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 取込日時（JST）。サーバーとブラウザで同じ文字列になるよう、書式を固定する。 */
function fmtAt(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const p = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    // hour12:false だと深夜0時が "24" になる実装があるので h23 を明示する
    hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "";
  return `${g("year")}/${g("month")}/${g("day")} ${g("hour")}:${g("minute")}`;
}

/**
 * 取り込んだ品質チェックシートの一覧。ファイル名を押すとその場で開く。
 * 削除は管理者と取り込んだ本人だけ（サーバー側でも同じ判定をする）。
 */
export default function QualitySheetsTable({
  sheets,
  isAdmin,
  userId,
  showFactory,
}: {
  sheets: QualitySheet[];
  isAdmin: boolean;
  userId: string;
  /** 工場を「すべて」で見ているときは工場列を出す */
  showFactory: boolean;
}) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);

  async function remove(s: QualitySheet) {
    if (!confirm(`「${s.fileName}」を削除しますか?\nこの操作は取り消せません。`)) return;
    setDeleting(s.id);
    try {
      const res = await fetch(`/api/quality-sheets/${s.id}`, { method: "DELETE" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) alert(data?.message ?? "削除に失敗しました");
      router.refresh();
    } catch (e) {
      alert("削除に失敗しました: " + (e as Error).message);
    } finally {
      setDeleting(null);
    }
  }

  if (sheets.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[#e5e5e5] bg-white px-4 py-8 text-center text-sm text-slate-500">
        この月の品質チェックシートはまだありません。上の枠にPDFを落としてください。
      </div>
    );
  }

  const total = sheets.reduce((a, s) => a + s.sizeBytes, 0);

  return (
    <div className="overflow-hidden rounded-2xl border border-[#e5e5e5] bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eeeeee] px-4 py-2.5 text-sm">
        <span className="font-medium text-slate-700">{sheets.length} 件</span>
        <span className="text-xs text-[#707070]">合計 {fmtSize(total)}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-[#fafaf8] text-xs text-[#707070]">
            <tr>
              <th className="px-4 py-2 text-left font-medium">ファイル名</th>
              {showFactory && <th className="px-3 py-2 text-left font-medium">工場</th>}
              <th className="px-3 py-2 text-right font-medium">大きさ</th>
              <th className="px-3 py-2 text-left font-medium">取込者</th>
              <th className="px-3 py-2 text-left font-medium">取込日時</th>
              <th className="px-3 py-2 text-right font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0f0f0]">
            {sheets.map((s) => {
              const canDelete = isAdmin || s.uploadedById === userId;
              const href = `/api/quality-sheets/${s.id}`;
              return (
                <tr key={s.id} className="hover:bg-[#fcfcfb]">
                  <td className="px-4 py-2">
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex max-w-[28rem] items-center gap-1.5 font-medium text-[#8a4a1c] hover:underline"
                      title={s.fileName}
                    >
                      <FileText className="h-4 w-4 shrink-0 text-[#b4632c]" />
                      <span className="truncate">{s.fileName}</span>
                    </a>
                  </td>
                  {showFactory && (
                    <td className="whitespace-nowrap px-3 py-2 text-[#555555]">{s.factory || "—"}</td>
                  )}
                  <td className="whitespace-nowrap px-3 py-2 text-right text-[#555555]">{fmtSize(s.sizeBytes)}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-[#555555]">{s.uploadedBy || "—"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-[#555555]">{fmtAt(s.uploadedAt)}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      <a
                        href={href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded p-1 text-[#555555] hover:bg-[#f7f7f5]"
                        aria-label="開く"
                        title="開く"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                      <a
                        href={`${href}?download=1`}
                        className="rounded p-1 text-[#555555] hover:bg-[#f7f7f5]"
                        aria-label="ダウンロード"
                        title="ダウンロード"
                      >
                        <Download className="h-4 w-4" />
                      </a>
                      {canDelete && (
                        <button
                          type="button"
                          disabled={deleting === s.id}
                          onClick={() => void remove(s)}
                          className="rounded p-1 text-[#dc000c] hover:bg-[#fdecea] disabled:opacity-50"
                          aria-label="削除"
                          title="削除"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
