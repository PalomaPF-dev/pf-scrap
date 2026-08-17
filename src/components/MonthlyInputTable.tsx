"use client";

import { useMemo, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Save } from "lucide-react";
import { saveMonthlyInputsAction } from "@/lib/actions";
import type { MonthlyInput } from "@/lib/db";
import { fmt, toNum } from "@/lib/format";

const td = "border border-[#e5e5e5] px-2 py-1 whitespace-nowrap";
const th = "border border-[#e5e5e5] bg-[#f0f0ee] px-2.5 py-1.5 text-center font-semibold whitespace-nowrap";
const cellInput =
  "w-28 rounded-lg border border-[#e5e5e5] bg-white px-2 py-1 text-right text-sm tabular-nums focus:border-[#b4632c] focus:outline-none";

type Row = {
  ym: string;
  zaikoDojo: string;
  zaikoDokan: string;
  zaikoSonota: string;
  konyuDojo: string;
  konyuDokan: string;
  konyuSonota: string;
  baikyaku: string;
};

const s = (v: number | null | undefined): string => (v === null || v === undefined ? "" : String(v));

/** ⑤ 年単位の月次入力グリッド（区分別の月初在庫・購入重量、売却数量）。 */
export default function MonthlyInputTable({
  year,
  inputs,
}: {
  year: number;
  inputs: MonthlyInput[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const initialRows = useMemo<Row[]>(() => {
    const byYm = new Map(inputs.map((m) => [m.ym, m]));
    return Array.from({ length: 12 }, (_, i) => {
      const ym = `${year}-${String(i + 1).padStart(2, "0")}`;
      const m = byYm.get(ym);
      return {
        ym,
        zaikoDojo: s(m?.zaikoDojo),
        zaikoDokan: s(m?.zaikoDokan),
        zaikoSonota: s(m?.zaikoSonota),
        konyuDojo: s(m?.konyuDojo),
        konyuDokan: s(m?.konyuDokan),
        konyuSonota: s(m?.konyuSonota),
        baikyaku: s(m?.baikyaku),
      };
    });
  }, [year, inputs]);

  const [rows, setRows] = useState<Row[]>(initialRows);

  function set(i: number, k: keyof Row, v: string) {
    setRows((prev) => prev.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  }

  function save() {
    setMessage(null);
    startTransition(async () => {
      // 何か1つでも値がある月だけ保存する（全空の月はレコードを作らない）
      const toSave = rows.filter((r) =>
        [r.zaikoDojo, r.zaikoDokan, r.zaikoSonota, r.konyuDojo, r.konyuDokan, r.konyuSonota, r.baikyaku].some(
          (v) => v.trim() !== ""
        )
      );
      const res = await saveMonthlyInputsAction(toSave);
      setMessage({ ok: res.ok, text: res.message ?? "" });
      if (res.ok) router.refresh();
    });
  }

  const numCell = (i: number, k: keyof Row) => (
    <td className={`${td} text-right`}>
      <input
        type="number"
        step="0.1"
        value={rows[i][k]}
        onChange={(e) => set(i, k, e.target.value)}
        className={cellInput}
      />
    </td>
  );

  return (
    <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-sm">
          年
          <input
            type="number"
            min={2000}
            max={2100}
            defaultValue={year}
            onChange={(e) => {
              const y = Number(e.target.value);
              if (Number.isInteger(y) && y >= 2000 && y <= 2100) {
                router.push(`${pathname}?year=${y}`);
              }
            }}
            className="w-24 rounded-lg border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-sm focus:border-[#b4632c] focus:outline-none"
          />
        </label>
        <button
          onClick={save}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#b4632c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#96521f] disabled:opacity-50"
        >
          <Save className="h-4 w-4" />
          {pending ? "保存中…" : "保存"}
        </button>
        {message && (
          <span className={`text-sm ${message.ok ? "text-[#2f6b2f]" : "text-[#dc000c]"}`}>
            {message.text}
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={th} rowSpan={2}>年月</th>
              <th className={th} colSpan={3}>月初在庫(kg)</th>
              <th className={th} rowSpan={2}>月初在庫<br />全体</th>
              <th className={th} colSpan={3}>購入重量(kg)</th>
              <th className={th} rowSpan={2}>購入重量<br />全体</th>
              <th className={th} rowSpan={2}>スクラップ<br />売却数量(kg)</th>
            </tr>
            <tr>
              <th className={th}>銅条</th>
              <th className={th}>銅管</th>
              <th className={th}>その他</th>
              <th className={th}>銅条</th>
              <th className={th}>銅管</th>
              <th className={th}>その他</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const zaikoSum = toNum(r.zaikoDojo) + toNum(r.zaikoDokan) + toNum(r.zaikoSonota);
              const konyuSum = toNum(r.konyuDojo) + toNum(r.konyuDokan) + toNum(r.konyuSonota);
              const hasZaiko = [r.zaikoDojo, r.zaikoDokan, r.zaikoSonota].some((v) => v !== "");
              const hasKonyu = [r.konyuDojo, r.konyuDokan, r.konyuSonota].some((v) => v !== "");
              return (
                <tr key={r.ym}>
                  <td className={td}>{r.ym}</td>
                  {numCell(i, "zaikoDojo")}
                  {numCell(i, "zaikoDokan")}
                  {numCell(i, "zaikoSonota")}
                  <td className={`${td} bg-[#faf6ef] text-right font-semibold tabular-nums`}>
                    {hasZaiko ? fmt(zaikoSum) : "-"}
                  </td>
                  {numCell(i, "konyuDojo")}
                  {numCell(i, "konyuDokan")}
                  {numCell(i, "konyuSonota")}
                  <td className={`${td} bg-[#faf6ef] text-right font-semibold tabular-nums`}>
                    {hasKonyu ? fmt(konyuSum) : "-"}
                  </td>
                  {numCell(i, "baikyaku")}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
