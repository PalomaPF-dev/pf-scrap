"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FileDown, Plus, Save, Trash2, Upload } from "lucide-react";
import {
  addAdjustmentAction,
  deleteAdjustmentAction,
  importMonthlyCsvAction,
  importProcureCsvAction,
  saveMonthlyAnchorAction,
  saveProcureDaysAction,
} from "@/lib/actions";
import type { InventoryAdjustment, MonthlyInput, ProcureDay } from "@/lib/db";
import { downloadCsv, parseCsv, readTextFile } from "@/lib/csv";
import { fmt, toNum, todayStr } from "@/lib/format";
import MonthNav from "@/components/MonthNav";

const td = "border border-[#e5e5e5] px-2 py-1 whitespace-nowrap";
const th = "border border-[#e5e5e5] bg-[#f0f0ee] px-2 py-1.5 text-center font-semibold whitespace-nowrap";
const input =
  "rounded-lg border border-[#e5e5e5] bg-white px-2 py-1 text-sm focus:border-[#b4632c] focus:outline-none";
const cellInput = `${input} w-24 text-right tabular-nums`;

type Row = {
  pdate: string;
  konyuDojo: string;
  konyuDokan: string;
  konyuSonota: string;
  baikyaku: string;
  note: string;
  recordedBy: string;
};

const s = (v: number | null | undefined): string => (v === null || v === undefined ? "" : String(v));

/** ⑤ 調達入力（日次グリッド + 月初在庫アンカー + 在庫補正）。 */
export default function ProcurePanel({
  ym,
  factory,
  factoryOptions,
  factoryLocked,
  days,
  adjustments,
  anchor,
  isAdmin,
  userName,
}: {
  ym: string;
  factory: string;
  factoryOptions: string[];
  factoryLocked: boolean;
  days: ProcureDay[];
  adjustments: InventoryAdjustment[];
  anchor: MonthlyInput | null;
  isAdmin: boolean;
  userName: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const fileRef = useRef<HTMLInputElement>(null);
  const monthlyFileRef = useRef<HTMLInputElement>(null);
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  // 対象月の日数分の行（既存データをマージ）
  const initialRows = useMemo<Row[]>(() => {
    const [y, m] = ym.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    const byDate = new Map(days.map((d) => [d.pdate, d]));
    return Array.from({ length: last }, (_, i) => {
      const pdate = `${ym}-${String(i + 1).padStart(2, "0")}`;
      const d = byDate.get(pdate);
      return {
        pdate,
        konyuDojo: s(d?.konyuDojo),
        konyuDokan: s(d?.konyuDokan),
        konyuSonota: s(d?.konyuSonota),
        baikyaku: s(d?.baikyaku),
        note: d?.note ?? "",
        recordedBy: d?.recordedBy ?? "",
      };
    });
  }, [ym, days]);

  const [rows, setRows] = useState<Row[]>(initialRows);
  // 月の全日を並べると長いので、入力済みの日だけに絞り込めるようにする
  const [onlyFilled, setOnlyFilled] = useState(false);
  const [zaikoDojo, setZaikoDojo] = useState(s(anchor?.zaikoDojo));
  const [zaikoDokan, setZaikoDokan] = useState(s(anchor?.zaikoDokan));
  const [zaikoSonota, setZaikoSonota] = useState(s(anchor?.zaikoSonota));

  // 在庫補正の追加フォーム
  const [adjDate, setAdjDate] = useState(todayStr());
  const [adjKubun, setAdjKubun] = useState("銅条");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjReason, setAdjReason] = useState("");

  function moveTo(next: { ym?: string; factory?: string }) {
    const q = new URLSearchParams(searchParams.toString());
    if (next.ym) q.set("ym", next.ym);
    if (next.factory) q.set("factory", next.factory);
    router.push(`${pathname}?${q.toString()}`);
  }

  function setRow(i: number, k: keyof Row, v: string) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  }

  const filled = (r: Row) =>
    Boolean(r.konyuDojo || r.konyuDokan || r.konyuSonota || r.baikyaku || r.note);
  const visibleRows = useMemo(
    () => rows.map((r, i) => ({ r, i })).filter(({ r }) => !onlyFilled || filled(r)),
    [rows, onlyFilled]
  );
  const filledCount = useMemo(() => rows.filter(filled).length, [rows]);

  const totals = useMemo(() => {
    const t = { dojo: 0, dokan: 0, sonota: 0, baikyaku: 0 };
    for (const r of rows) {
      t.dojo += toNum(r.konyuDojo);
      t.dokan += toNum(r.konyuDokan);
      t.sonota += toNum(r.konyuSonota);
      t.baikyaku += toNum(r.baikyaku);
    }
    return t;
  }, [rows]);

  function save() {
    setMessage(null);
    startTransition(async () => {
      const res = await saveProcureDaysAction({ factory, days: rows });
      setMessage({ ok: res.ok, text: res.message ?? "" });
      if (res.ok) router.refresh();
    });
  }

  function saveAnchor() {
    setMessage(null);
    startTransition(async () => {
      const res = await saveMonthlyAnchorAction({ ym, factory, zaikoDojo, zaikoDokan, zaikoSonota });
      setMessage({ ok: res.ok, text: res.message ?? "" });
      if (res.ok) router.refresh();
    });
  }

  function addAdj() {
    setMessage(null);
    startTransition(async () => {
      const res = await addAdjustmentAction({
        adate: adjDate,
        factory,
        kubun: adjKubun,
        amount: adjAmount,
        reason: adjReason,
      });
      setMessage({ ok: res.ok, text: res.message ?? "" });
      if (res.ok) {
        setAdjAmount("");
        setAdjReason("");
        router.refresh();
      }
    });
  }

  function removeAdj(id: string) {
    if (!confirm("この在庫補正を削除しますか?")) return;
    startTransition(async () => {
      const res = await deleteAdjustmentAction(id);
      if (!res.ok) alert(res.message);
      router.refresh();
    });
  }

  function exportCsv() {
    const out: (string | number)[][] = [
      ["日付", "工場", "購入_銅条", "購入_銅管", "購入_その他", "売却数量", "備考", "入力者"],
    ];
    for (const r of rows) {
      if (!r.konyuDojo && !r.konyuDokan && !r.konyuSonota && !r.baikyaku && !r.note) continue;
      out.push([r.pdate, factory, r.konyuDojo, r.konyuDokan, r.konyuSonota, r.baikyaku, r.note, r.recordedBy]);
    }
    downloadCsv(`調達入力_${factory}_${ym}.csv`, out);
  }

  /** 月次データ（過去データ移行用）のCSV取込。列: 年月, 工場, 月初在庫_銅条…, 購入_銅条…, 売却数量 */
  async function onImportMonthlyFile(file: File) {
    setMessage(null);
    const parsed = parseCsv(await readTextFile(file));
    if (parsed.length === 0) {
      setMessage({ ok: false, text: "CSVが空です。" });
      return;
    }
    const header = parsed[0].map((v) => String(v).trim());
    const find = (...names: string[]) =>
      header.findIndex((h) => names.some((n) => h === n || h.includes(n)));
    const iYm = find("年月");
    const iFactory = find("工場");
    const iZd = find("月初在庫_銅条");
    const iZk = find("月初在庫_銅管");
    const iZs = find("月初在庫_その他");
    const iKd = find("購入_銅条");
    const iKk = find("購入_銅管");
    const iKs = find("購入_その他");
    const iBai = find("売却");
    if (iYm < 0) {
      setMessage({ ok: false, text: "1行目に「年月」列が見つかりません。" });
      return;
    }
    const records = parsed.slice(1).map((r) => ({
      ym: String(r[iYm] ?? "").trim(),
      factory: iFactory >= 0 ? String(r[iFactory] ?? "").trim() : factory,
      zaikoDojo: iZd >= 0 ? String(r[iZd] ?? "").trim() : "",
      zaikoDokan: iZk >= 0 ? String(r[iZk] ?? "").trim() : "",
      zaikoSonota: iZs >= 0 ? String(r[iZs] ?? "").trim() : "",
      konyuDojo: iKd >= 0 ? String(r[iKd] ?? "").trim() : "",
      konyuDokan: iKk >= 0 ? String(r[iKk] ?? "").trim() : "",
      konyuSonota: iKs >= 0 ? String(r[iKs] ?? "").trim() : "",
      baikyaku: iBai >= 0 ? String(r[iBai] ?? "").trim() : "",
    }));
    startTransition(async () => {
      const res = await importMonthlyCsvAction(records);
      setMessage({ ok: res.ok, text: res.message ?? "" });
      if (res.ok) router.refresh();
    });
  }

  async function onImportFile(file: File) {
    setMessage(null);
    const parsed = parseCsv(await readTextFile(file));
    if (parsed.length === 0) {
      setMessage({ ok: false, text: "CSVが空です。" });
      return;
    }
    const header = parsed[0].map((v) => String(v).trim());
    const find = (...names: string[]) =>
      header.findIndex((h) => names.some((n) => h === n || h.includes(n)));
    const iDate = find("日付");
    const iFactory = find("工場");
    const iDojo = find("購入_銅条", "銅条");
    const iDokan = find("購入_銅管", "銅管");
    const iSonota = find("購入_その他", "その他");
    const iBai = find("売却");
    const iNote = find("備考");
    const hasHeader = iDate >= 0;
    const dataRows = hasHeader ? parsed.slice(1) : parsed;
    const records = dataRows.map((r) => ({
      pdate: String(r[hasHeader ? iDate : 0] ?? "").trim(),
      factory: hasHeader && iFactory >= 0 ? String(r[iFactory] ?? "").trim() || factory : factory,
      konyuDojo: String(r[hasHeader ? iDojo : 2] ?? "").trim(),
      konyuDokan: String(r[hasHeader ? iDokan : 3] ?? "").trim(),
      konyuSonota: String(r[hasHeader ? iSonota : 4] ?? "").trim(),
      baikyaku: String(r[hasHeader ? iBai : 5] ?? "").trim(),
      note: hasHeader && iNote >= 0 ? String(r[iNote] ?? "").trim() : "",
    }));
    startTransition(async () => {
      const res = await importProcureCsvAction(records);
      setMessage({ ok: res.ok, text: res.message ?? "" });
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* 対象月・工場・操作 */}
      <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        {/* 対象月は ◀ ▶ で移動。工場と合わせて、選んだ月のデータだけを表示する */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <MonthNav ym={ym} />
          {factoryLocked ? (
            <span className="flex h-10 items-center rounded-lg border border-[#e5e5e5] bg-[#f7f7f5] px-3 text-sm">
              {factory}
            </span>
          ) : (
            <select
              value={factory}
              onChange={(e) => moveTo({ factory: e.target.value })}
              className={`${input} h-10`}
            >
              {!factoryOptions.includes(factory) && <option value={factory}>{factory}</option>}
              {factoryOptions.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={save}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#b4632c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#96521f] disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {pending ? "保存中…" : "保存"}
          </button>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm text-[#555555] hover:bg-[#f7f7f5] disabled:opacity-50"
          >
            <Upload className="h-4 w-4" />
            Excel/CSV取込
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) void onImportFile(f);
            }}
          />
          {isAdmin && (
            <>
              <button
                onClick={() => monthlyFileRef.current?.click()}
                disabled={pending}
                title="過去データ移行用: 年月, 工場, 月初在庫_銅条/銅管/その他, 購入_銅条/銅管/その他, 売却数量"
                className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm text-[#555555] hover:bg-[#f7f7f5] disabled:opacity-50"
              >
                <Upload className="h-4 w-4" />
                月次CSV取込
              </button>
              <input
                ref={monthlyFileRef}
                type="file"
                accept=".csv"
                hidden
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void onImportMonthlyFile(f);
                }}
              />
            </>
          )}
          <button
            onClick={exportCsv}
            className="inline-flex items-center gap-1.5 rounded-lg border border-[#e5e5e5] px-3 py-2 text-sm text-[#555555] hover:bg-[#f7f7f5]"
          >
            <FileDown className="h-4 w-4" />
            CSV出力
          </button>
          <span className="text-xs text-[#909090]">
            入力者: {userName}（自動記録） ／ 取込CSV列: 日付, 工場, 購入_銅条, 購入_銅管, 購入_その他, 売却数量, 備考
          </span>
        </div>
        {message && (
          <p className={`mt-2 text-sm ${message.ok ? "text-[#2f6b2f]" : "text-[#dc000c]"}`}>
            {message.text}
          </p>
        )}
      </section>

      {/* 日次グリッド */}
      <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold text-[#333333]">
            {ym} 入荷・売却の日次入力（{factory}）
          </h2>
          <label className="flex items-center gap-2 text-sm text-[#555555]">
            <input
              type="checkbox"
              checked={onlyFilled}
              onChange={(e) => setOnlyFilled(e.target.checked)}
              className="h-4 w-4 accent-[#b4632c]"
            />
            入力のある日だけ表示（{filledCount}日）
          </label>
        </div>

        {/* モバイル: 日ごとのカード */}
        <ul className="space-y-2 sm:hidden">
          {visibleRows.length === 0 && (
            <li className="rounded-xl bg-[#f7f7f5] px-3 py-3 text-sm text-[#707070]">
              入力のある日がありません。
            </li>
          )}
          {visibleRows.map(({ r, i }) => (
            <li key={r.pdate} className="rounded-xl border border-[#e5e5e5] p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-bold tabular-nums">{r.pdate.slice(5)}</span>
                <span className="text-xs text-[#909090]">{r.recordedBy}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ["購入 銅条(kg)", "konyuDojo"],
                    ["購入 銅管(kg)", "konyuDokan"],
                    ["購入 その他(kg)", "konyuSonota"],
                    ["売却(kg)", "baikyaku"],
                  ] as const
                ).map(([label, k]) => (
                  <label key={k} className="flex flex-col gap-1 text-xs text-[#707070]">
                    {label}
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.1"
                      value={r[k]}
                      onChange={(e) => setRow(i, k, e.target.value)}
                      className="h-11 rounded-lg border border-[#e5e5e5] bg-white px-3 text-right text-base tabular-nums focus:border-[#b4632c] focus:outline-none"
                    />
                  </label>
                ))}
              </div>
              <input
                type="text"
                value={r.note}
                onChange={(e) => setRow(i, "note", e.target.value)}
                placeholder="備考"
                className="mt-2 h-11 w-full rounded-lg border border-[#e5e5e5] bg-white px-3 text-base focus:border-[#b4632c] focus:outline-none"
              />
            </li>
          ))}
          <li className="flex items-center justify-between rounded-xl bg-[#faf6ef] px-3 py-2.5 text-sm font-semibold">
            <span>月間合計 購入</span>
            <span className="tabular-nums">
              {fmt(totals.dojo + totals.dokan + totals.sonota)} kg ／ 売却 {fmt(totals.baikyaku)} kg
            </span>
          </li>
        </ul>

        {/* PC: 表 */}
        <div className="hidden overflow-x-auto sm:block">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>日付</th>
                <th className={th}>購入 銅条(kg)</th>
                <th className={th}>購入 銅管(kg)</th>
                <th className={th}>購入 その他(kg)</th>
                <th className={th}>スクラップ売却(kg)</th>
                <th className={th}>備考</th>
                <th className={th}>入力者</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length === 0 && (
                <tr>
                  <td className={td} colSpan={7}>
                    入力のある日がありません。
                  </td>
                </tr>
              )}
              {visibleRows.map(({ r, i }) => (
                <tr key={r.pdate} className={r.recordedBy ? "" : "bg-[#fcfcfb]"}>
                  <td className={`${td} tabular-nums`}>{r.pdate.slice(5)}</td>
                  <td className={`${td} text-right`}>
                    <input
                      type="number"
                      step="0.1"
                      value={r.konyuDojo}
                      onChange={(e) => setRow(i, "konyuDojo", e.target.value)}
                      className={cellInput}
                    />
                  </td>
                  <td className={`${td} text-right`}>
                    <input
                      type="number"
                      step="0.1"
                      value={r.konyuDokan}
                      onChange={(e) => setRow(i, "konyuDokan", e.target.value)}
                      className={cellInput}
                    />
                  </td>
                  <td className={`${td} text-right`}>
                    <input
                      type="number"
                      step="0.1"
                      value={r.konyuSonota}
                      onChange={(e) => setRow(i, "konyuSonota", e.target.value)}
                      className={cellInput}
                    />
                  </td>
                  <td className={`${td} text-right`}>
                    <input
                      type="number"
                      step="0.1"
                      value={r.baikyaku}
                      onChange={(e) => setRow(i, "baikyaku", e.target.value)}
                      className={cellInput}
                    />
                  </td>
                  <td className={td}>
                    <input
                      type="text"
                      value={r.note}
                      onChange={(e) => setRow(i, "note", e.target.value)}
                      className={`${input} w-44`}
                    />
                  </td>
                  <td className={`${td} text-xs text-[#707070]`}>{r.recordedBy}</td>
                </tr>
              ))}
              <tr className="bg-[#faf6ef] font-semibold">
                <td className={td}>月間合計</td>
                <td className={`${td} text-right tabular-nums`}>{fmt(totals.dojo)}</td>
                <td className={`${td} text-right tabular-nums`}>{fmt(totals.dokan)}</td>
                <td className={`${td} text-right tabular-nums`}>{fmt(totals.sonota)}</td>
                <td className={`${td} text-right tabular-nums`}>{fmt(totals.baikyaku)}</td>
                <td className={td} colSpan={2}></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 月初在庫アンカー（管理者） */}
      {isAdmin && (
        <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
          <h2 className="mb-1 text-sm font-bold text-[#333333]">{ym} 月初在庫（棚卸確定値）</h2>
          <p className="mb-3 text-xs text-[#909090]">
            棚卸で月初在庫を確定した月だけ入力します。空欄の月は「前月月初 + 購入 − 使用量 + 在庫補正」で自動計算されます。
          </p>
          <div className="flex flex-wrap items-end gap-3">
            {(
              [
                ["銅条", zaikoDojo, setZaikoDojo],
                ["銅管", zaikoDokan, setZaikoDokan],
                ["その他", zaikoSonota, setZaikoSonota],
              ] as const
            ).map(([label, value, setter]) => (
              <label key={label} className="flex flex-col gap-1 text-xs text-[#707070]">
                {label} (kg)
                <input
                  type="number"
                  step="0.1"
                  value={value}
                  onChange={(e) => setter(e.target.value)}
                  className={cellInput}
                />
              </label>
            ))}
            <div className="flex flex-col gap-1 text-xs text-[#707070]">
              全体
              <span className="rounded-lg border border-[#e5e5e5] bg-[#f7f7f5] px-3 py-1 text-right text-sm font-semibold tabular-nums">
                {zaikoDojo || zaikoDokan || zaikoSonota
                  ? fmt(toNum(zaikoDojo) + toNum(zaikoDokan) + toNum(zaikoSonota))
                  : "-"}
              </span>
            </div>
            <button
              onClick={saveAnchor}
              disabled={pending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#b4632c] px-4 py-2 text-sm font-semibold text-[#b4632c] hover:bg-[#faf6ef] disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              月初在庫を保存
            </button>
          </div>
        </section>
      )}

      {/* 在庫補正（棚卸差異等） */}
      <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <h2 className="mb-1 text-sm font-bold text-[#333333]">在庫補正（棚卸差異など）</h2>
        <p className="mb-3 text-xs text-[#909090]">
          理論在庫と実棚のズレを理由付きで記録します（＋は在庫増、−は在庫減）。理論在庫の計算に反映されます。
        </p>
        <div className="mb-3 flex flex-wrap items-end gap-3 rounded-xl bg-[#f7f7f5] p-3">
          <label className="flex flex-col gap-1 text-xs text-[#707070]">
            日付
            <input type="date" value={adjDate} onChange={(e) => setAdjDate(e.target.value)} className={input} />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[#707070]">
            区分
            <select value={adjKubun} onChange={(e) => setAdjKubun(e.target.value)} className={input}>
              <option>銅条</option>
              <option>銅管</option>
              <option>その他</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[#707070]">
            補正量 (±kg)
            <input
              type="number"
              step="0.1"
              value={adjAmount}
              onChange={(e) => setAdjAmount(e.target.value)}
              className={cellInput}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-[#707070]">
            理由（必須）
            <input
              type="text"
              value={adjReason}
              onChange={(e) => setAdjReason(e.target.value)}
              placeholder="例: 8月棚卸差異"
              className={`${input} w-64`}
            />
          </label>
          <button
            onClick={addAdj}
            disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#333333] px-4 py-2 text-sm font-semibold text-white hover:bg-[#111111] disabled:opacity-50"
          >
            <Plus className="h-4 w-4" />
            補正を追加
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr>
                <th className={th}>日付</th>
                <th className={th}>区分</th>
                <th className={th}>補正量(kg)</th>
                <th className={th}>理由</th>
                <th className={th}>入力者</th>
                {isAdmin && <th className={th}></th>}
              </tr>
            </thead>
            <tbody>
              {adjustments.length === 0 && (
                <tr>
                  <td className={td} colSpan={isAdmin ? 6 : 5}>
                    対象月の在庫補正はありません
                  </td>
                </tr>
              )}
              {adjustments.map((a) => (
                <tr key={a.id}>
                  <td className={td}>{a.adate}</td>
                  <td className={td}>{a.kubun}</td>
                  <td
                    className={`${td} text-right tabular-nums ${a.amount < 0 ? "text-[#dc000c]" : "text-[#2f6b2f]"}`}
                  >
                    {a.amount > 0 ? "+" : ""}
                    {fmt(a.amount)}
                  </td>
                  <td className={td}>{a.reason}</td>
                  <td className={`${td} text-xs text-[#707070]`}>{a.recordedBy}</td>
                  {isAdmin && (
                    <td className={`${td} text-center`}>
                      <button
                        onClick={() => removeAdj(a.id)}
                        className="rounded p-1 text-[#dc000c] hover:bg-[#fdecea]"
                        aria-label="削除"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
