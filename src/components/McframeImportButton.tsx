"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { importMcframeAction } from "@/lib/actions";
import { parseCsv, readTextFile } from "@/lib/csv";

/**
 * McFrame 完成品数量（加工数）のCSV取込。品目マスターのKEY単位で取り込む。
 *
 * 通常運用は日別（KEY,日付,加工数）。月次集計は日別の合計で出るため、
 * 月次の取込は過去データ移行のときだけ使う（Excelに月次の加工数しか無い期間用）。
 * 「管理図番,製造場所CD,日付/年月,加工数」の4列も可。1行目ヘッダー可。
 * UTF-8 / Shift_JIS 自動判定。
 */
export default function McframeImportButton() {
  const router = useRouter();
  const dayRef = useRef<HTMLInputElement>(null);
  const monthRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  async function onFile(file: File, mode: "daily" | "monthly") {
    setMessage("");
    const rows = parseCsv(await readTextFile(file));
    if (rows.length === 0) {
      setMessage("CSVが空です。");
      return;
    }
    // ヘッダー検出と列位置の判定
    let start = 0;
    const h = rows[0].map((v) => String(v).trim());
    const looksHeader = h.some((v) => /key|年月|日付|加工数|図番|数量|qty/i.test(v));
    let idxKey = 0;
    let idxPeriod = 1;
    let idxQty = 2;
    let idxBasho = -1;
    if (looksHeader) {
      start = 1;
      const find = (...names: string[]) =>
        h.findIndex((v) => names.some((n) => v.toLowerCase() === n || v.includes(n)));
      const k = find("key", "管理図番");
      const b = find("製造場所");
      const p = mode === "daily" ? find("日付", "完成日", "実績日", "年月") : find("年月", "日付");
      const q = find("加工数", "数量", "qty");
      if (k >= 0) idxKey = k;
      if (b >= 0) idxBasho = b;
      if (p >= 0) idxPeriod = p;
      if (q >= 0) idxQty = q;
    } else if (rows[0].length >= 4) {
      // ヘッダー無し4列: 管理図番, 製造場所CD, 日付(年月), 加工数
      idxKey = 0;
      idxBasho = 1;
      idxPeriod = 2;
      idxQty = 3;
    }
    const records = rows.slice(start).map((r) => {
      const period = String(r[idxPeriod] ?? "").trim();
      return {
        itemKey:
          String(r[idxKey] ?? "").trim() + (idxBasho >= 0 ? String(r[idxBasho] ?? "").trim() : ""),
        date: mode === "daily" ? period : "",
        ym: mode === "daily" ? "" : period,
        qty: String(r[idxQty] ?? "").trim(),
      };
    });
    startTransition(async () => {
      const res = await importMcframeAction(records);
      setMessage(res.message ?? "");
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => dayRef.current?.click()}
        disabled={pending}
        title="KEY, 日付, 加工数"
        className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#b4632c] px-3 text-sm font-semibold text-white hover:bg-[#96521f] disabled:opacity-50"
      >
        <Upload className="h-4 w-4" />
        {pending ? "取込中…" : "CSV取込（日別）"}
      </button>
      <input
        ref={dayRef}
        type="file"
        accept=".csv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onFile(f, "daily");
        }}
      />
      <button
        onClick={() => monthRef.current?.click()}
        disabled={pending}
        title="過去データ移行用: KEY, 年月, 加工数（日別データが無い期間だけ使います）"
        className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm text-[#555555] hover:bg-[#f7f7f5] disabled:opacity-50"
      >
        <Upload className="h-4 w-4" />
        月次CSV取込（過去データ移行用）
      </button>
      <input
        ref={monthRef}
        type="file"
        accept=".csv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onFile(f, "monthly");
        }}
      />
      {message && <span className="text-xs text-[#555555]">{message}</span>}
    </div>
  );
}
