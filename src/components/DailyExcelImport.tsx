"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileSpreadsheet, Upload } from "lucide-react";
import { importDailyExcelAction, type DailyImportResult } from "@/lib/actions";
import {
  buildDailyImport,
  commonZairyo,
  guessKind,
  guessYear,
  parseDailyExcelWorkbook,
  type DailyExcelFile,
  type DailyImportDay,
  type KindMode,
} from "@/lib/dailyExcel";
import { readXlsx, type XlsxSheet } from "@/lib/xlsx";
import { kindColor, type ScrapKind } from "@/lib/scrapTypes";
import { fmt } from "@/lib/format";

interface LoadedFile {
  name: string;
  /**
   * 箱の種類。kindMode=file ならブック全体（大口: 種類ごとのブック）、
   * zairyo なら品種列が空の明細に使う既定値（直方: 部署ごとのブック）。
   * シート名・品種列から見当をつけ、画面で直せる。
   */
  kind: string;
  kindMode: KindMode;
  sheets: XlsxSheet[];
  parsed: DailyExcelFile;
}

const input =
  "h-11 rounded-lg border border-[#e5e5e5] bg-white px-3 text-base focus:border-[#b4632c] focus:outline-none sm:h-10 sm:text-sm";
const th = "border border-[#e5e5e5] bg-[#f0f0ee] px-2 py-1.5 text-left font-semibold whitespace-nowrap";
const td = "border border-[#e5e5e5] px-2 py-1.5 align-top";
const tdNum = `${td} text-right tabular-nums whitespace-nowrap`;

/**
 * 1回のServer Actionで送る日数。明細は1件ずつINSERTするので、
 * 1リクエストが長くなりすぎないよう小分けにする（進み具合も出せる）。
 */
const CHUNK = 3;

/**
 * Excelの日次記録票（箱の種類ごとのブック）をアプリの日次記録に取り込む。
 * ブラウザでExcelを読んで内容を確認してから、確認した内容だけをサーバーへ送る。
 */
export default function DailyExcelImport({
  factory,
  factoryOptions,
  factoryLocked,
  kinds,
}: {
  factory: string;
  factoryOptions: string[];
  factoryLocked: boolean;
  kinds: ScrapKind[];
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [target, setTarget] = useState(factory);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [files, setFiles] = useState<LoadedFile[]>([]);
  const [mode, setMode] = useState<"skip" | "overwrite">("skip");
  // Excelに責任者サインが無い日も承認済みにする（直方のブックはサイン欄がほぼ空）
  const [approveAll, setApproveAll] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<DailyImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  const days: DailyImportDay[] = files.length
    ? buildDailyImport(
        files.map((f) => ({ kind: f.kind, kindMode: f.kindMode, fileName: f.name, file: f.parsed })),
        { factory: target }
      )
    : [];
  const totalEntries = days.reduce((t, d) => t + d.entries.length, 0);
  const totalWeight = days.reduce((t, d) => t + d.total, 0);
  const warnDays = days.filter((d) => d.warnings.length > 0);

  async function onFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setError("");
    setResult(null);
    setProgress("Excelを読み込んでいます…");
    try {
      const loaded: LoadedFile[] = [];
      let detectedYear: number | null = null;
      for (const file of Array.from(list)) {
        if (file.size > 20 * 1024 * 1024) {
          throw new Error(`${file.name} が大きすぎます（20MBまで）。`);
        }
        const sheets = await readXlsx(await file.arrayBuffer());
        detectedYear = detectedYear ?? guessYear(sheets);
        loaded.push({ name: file.name, kind: "", kindMode: "file", sheets, parsed: { sheets: [], skipped: [] } });
      }
      // 年はブック内の日付セルから推定（入っていなければ今年）
      const base = detectedYear ?? new Date().getFullYear();
      setYear(base);
      setFiles(
        loaded.map((f) => {
          const parsed = parseDailyExcelWorkbook(f.sheets, base);
          // シート名に種類の語があるブック（大口）はブック全体で1つ。
          // 無いブック（直方）は品種列から決め、いちばん多い品種を既定にする
          const fileKind = guessKind(f.sheets.map((sh) => sh.name));
          return fileKind
            ? { ...f, parsed, kind: fileKind, kindMode: "file" as KindMode }
            : { ...f, parsed, kind: commonZairyo(parsed), kindMode: "zairyo" as KindMode };
        })
      );
      setProgress("");
    } catch (e) {
      setFiles([]);
      setProgress("");
      setError((e as Error).message);
    }
  }

  function reparse(nextYear: number, nextFiles = files) {
    setFiles(nextFiles.map((f) => ({ ...f, parsed: parseDailyExcelWorkbook(f.sheets, nextYear) })));
  }

  function setKind(index: number, patch: Partial<Pick<LoadedFile, "kind" | "kindMode">>) {
    setFiles((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));
  }

  function run() {
    setError("");
    setResult(null);
    const missing = files.find((f) => !f.kind.trim());
    if (missing) {
      setError(`「${missing.name}」の箱の種類を選んでください。`);
      return;
    }
    if (days.length === 0) {
      setError("取り込める記録がありません。");
      return;
    }
    startTransition(async () => {
      const merged: DailyImportResult = {
        ok: true,
        message: "",
        imported: [],
        skipped: [],
        failed: [],
        createdKinds: [],
      };
      for (let i = 0; i < days.length; i += CHUNK) {
        const chunk = days.slice(i, i + CHUNK);
        setProgress(`取込中… ${Math.min(i + chunk.length, days.length)} / ${days.length}日`);
        const res = await importDailyExcelAction({
          factory: target,
          mode,
          approveAll,
          days: chunk.map((d) => ({
            recordDate: d.recordDate,
            sekininsha: d.sekininsha,
            shonin: d.shonin,
            tonyuKanryo: d.tonyuKanryo,
            hakoZanryo: d.hakoZanryo,
            kaishuSokuteichi: d.kaishuSokuteichi,
            biko: d.biko,
            entries: d.entries.map((e) => ({ ...e })),
          })),
        });
        merged.imported.push(...res.imported);
        merged.skipped.push(...res.skipped);
        merged.failed.push(...res.failed);
        for (const k of res.createdKinds) {
          if (!merged.createdKinds.includes(k)) merged.createdKinds.push(k);
        }
        if (!res.ok && res.imported.length === 0 && res.skipped.length === 0 && res.failed.length === 0) {
          // 権限・工場エラーなど、取込そのものが始まらなかったとき
          merged.ok = false;
          merged.message = res.message;
          setProgress("");
          setResult(merged);
          return;
        }
      }
      merged.ok = merged.failed.length === 0;
      merged.message = [
        `取込 ${merged.imported.length}日`,
        merged.skipped.length ? `既存のため飛ばし ${merged.skipped.length}日` : "",
        merged.failed.length ? `エラー ${merged.failed.length}日` : "",
        merged.createdKinds.length ? `種類を追加: ${merged.createdKinds.join("・")}` : "",
      ]
        .filter(Boolean)
        .join(" / ");
      setProgress("");
      setResult(merged);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      {/* 取込先と年 */}
      <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <h2 className="mb-3 text-base font-bold text-[#333333] sm:text-sm">1. 取込先</h2>
        <div className="flex flex-wrap gap-3">
          <label className="flex flex-col gap-1 text-xs text-[#707070]">
            工場
            <select
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              disabled={factoryLocked}
              className={`${input} min-w-40`}
            >
              {factoryOptions.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-xs text-[#707070]">
            年（シート名に年が無いため）
            <input
              type="number"
              value={year}
              min={2000}
              max={2100}
              onChange={(e) => {
                const y = Number(e.target.value);
                setYear(y);
                if (y >= 2000 && y <= 2100) reparse(y);
              }}
              className={`${input} w-32`}
            />
          </label>
        </div>
        <p className="mt-2 text-xs text-[#909090]">
          シート名の「7.23」のような表記から日付を決めます。ブックの途中で月が戻る場合（12月→1月）は
          翌年として扱います。
        </p>
      </section>

      {/* ファイル選択 */}
      <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
        <h2 className="mb-1 text-base font-bold text-[#333333] sm:text-sm">2. Excelを選ぶ</h2>
        <p className="mb-3 text-xs text-[#909090]">
          箱の種類ごとのブック（上銅 / 銅ダライ / 銅スクラップ）をまとめて選べます。
          同じ日のシートは1枚の記録票にまとまります。
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xlsm"
          multiple
          className="hidden"
          onChange={(e) => {
            void onFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={pending}
          className="inline-flex h-11 items-center gap-2 rounded-lg border border-[#e5e5e5] bg-white px-4 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5] disabled:opacity-50 sm:h-10"
        >
          <FileSpreadsheet className="h-4 w-4" />
          Excelファイルを選ぶ
        </button>

        {files.length > 0 && (
          <ul className="mt-3 space-y-2">
            {files.map((f, i) => (
              <li key={f.name + i} className="rounded-xl border border-[#e5e5e5] p-3">
                <div className="text-sm font-medium text-[#333333]">{f.name}</div>
                <p className="mt-1 text-xs text-[#707070]">
                  取込対象 {f.parsed.sheets.length}シート ／ 明細{" "}
                  {f.parsed.sheets.reduce((t, s) => t + s.entries.length, 0)}件 ／ 合計{" "}
                  {fmt(f.parsed.sheets.reduce((t, s) => t + s.total, 0))} kg
                </p>
                {/* 箱の種類の決め方。大口はブックごと、直方は品種列（銅条/銅管）とシート名の「下銅」 */}
                <div className="mt-2 flex flex-col gap-1.5 text-sm">
                  <label className="flex flex-wrap items-center gap-2">
                    <input
                      type="radio"
                      name={`kind-mode-${i}`}
                      checked={f.kindMode === "file"}
                      onChange={() => setKind(i, { kindMode: "file" })}
                      className="h-4 w-4"
                    />
                    このブック全体で1つの種類
                    <input
                      list="scrap-kind-options"
                      value={f.kindMode === "file" ? f.kind : ""}
                      disabled={f.kindMode !== "file"}
                      onChange={(e) => setKind(i, { kind: e.target.value })}
                      placeholder="例: 上銅"
                      className={`${input} w-36`}
                    />
                  </label>
                  <label className="flex flex-wrap items-center gap-2">
                    <input
                      type="radio"
                      name={`kind-mode-${i}`}
                      checked={f.kindMode === "zairyo"}
                      onChange={() => setKind(i, { kindMode: "zairyo" })}
                      className="h-4 w-4"
                    />
                    明細の「品種」列から（シート名に種類があればそれ。品種が空の行は
                    <input
                      list="scrap-kind-options"
                      value={f.kindMode === "zairyo" ? f.kind : ""}
                      disabled={f.kindMode !== "zairyo"}
                      onChange={(e) => setKind(i, { kind: e.target.value })}
                      placeholder="例: 銅条"
                      className={`${input} w-36`}
                    />
                    ）
                  </label>
                </div>
                {f.parsed.skipped.length > 0 && (
                  <p className="mt-1.5 text-xs text-[#909090]">
                    対象外:{" "}
                    {f.parsed.skipped
                      .map((sk) =>
                        sk.entries > 0 ? `${sk.sheetName}（日付が読めません・明細${sk.entries}件）` : sk.sheetName
                      )
                      .join("、")}
                  </p>
                )}
                {f.parsed.skipped.some((sk) => sk.entries > 0) && (
                  <p className="mt-0.5 text-xs text-[#a15c00]">
                    明細があるのに日付が読めないシートがあります。取り込むには、Excelでシート名に日付（例「9.8」）を入れて選び直してください。
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        <datalist id="scrap-kind-options">
          {kinds.map((k) => (
            <option key={k.id} value={k.name} />
          ))}
        </datalist>
        <p className="mt-2 text-xs text-[#909090]">
          種類マスタに無い種類（銅条・銅管・下銅 など）は、取込時に「設定 &gt; スクラップ種類」に追加されます。
          その種類の重量計が1台だけ登録されていれば、明細はその箱に紐づきます。
        </p>
      </section>

      {/* 内容の確認 */}
      {days.length > 0 && (
        <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-base font-bold text-[#333333] sm:text-sm">3. 内容の確認</h2>
            <span className="text-sm text-[#707070]">
              {days.length}日 ／ {totalEntries}件 ／ 合計{" "}
              <span className="text-lg font-bold tabular-nums">{fmt(totalWeight)}</span> kg
            </span>
          </div>

          {warnDays.length > 0 && (
            <div className="mb-3 rounded-xl border border-[#f0d9a0] bg-[#fdf7ec] p-3">
              <p className="flex items-center gap-1.5 text-sm font-bold text-[#a15c00]">
                <AlertTriangle className="h-4 w-4" />
                確認が必要な日が {warnDays.length}日あります
              </p>
              <ul className="mt-1 space-y-0.5 text-xs text-[#a15c00]">
                {warnDays.flatMap((d) =>
                  d.warnings.map((w, i) => (
                    <li key={`${d.recordDate}-${i}`}>
                      {d.recordDate} {w}
                    </li>
                  ))
                )}
              </ul>
            </div>
          )}

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className={th}>日付</th>
                  <th className={th}>箱ごとの内訳</th>
                  <th className={`${th} text-right`}>明細</th>
                  <th className={`${th} text-right`}>合計(kg)</th>
                  <th className={`${th} text-right`}>回収箱測定値</th>
                  <th className={th}>責任者</th>
                  <th className={th}>承認</th>
                </tr>
              </thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.recordDate}>
                    <td className={`${td} whitespace-nowrap`}>{d.recordDate}</td>
                    <td className={td}>
                      <span className="flex flex-wrap gap-1">
                        {d.sources.map((s, i) => (
                          <span
                            key={`${s.sheetName}-${i}`}
                            className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${kindColor(s.kind)}`}
                          >
                            {s.kind} {fmt(s.total)}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className={tdNum}>{d.entries.length}</td>
                    <td className={`${tdNum} font-semibold`}>{fmt(d.total)}</td>
                    <td className={tdNum}>{d.kaishuSokuteichi === null ? "—" : fmt(d.kaishuSokuteichi)}</td>
                    <td className={`${td} whitespace-nowrap`}>{d.sekininsha || "—"}</td>
                    <td className={`${td} whitespace-nowrap`}>{d.shonin || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-[#909090]">
            重量は「重量 − 箱重量」で取り込みます（投入前・投入後の表示値は、Excelの「累積」と同じく
            種類ごとの積み上げで入ります）。回収箱測定値には大口の「回収箱測定値」、直方の「計量重量」が入ります。
          </p>
        </section>
      )}

      {/* 取込 */}
      {days.length > 0 && (
        <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
          <h2 className="mb-3 text-base font-bold text-[#333333] sm:text-sm">4. 取り込む</h2>
          <div className="flex flex-col gap-2 text-sm">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={mode === "skip"}
                onChange={() => setMode("skip")}
                className="h-4 w-4"
              />
              すでにアプリに記録がある日は取り込まない（推奨）
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={mode === "overwrite"}
                onChange={() => setMode("overwrite")}
                className="h-4 w-4"
              />
              すでに記録がある日もExcelの内容で置き換える（承認済みの記録も置き換わります）
            </label>
            <label className="mt-1 flex items-center gap-2">
              <input
                type="checkbox"
                checked={approveAll}
                onChange={(e) => setApproveAll(e.target.checked)}
                className="h-4 w-4"
              />
              Excelに責任者のサインが無い日も承認済みとして取り込む（承認者は取込者）
            </label>
            <p className="text-xs text-[#909090]">
              サインがある日は常に承認済み（承認者はサインの名前）になります。チェックを外すと、サインが無い日は「下書き」のまま取り込みます。
            </p>
          </div>
          <button
            onClick={run}
            disabled={pending}
            className="mt-4 inline-flex h-12 items-center gap-2 rounded-xl bg-[#b4632c] px-6 text-base font-semibold text-white hover:bg-[#96521f] disabled:opacity-50 sm:h-11 sm:text-sm"
          >
            <Upload className="h-5 w-5" />
            {days.length}日分を取り込む
          </button>
        </section>
      )}

      {progress && <p className="text-sm text-[#707070]">{progress}</p>}
      {error && <p className="text-sm text-[#dc000c]">{error}</p>}

      {result && (
        <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
          <p className={`text-sm font-bold ${result.ok ? "text-[#2f6b2f]" : "text-[#dc000c]"}`}>
            {result.message}
          </p>
          {result.skipped.length > 0 && (
            <p className="mt-2 text-xs text-[#707070]">
              飛ばした日（すでに記録あり）: {result.skipped.join("、")}
            </p>
          )}
          {result.failed.length > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-[#dc000c]">
              {result.failed.map((f, i) => (
                <li key={`${f.date}-${i}`}>
                  {f.date}: {f.message}
                </li>
              ))}
            </ul>
          )}
          {result.imported.length > 0 && (
            <p className="mt-2 text-xs text-[#707070]">
              取り込んだ記録は「日次記録」の各日付、または「月間集計」で確認できます。
            </p>
          )}
        </section>
      )}
    </div>
  );
}
