"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { importMcframeAction } from "@/lib/actions";
import { parseCsv, readTextFile } from "@/lib/csv";
import { normYm } from "@/lib/format";

/** 日付として読める値か（2026-08-05 / 2026/8/5 / 20260805）。年月だけなら false。 */
function isDailyValue(v: unknown): boolean {
  const s = String(v ?? "").trim();
  if (!s) return false;
  return /^\d{4}\D?\d{1,2}\D+\d{1,2}$/.test(s) || /^\d{8}$/.test(s);
}

/**
 * McFrame 完成品数量（加工数）のCSV取込。品目マスターのKEY単位で取り込む。
 * 「KEY,日付,加工数」（日別）または「KEY,年月,加工数」（月次）。
 * 「管理図番,製造場所CD,日付/年月,加工数」の4列も可。1行目ヘッダー可。
 * UTF-8 / Shift_JIS 自動判定。
 */
export default function McframeImportButton() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  async function onFile(file: File) {
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
    let idxYm = 1;
    let idxDate = -1;
    let idxQty = 2;
    let idxBasho = -1;
    if (looksHeader) {
      start = 1;
      const find = (...names: string[]) =>
        h.findIndex((v) => names.some((n) => v.toLowerCase() === n || v.includes(n)));
      const k = find("key", "管理図番");
      const b = find("製造場所");
      const d = find("日付", "完成日", "実績日");
      const y = find("年月");
      const q = find("加工数", "数量", "qty");
      if (k >= 0) idxKey = k;
      if (b >= 0) idxBasho = b;
      if (d >= 0) idxDate = d;
      if (y >= 0) idxYm = y;
      if (q >= 0) idxQty = q;
    } else if (rows[0].length >= 4 && normYm(rows[0][2])) {
      // ヘッダー無し4列: 管理図番, 製造場所CD, 年月(または日付), 加工数
      idxKey = 0;
      idxBasho = 1;
      idxYm = 2;
      idxQty = 3;
    }
    // 日付列があれば日別、無ければ年月列を見る（年月列に日付が入っていれば日別として扱う）
    const idxPeriod = idxDate >= 0 ? idxDate : idxYm;
    const isDaily = idxDate >= 0 || rows.slice(start, start + 5).some((r) => isDailyValue(r[idxYm]));
    const records = rows.slice(start).map((r) => {
      const period = String(r[idxPeriod] ?? "").trim();
      return {
        itemKey:
          String(r[idxKey] ?? "").trim() + (idxBasho >= 0 ? String(r[idxBasho] ?? "").trim() : ""),
        date: isDaily ? period : "",
        ym: isDaily ? "" : period,
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
    <div className="flex items-center gap-2">
      <button
        onClick={() => fileRef.current?.click()}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg bg-[#b4632c] px-3 py-2 text-sm font-semibold text-white hover:bg-[#96521f] disabled:opacity-50"
      >
        <Upload className="h-4 w-4" />
        {pending ? "取込中…" : "CSV取込"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".csv"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onFile(f);
        }}
      />
      {message && <span className="text-xs text-[#555555]">{message}</span>}
    </div>
  );
}
