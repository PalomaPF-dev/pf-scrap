"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { importItemsAction } from "@/lib/actions";
import { parseCsv, readTextFile } from "@/lib/csv";

/**
 * 品目マスターのCSV取込。1行目に見出しがあれば列順は自由
 * （見出し例: 管理図番, 品名, KEY, 区分, 親図番, 親品名, 子図番, 子品名, 単位,
 *   構成重量, 完成重量(理論), 製造場所CD, 製造場所名, 工場）。
 * KEY 未指定時は 管理図番+製造場所CD から自動生成。UTF-8 / Shift_JIS 自動判定。
 */
const COLS: [string, string][] = [
  ["kanriZuban", "管理図番"],
  ["hinmei", "品名"],
  ["key", "KEY"],
  ["kubun", "区分"],
  ["oyaZuban", "親図番"],
  ["oyaHinmei", "親品名"],
  ["koZuban", "子図番"],
  ["koHinmei", "子品名"],
  ["tani", "単位"],
  ["koseiJuryo", "構成重量"],
  ["kanseiJuryo", "完成重量"],
  ["seizoBashoCD", "製造場所CD"],
  ["seizoBashoMei", "製造場所名"],
  ["factory", "工場"],
];

export default function ItemImportButton() {
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
    // ヘッダー行から列位置を判定（日本語名 or 英語キー）。判定不可なら列順を仮定
    const header = rows[0].map((v) => String(v).trim());
    const colIdx: Record<string, number> = {};
    let hasHeader = false;
    for (const [k, jp] of COLS) {
      const idx = header.findIndex((h) => h === jp || h === k || h.startsWith(jp));
      if (idx >= 0) {
        colIdx[k] = idx;
        hasHeader = true;
      }
    }
    if (!hasHeader) COLS.forEach(([k], i) => (colIdx[k] = i));
    const dataRows = hasHeader ? rows.slice(1) : rows;
    const records = dataRows.map((r) => {
      const rec: Record<string, string> = {};
      for (const [k] of COLS) {
        rec[k] = colIdx[k] !== undefined ? String(r[colIdx[k]] ?? "").trim() : "";
      }
      return rec;
    });
    startTransition(async () => {
      const res = await importItemsAction(records);
      setMessage(res.message ?? "");
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => fileRef.current?.click()}
        disabled={pending}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 py-2 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5] disabled:opacity-50"
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
