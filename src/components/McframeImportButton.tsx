"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { importMcframeAction } from "@/lib/actions";
import { parseCsv, readTextFile } from "@/lib/csv";

/**
 * McFrame 完成品数量（加工数）のCSV取込。
 * 品目は「品目CD × 格納場所CD」の組で特定する（同じ品目CDが工場ごとにあるため）。
 *
 * 受け付ける形式:
 *   - McFrameの製造実績をそのまま出力したCSV（品目ＣＤ／格納場所ＣＤ／出来高計上日／基準単位良品数量。
 *     英語見出し itm_p.itm_cd / strg_loc_cd / yield_ac_dt / base_unit_yield_qty_p.qty でも可）
 *   - 品目CD, 格納場所CD, 日付, 加工数（月次は 日付 の代わりに 年月）
 * 同じ品目が同じ日に複数行あっても、取込時に合計される。
 * UTF-8 / Shift_JIS 自動判定。ExcelのままではなくCSVで保存して取り込む。
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
    // 見出しは全角英数字・空白のゆれがあるので、正規化してから照合する
    const norm = (v: unknown) =>
      String(v ?? "")
        .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
        .replace(/[\s　"']/g, "")
        .toLowerCase();
    // McFrameの実績出力は1行目が英語見出し・2行目が日本語見出しのことがあるため、
    // 品目CDらしき列を持つ行を見出しとして探す（先頭5行まで）。
    const hasCol = (r: string[], ...names: string[]) =>
      r.some((v) => names.some((n) => norm(v) === n || norm(v).includes(n)));
    let head = -1;
    for (let i = 0; i < Math.min(rows.length, 5); i++) {
      if (hasCol(rows[i], "品目cd", "itm_cd", "管理図番", "key")) {
        head = i;
        break;
      }
    }
    const find = (r: string[], ...names: string[]) =>
      r.findIndex((v) => names.some((n) => norm(v) === n || norm(v).includes(n)));

    let start: number;
    let idxItem: number, idxKakuno: number, idxPeriod: number, idxQty: number;
    if (head >= 0) {
      const h = rows[head];
      start = head + 1;
      idxItem = find(h, "品目cd", "itm_cd", "管理図番", "key");
      idxKakuno = find(h, "格納場所cd", "strg_loc_cd");
      // 格納場所が無い出力は製造場所で代用する（品目マスター側も同じ扱い）
      if (idxKakuno < 0) idxKakuno = find(h, "製造場所cd", "mfg_loc_cd");
      idxPeriod =
        mode === "daily"
          ? find(h, "出来高計上日", "yield_ac_dt", "出来高実績日", "yield_act_dt", "日付", "完成日", "実績日")
          : find(h, "年月", "日付");
      idxQty = find(h, "基準単位良品数量", "base_unit_yield_qty", "加工数", "良品数量", "数量", "qty");
    } else {
      // 見出し無し: 品目CD, 格納場所CD, 日付(年月), 加工数
      start = 0;
      idxItem = 0;
      idxKakuno = 1;
      idxPeriod = 2;
      idxQty = 3;
    }
    if (idxItem < 0 || idxKakuno < 0 || idxPeriod < 0 || idxQty < 0) {
      setMessage(
        mode === "daily"
          ? "列が読み取れません。McFrameの製造実績の出力（品目ＣＤ・格納場所ＣＤ・出来高計上日・基準単位良品数量）か、品目CD, 格納場所CD, 日付, 加工数 のCSVを取り込んでください。"
          : "列が読み取れません。品目CD, 格納場所CD, 年月, 加工数 のCSVを取り込んでください。"
      );
      return;
    }
    const records = rows
      .slice(start)
      .filter((r) => String(r[idxItem] ?? "").trim() !== "")
      .map((r) => {
        const period = String(r[idxPeriod] ?? "").trim();
        return {
          hinmokuCD: String(r[idxItem] ?? "").trim(),
          kakunoCD: String(r[idxKakuno] ?? "").trim(),
          date: mode === "daily" ? period : "",
          ym: mode === "daily" ? "" : period,
          qty: String(r[idxQty] ?? "").trim(),
        };
      });
    if (records.length === 0) {
      setMessage("取込対象の行がありませんでした。");
      return;
    }
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
        title="McFrameの製造実績、または 品目CD, 格納場所CD, 日付, 加工数"
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
        title="過去データ移行用: 品目CD, 格納場所CD, 年月, 加工数（日別データが無い期間だけ使います）"
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
