"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Save, X } from "lucide-react";
import PdfDropZone, { type PickedPdf } from "./PdfDropZone";
import {
  importCheckSheetsAction,
  resolveCheckSheetItemsAction,
  type CheckSheetItemCandidate,
} from "@/lib/actions";
import { parseCheckSheet, type CheckSheetRow } from "@/lib/checkSheet";
import { readPdfPages } from "@/lib/pdfText";
import { fmt } from "@/lib/format";

const td = "border border-[#e5e5e5] px-2 py-1 whitespace-nowrap";
const tdNum = `${td} text-right tabular-nums`;
const th = "border border-[#e5e5e5] bg-[#f0f0ee] px-2 py-1 text-left font-semibold whitespace-nowrap";

/** 理論値との比がこれを超えたら要確認（初期状態で登録対象から外す）。単位や桁の誤記の検出用。 */
const RATIO_OFF = 3;

interface Sheet extends CheckSheetRow {
  file: string;
  page: number;
  candidates: CheckSheetItemCandidate[];
  /** 選んだ品目（品目CD\t格納場所CD）。候補が1件なら自動 */
  ref: string;
  checked: boolean;
}

const refOf = (c: CheckSheetItemCandidate) => `${c.hinmokuCD}\t${c.kakunoCD}`;

function ratioOf(s: Sheet): number | null {
  const c = s.candidates.find((x) => refOf(x) === s.ref);
  if (!c || !(c.kanseiJuryo > 0) || s.weight === null) return null;
  return s.weight / c.kanseiJuryo;
}

/** 登録できない理由（空なら登録可） */
function problemOf(s: Sheet): string {
  if (!s.date) return "加工日なし";
  if (!s.zuban) return "図番なし";
  if (s.weight === null) return "重量なし";
  // 品目マスターに無い図番は、図番のまま（格納場所なし）で登録できる
  if (!s.ref) return "品目を選択";
  return "";
}

/**
 * 品質チェックシート（PDF）の一括取込（管理者のみ）。
 * 大口工場は初品の単品完成品重量をチェックシートの備考欄に書いているため、
 * 日別の大量のPDFをまとめて読み、加工日×品目の初品測定として登録する。
 * PDFはドロップ枠で受け取り、ブラウザ内で読む。サーバーへは読み取った値だけを送り、
 * ファイル自体は保存しない。
 */
export default function CheckSheetImport({
  factory,
  standalone = false,
}: {
  factory: string;
  /** 取込画面（/quality）に単体で置くとき true（上の余白を付けない） */
  standalone?: boolean;
}) {
  const router = useRouter();
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [reading, setReading] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState("");
  const [pending, startTransition] = useTransition();

  function onPicked(picked: PickedPdf[], info: { skippedNonPdf: number; truncated: number }) {
    const notes: string[] = [];
    if (info.skippedNonPdf) notes.push(`PDF以外の ${info.skippedNonPdf} 件は読み取りません`);
    if (info.truncated) notes.push(`一度に読めるのは ${info.truncated + picked.length} 件中 ${picked.length} 件までです`);
    if (picked.length === 0) {
      setMessage(notes.join("。") || "PDFファイルがありません");
      return;
    }
    setDone("");
    void onFiles(picked.map((p) => p.file), notes.join("。"));
  }

  async function onFiles(files: File[], prefix = "") {
    setMessage(prefix);
    const out: Sheet[] = [];
    let failed = 0;
    for (let i = 0; i < files.length; i++) {
      const f = files[i];
      setReading(`読取中… ${i + 1} / ${files.length}`);
      try {
        const pages = await readPdfPages(f);
        pages.forEach((p, n) => {
          if (p.items.length === 0) return; // 画像だけのページ（スキャン）は読めない
          const row = parseCheckSheet(p.items, p);
          out.push({ ...row, file: f.name, page: n + 1, candidates: [], ref: "", checked: false });
        });
        if (pages.every((p) => p.items.length === 0)) failed++;
      } catch (e) {
        console.error("[check-sheet]", f.name, e);
        failed++;
      }
    }
    setReading("品目マスターと照合中…");
    try {
      const map = await resolveCheckSheetItemsAction(
        [...new Set(out.map((s) => s.zuban).filter(Boolean))],
        factory || null
      );
      for (const s of out) {
        s.candidates = map[s.zuban] ?? [];
        if (s.candidates.length === 1) s.ref = refOf(s.candidates[0]);
        // マスターに無い図番は、図番のまま登録する（格納場所は空。一覧では「マスター未登録」と出る）
        if (s.candidates.length === 0 && s.zuban) {
          s.ref = `${s.zuban}\t`;
          s.warnings.push("品目マスター未登録（図番のまま登録）");
        }
        const r = ratioOf(s);
        s.checked = !problemOf(s) && (r === null || (r < RATIO_OFF && r > 1 / RATIO_OFF));
      }
    } catch (e) {
      setMessage((e as Error).message);
    }
    out.sort((a, b) => a.date.localeCompare(b.date) || a.zuban.localeCompare(b.zuban));
    setSheets(out);
    setReading("");
    if (failed) {
      setMessage((m) =>
        [m, `${failed}件のPDFは文字を読み取れませんでした（スキャン画像のPDFは非対応です）。`]
          .filter(Boolean)
          .join(" ")
      );
    }
  }

  const update = (i: number, patch: Partial<Sheet>) =>
    setSheets((prev) => prev.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const targets = sheets.filter((s) => s.checked && !problemOf(s));

  /** 品目ごとの集計（登録対象のみ）: 件数・平均・最小・最大・期間 */
  const summary = useMemo(() => {
    const m = new Map<
      string,
      { zuban: string; hinmei: string; ws: number[]; from: string; to: string; kansei: number }
    >();
    for (const s of targets) {
      // マスター未登録の図番は候補が無い（図番のまま登録）
      const c = s.candidates.find((x) => refOf(x) === s.ref);
      const k = s.ref;
      const e = m.get(k) ?? {
        zuban: c ? `${c.hinmokuCD}${c.kakunoCD ? ` / ${c.kakunoCD}` : ""}` : `${s.zuban}（マスター未登録）`,
        hinmei: c?.hinmei || s.hinmei,
        ws: [],
        from: s.date,
        to: s.date,
        kansei: c?.kanseiJuryo ?? 0,
      };
      e.ws.push(s.weight!);
      if (s.date < e.from) e.from = s.date;
      if (s.date > e.to) e.to = s.date;
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => a.zuban.localeCompare(b.zuban));
  }, [targets]);

  function save() {
    const rows = targets.map((s) => {
      const [hinmokuCD, kakunoCD] = s.ref.split("\t");
      return { date: s.date, hinmokuCD, kakunoCD, weight: s.weight, inspector: s.inspector, hinmei: s.hinmei };
    });
    startTransition(async () => {
      const res = await importCheckSheetsAction(rows, factory || null);
      setMessage(res.ok ? "" : (res.message ?? ""));
      if (res.ok) {
        setDone(res.message ?? "登録しました");
        setSheets([]);
        router.refresh();
      }
    });
  }

  return (
    <section className={`${standalone ? "" : "mt-4 "}rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5`}>
      <div className="mb-3">
        <h2 className="text-sm font-bold text-[#333333]">品質チェックシート（PDF）から一括取込</h2>
        <p className="mt-0.5 text-xs text-[#909090]">
          チェックシートの「備考」欄に書かれた完成品重量（kg）を、加工日×図番の初品測定として登録します。
          品目マスターに無い図番も、図番のまま登録できます。ファイル自体は保存しません。G長確認済みの記録として、承認済みで計算に反映されます。
          {factory ? `（${factory}の品目マスターと照合）` : ""}
        </p>
      </div>

      <PdfDropZone
        onFiles={onPicked}
        disabled={pending}
        busyLabel={reading}
        footnote={`${factory ? `${factory} ・ ` : ""}PDFのみ ・ 文字を持つPDF（Excelから出力したもの）が対象`}
      />

      {message && <p className="mt-3 text-xs text-[#a15c00]">{message}</p>}
      {done && (
        <p className="mt-3 rounded-lg bg-[#eef4ee] px-3 py-2 text-sm text-[#2f6b2f]">
          {done}{" "}
          <Link href="/first-list" className="font-medium underline">
            初品測定一覧で確認
          </Link>
        </p>
      )}

      {sheets.length > 0 && (
        <>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[#555555]">
            <span>
              読取 {sheets.length}件 / 登録対象 <b className="text-[#333333]">{targets.length}件</b>
              （同じ加工日×品目が複数あれば平均して1件にします）
            </span>
            <button
              onClick={save}
              disabled={pending || targets.length === 0}
              className="ml-auto inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#b4632c] px-3 text-sm font-semibold text-white hover:bg-[#96521f] disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {pending ? "登録中…" : `${targets.length}件を登録`}
            </button>
            <button
              onClick={() => setSheets([])}
              disabled={pending}
              className="inline-flex h-10 items-center gap-1 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm text-[#555555] hover:bg-[#f7f7f5]"
            >
              <X className="h-4 w-4" />
              取消
            </button>
          </div>

          {summary.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full border-collapse text-xs">
                <thead>
                  <tr>
                    <th className={th}>品目CD / 格納場所</th>
                    <th className={th}>品名</th>
                    <th className={th}>期間</th>
                    <th className={th}>件数</th>
                    <th className={th}>平均(kg)</th>
                    <th className={th}>最小</th>
                    <th className={th}>最大</th>
                    <th className={th}>理論値</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.map((e) => (
                    <tr key={e.zuban}>
                      <td className={td}>{e.zuban}</td>
                      <td className={td}>{e.hinmei}</td>
                      <td className={td}>
                        {e.from === e.to ? e.from : `${e.from} 〜 ${e.to}`}
                      </td>
                      <td className={tdNum}>{e.ws.length}</td>
                      <td className={tdNum}>{fmt(e.ws.reduce((a, b) => a + b, 0) / e.ws.length, 4)}</td>
                      <td className={tdNum}>{fmt(Math.min(...e.ws), 4)}</td>
                      <td className={tdNum}>{fmt(Math.max(...e.ws), 4)}</td>
                      <td className={tdNum}>{e.kansei > 0 ? fmt(e.kansei, 4) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-3 max-h-[480px] overflow-auto">
            <table className="min-w-full border-collapse text-xs">
              <thead className="sticky top-0">
                <tr>
                  <th className={th}>登録</th>
                  <th className={th}>加工日</th>
                  <th className={th}>図番</th>
                  <th className={th}>品名</th>
                  <th className={th}>工程</th>
                  <th className={th}>備考</th>
                  <th className={th}>重量(kg)</th>
                  <th className={th}>理論値比</th>
                  <th className={th}>品目</th>
                  <th className={th}>検査者</th>
                  <th className={th}>ファイル</th>
                </tr>
              </thead>
              <tbody>
                {sheets.map((s, i) => {
                  const problem = problemOf(s);
                  const r = ratioOf(s);
                  const off = r !== null && (r >= RATIO_OFF || r <= 1 / RATIO_OFF);
                  const warn = r !== null && !off && Math.abs(r - 1) > 0.5;
                  return (
                    <tr key={`${s.file}-${s.page}`} className={problem ? "bg-[#fafafa] text-[#909090]" : ""}>
                      <td className={td}>
                        <input
                          type="checkbox"
                          checked={s.checked && !problem}
                          disabled={!!problem}
                          onChange={(e) => update(i, { checked: e.target.checked })}
                        />
                      </td>
                      <td className={td}>{s.date || "—"}</td>
                      <td className={td}>{s.zuban || "—"}</td>
                      <td className={td}>{s.hinmei}</td>
                      <td className={td}>{s.kotei}</td>
                      <td className={`${td} max-w-[160px] truncate`} title={s.bikou}>
                        {s.bikou}
                      </td>
                      <td className={tdNum}>{s.weight !== null ? fmt(s.weight, 4) : "—"}</td>
                      <td
                        className={`${tdNum} ${off ? "font-bold text-[#dc000c]" : warn ? "text-[#a15c00]" : ""}`}
                        title={off ? "理論値と桁が違う可能性があります（単位・小数点を確認）" : undefined}
                      >
                        {r !== null ? `${fmt(r * 100, 0)}%` : "—"}
                      </td>
                      <td className={td}>
                        {s.candidates.length > 1 ? (
                          <select
                            value={s.ref}
                            onChange={(e) =>
                              update(i, { ref: e.target.value, checked: !!e.target.value })
                            }
                            className="h-7 rounded border border-[#e5e5e5] bg-white px-1"
                          >
                            <option value="">格納場所を選択</option>
                            {s.candidates.map((c) => (
                              <option key={refOf(c)} value={refOf(c)}>
                                {c.hinmokuCD} / {c.kakunoCD} {c.kakunoMei}
                              </option>
                            ))}
                          </select>
                        ) : s.candidates.length === 1 ? (
                          `${s.candidates[0].hinmokuCD} / ${s.candidates[0].kakunoCD}`
                        ) : s.zuban ? (
                          <span className="text-[#a15c00]">{s.zuban} / —</span>
                        ) : (
                          ""
                        )}
                        {problem && <span className="ml-1 text-[#dc000c]">{problem}</span>}
                        {!problem && s.warnings.length > 0 && (
                          <span className="ml-1 text-[#a15c00]">{s.warnings.join(" / ")}</span>
                        )}
                      </td>
                      <td className={td}>{s.inspector}</td>
                      <td className={`${td} max-w-[200px] truncate`} title={s.file}>
                        {s.file}
                        {s.page > 1 ? ` (p.${s.page})` : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
