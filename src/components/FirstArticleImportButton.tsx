"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Upload } from "lucide-react";
import { importFirstArticlesAction } from "@/lib/actions";
import { readSheetTables } from "@/lib/csv";
import { extractFirstArticles } from "@/lib/faSheet";

/**
 * 初品重量測定のExcel/CSV一括取込（管理者のみ）。過去分をアプリへ移す用。
 * 現場のブックはシートが分かれている（まとめ・職場別・旧様式）ので全シートを読み、
 * 同じ品目・同じ日の重複は1件に畳む。取り込んだ値は承認済みとして登録される
 * （＝この操作が管理者の一括承認にあたる）ため、取込前に件数と期間を確認する。
 */
export default function FirstArticleImportButton({ factory }: { factory: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();

  async function onFile(file: File) {
    setMessage("");
    let tables: { name: string; rows: string[][] }[];
    try {
      tables = await readSheetTables(file);
    } catch (e) {
      setMessage((e as Error).message || "ファイルを読み取れませんでした。");
      return;
    }
    const { records, sheets, skipped } = extractFirstArticles(tables);
    if (records.length === 0) {
      setMessage(
        "測定値を読み取れませんでした。品目CD（管理図番）の見出しと、日付ごとの実測重量が並ぶ表を取り込んでください。"
      );
      return;
    }
    const from = records[0].measuredOn;
    const to = records[records.length - 1].measuredOn;
    const detail = sheets.map((s) => `${s.name}: ${s.count}件`).join("\n");
    const ok = window.confirm(
      `${records.length}件の測定値（${from} 〜 ${to}）を取り込みます。\n\n` +
        `${detail}\n\n` +
        `取り込んだ値は承認済みとして登録され、完成重量の計算にすぐ反映されます。` +
        `品目マスターの理論値と桁が10倍ちがう値は、他の日の水準に合わせて直します。\n\nよろしいですか？`
    );
    if (!ok) return;
    startTransition(async () => {
      const res = await importFirstArticlesAction({ factory, rows: records });
      setMessage(
        (res.message ?? "") + (skipped ? `\n（測定なしとして飛ばしたセル: ${skipped}）` : "")
      );
      if (res.ok) router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => fileRef.current?.click()}
        disabled={pending}
        title="現場のExcel（品目×日付の表）をそのまま取り込みます。承認済みとして登録されます。"
        className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5] disabled:opacity-50"
      >
        <Upload className="h-4 w-4" />
        {pending ? "取込中…" : "Excel/CSV取込（過去分）"}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xlsm,.csv,.txt"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) void onFile(f);
        }}
      />
      {message && (
        <span className="max-w-full whitespace-pre-line text-xs text-[#555555]">{message}</span>
      )}
    </div>
  );
}
