"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CloudUpload,
  FileText,
  FolderOpen,
  CircleCheck,
  CircleAlert,
  Copy,
  LoaderCircle,
  RotateCcw,
  X,
} from "lucide-react";
import { QUALITY_SHEET_MAX_BYTES } from "@/lib/scrapTypes";

/**
 * 品質チェックシート（PDF）の取込枠。
 *
 * - 複数のPDFをまとめてドラッグ＆ドロップできる（フォルダごと落としても中のPDFを拾う）
 * - 枠を押す／「ファイルを選ぶ」「フォルダを選ぶ」でも同じ
 * - 落とした順に1件ずつ /api/quality-sheets へ送る（1リクエスト1ファイル。
 *   Vercel の本文上限 4.5MB の内側に収め、1件失敗しても残りを止めないため）
 * - 結果は行ごとに出す（完了 / 取込済み（同じ内容） / エラー）。失敗分だけやり直せる
 */

type Status = "pending" | "uploading" | "done" | "duplicate" | "error";

interface QueueItem {
  key: string;
  file: File;
  /** 表示名。フォルダから拾ったものは相対パス（例 "202609/0901.pdf"） */
  name: string;
  status: Status;
  message: string;
}

/** 一度に受け付ける上限（月フォルダ1つ分より十分大きい。誤って全社フォルダを落とした保険） */
const MAX_FILES = 300;
/** フォルダをたどる深さ */
const MAX_DEPTH = 6;

const isPdf = (name: string, type: string) => /\.pdf$/i.test(name) || type === "application/pdf";

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function fmtYm(ym: string): string {
  const [y, m] = ym.split("-");
  return y && m ? `${y}年${Number(m)}月` : ym;
}

/** readEntries は1回で全部返さない（Chrome は100件ずつ）。空になるまで繰り返す。 */
async function readAllEntries(dir: FileSystemDirectoryEntry): Promise<FileSystemEntry[]> {
  const reader = dir.createReader();
  const out: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
    if (batch.length === 0) break;
    out.push(...batch);
  }
  return out;
}

/** ドロップされたエントリ（ファイル or フォルダ）を再帰的にたどってファイルを集める。 */
async function walk(
  entry: FileSystemEntry,
  depth: number,
  out: { file: File; path: string }[]
): Promise<void> {
  if (out.length >= MAX_FILES) return;
  if (entry.isFile) {
    const f = await new Promise<File | null>((res) =>
      (entry as FileSystemFileEntry).file(res, () => res(null))
    );
    if (f) out.push({ file: f, path: entry.fullPath.replace(/^\//, "") });
    return;
  }
  if (entry.isDirectory && depth < MAX_DEPTH) {
    const children = await readAllEntries(entry as FileSystemDirectoryEntry).catch(() => []);
    // 名前順に（フォルダの並びどおりに取り込まれるほうが確認しやすい）
    children.sort((a, b) => a.name.localeCompare(b.name, "ja"));
    for (const c of children) await walk(c, depth + 1, out);
  }
}

export default function QualitySheetDropZone({
  factory,
  factoryOptions,
  factoryLocked,
  ym,
}: {
  /** 画面で選ばれている工場（未選択は ""） */
  factory: string;
  factoryOptions: string[];
  /** 所属工場が設定された人は自工場に固定 */
  factoryLocked: boolean;
  /** 対象年月 'YYYY-MM' */
  ym: string;
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  // 取込先の工場。工場を「すべて」で見ているときは、先頭の工場を既定にして選び直せるようにする。
  // 画面側が key={ym|factory} で付け替えるので、絞り込みを変えればここも作り直される。
  // 送信中は選択を無効にするので、送信ループの途中で値が変わることはない。
  const [uploadFactory, setUploadFactory] = useState(factory || factoryOptions[0] || "");

  // 行の実体は ref に持ち、描画用に state へ写す（送信ループの途中で state が古くならないように）
  const itemsRef = useRef<QueueItem[]>([]);
  const [items, setItems] = useState<QueueItem[]>([]);
  const runningRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  // 子要素をまたぐと dragleave が飛ぶので、深さを数えて枠のハイライトがちらつかないようにする
  const dragDepth = useRef(0);
  const [dragActive, setDragActive] = useState(false);

  const sync = useCallback(() => setItems([...itemsRef.current]), []);
  const update = useCallback(
    (key: string, patch: Partial<QueueItem>) => {
      itemsRef.current = itemsRef.current.map((i) => (i.key === key ? { ...i, ...patch } : i));
      sync();
    },
    [sync]
  );

  // フォルダ選択は属性名が非標準（webkitdirectory）なので、型に頼らず直接付ける
  useEffect(() => {
    folderRef.current?.setAttribute("webkitdirectory", "");
    folderRef.current?.setAttribute("directory", "");
  }, []);

  // 枠の外に落としてしまったとき、ブラウザがPDFを開いて画面が消えるのを防ぐ
  useEffect(() => {
    const block = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  /** 落とした順に1件ずつ送る。すでに動いていれば、その回が残りも拾う。 */
  const pump = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    setBusy(true);
    try {
      for (;;) {
        const next = itemsRef.current.find((i) => i.status === "pending");
        if (!next) break;
        update(next.key, { status: "uploading", message: "" });
        const fd = new FormData();
        fd.append("file", next.file, next.file.name);
        fd.append("ym", ym);
        fd.append("factory", uploadFactory);
        try {
          const res = await fetch("/api/quality-sheets", { method: "POST", body: fd });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            update(next.key, {
              status: "error",
              message: data?.message ?? `取込に失敗しました（${res.status}）`,
            });
          } else if (data?.duplicate) {
            update(next.key, { status: "duplicate", message: data.message || "同じ内容のPDFが取込済みです" });
          } else {
            update(next.key, { status: "done", message: "" });
          }
        } catch (e) {
          update(next.key, { status: "error", message: "通信に失敗しました: " + (e as Error).message });
        }
      }
    } finally {
      runningRef.current = false;
      setBusy(false);
      // 一覧（サーバー描画）を最新にする
      router.refresh();
    }
  }, [router, update, uploadFactory, ym]);

  /** 受け取ったファイルを検査して行に追加し、送信を始める。 */
  const addFiles = useCallback(
    (picked: { file: File; path: string }[]) => {
      let skippedNonPdf = 0;
      let skippedSame = 0;
      let truncated = 0;
      const added: QueueItem[] = [];
      for (const { file, path } of picked) {
        if (!isPdf(file.name, file.type)) {
          skippedNonPdf++;
          continue;
        }
        if (itemsRef.current.length + added.length >= MAX_FILES) {
          truncated++;
          continue;
        }
        const key = `${path}|${file.size}|${file.lastModified}`;
        if (itemsRef.current.some((i) => i.key === key) || added.some((i) => i.key === key)) {
          skippedSame++;
          continue;
        }
        const item: QueueItem = { key, file, name: path || file.name, status: "pending", message: "" };
        if (file.size === 0) {
          item.status = "error";
          item.message = "空のファイルです";
        } else if (file.size > QUALITY_SHEET_MAX_BYTES) {
          item.status = "error";
          item.message = `${fmtSize(file.size)} は上限（${QUALITY_SHEET_MAX_BYTES / 1024 / 1024}MB）を超えています`;
        }
        added.push(item);
      }
      const notes: string[] = [];
      if (skippedNonPdf) notes.push(`PDF以外の ${skippedNonPdf} 件は取り込みません`);
      if (skippedSame) notes.push(`同じファイル ${skippedSame} 件はすでに一覧にあります`);
      if (truncated) notes.push(`一度に取り込めるのは ${MAX_FILES} 件までです（${truncated} 件は次回に）`);
      if (added.length === 0 && notes.length === 0) notes.push("PDFファイルがありません");
      setNotice(notes.join("。"));
      if (added.length === 0) return;
      itemsRef.current = [...itemsRef.current, ...added];
      sync();
      void pump();
    },
    [pump, sync]
  );

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    const dt = e.dataTransfer;
    // DataTransfer は await をまたぐと読めなくなるので、同期のうちに全部取り出す
    const plain: File[] = Array.from(dt.files ?? []);
    const fileItems = dt.items ? Array.from(dt.items).filter((it) => it.kind === "file") : [];
    const entries = fileItems
      .map((it) => (typeof it.webkitGetAsEntry === "function" ? it.webkitGetAsEntry() : null))
      .filter((en): en is FileSystemEntry => Boolean(en));
    void (async () => {
      let picked: { file: File; path: string }[];
      if (entries.length > 0 && entries.length === fileItems.length) {
        picked = [];
        for (const en of entries) await walk(en, 0, picked);
      } else {
        picked = plain.map((f) => ({ file: f, path: f.name }));
      }
      addFiles(picked);
    })();
  }

  function onInputFiles(list: FileList | null) {
    if (!list) return;
    const picked = Array.from(list).map((f) => ({
      file: f,
      // フォルダ選択なら相対パス（Chrome/Edge/Safari は webkitRelativePath に入る）
      path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
    }));
    addFiles(picked);
  }

  const counts = items.reduce(
    (acc, i) => {
      acc[i.status]++;
      return acc;
    },
    { pending: 0, uploading: 0, done: 0, duplicate: 0, error: 0 } as Record<Status, number>
  );
  const finished = items.length - counts.pending - counts.uploading;

  const targetLabel = `${uploadFactory || "工場未設定"} / ${fmtYm(ym)}`;

  return (
    <section className="space-y-3">
      {/* 取込先 */}
      <div className="flex flex-wrap items-center gap-2 text-sm text-[#555555]">
        <span className="text-xs text-[#707070]">取込先</span>
        {factoryLocked || factoryOptions.length === 0 ? (
          <span className="flex h-10 items-center rounded-lg border border-[#e5e5e5] bg-[#f7f7f5] px-3 text-sm text-[#333333]">
            {uploadFactory || "工場未設定"}
          </span>
        ) : (
          <select
            value={uploadFactory}
            onChange={(e) => setUploadFactory(e.target.value)}
            disabled={busy}
            aria-label="取込先の工場"
            className="h-10 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm focus:border-[#b4632c] focus:outline-none disabled:opacity-60"
          >
            {!factoryOptions.includes(uploadFactory) && uploadFactory !== "" && (
              <option value={uploadFactory}>{uploadFactory}</option>
            )}
            {factoryOptions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        )}
        <span className="flex h-10 items-center rounded-lg border border-[#e5e5e5] bg-[#f7f7f5] px-3 text-sm text-[#333333]">
          {fmtYm(ym)}
        </span>
        <span className="text-xs text-[#707070]">（月は上の「対象月」で切り替え）</span>
      </div>

      {/* ドロップ枠 */}
      <div
        role="button"
        tabIndex={0}
        aria-label="PDFをドラッグ＆ドロップ、またはクリックして選択"
        onClick={() => fileRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            fileRef.current?.click();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          if (!e.dataTransfer.types.includes("Files")) return;
          dragDepth.current++;
          setDragActive(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          if (e.dataTransfer.types.includes("Files")) e.dataTransfer.dropEffect = "copy";
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragActive(false);
        }}
        onDrop={onDrop}
        className={`cursor-pointer rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b4632c] sm:py-10 ${
          dragActive
            ? "border-[#b4632c] bg-[#fbf3ec]"
            : "border-[#d9d9d9] bg-white hover:border-[#b4632c]/60 hover:bg-[#f7f7f5]"
        }`}
      >
        <div
          className={`mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl ${
            dragActive ? "bg-[#b4632c] text-white" : "bg-[#f3e7dc] text-[#b4632c]"
          }`}
        >
          <CloudUpload className="h-7 w-7" />
        </div>
        <p className="text-base font-bold text-slate-800">
          {dragActive ? "ここに離すと取り込みます" : "ここにPDFをドラッグ＆ドロップ"}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          複数のファイルも、月のフォルダごとでもまとめて落とせます。枠を押して選ぶこともできます。
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              fileRef.current?.click();
            }}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
          >
            <FileText className="h-4 w-4" />
            ファイルを選ぶ
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              folderRef.current?.click();
            }}
            className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5]"
          >
            <FolderOpen className="h-4 w-4" />
            フォルダを選ぶ
          </button>
        </div>
        <p className="mt-4 text-xs text-slate-400">
          取込先 {targetLabel} ・ PDFのみ ・ 1ファイル {QUALITY_SHEET_MAX_BYTES / 1024 / 1024}MB まで
        </p>
        <input
          ref={fileRef}
          type="file"
          accept=".pdf,application/pdf"
          multiple
          hidden
          onChange={(e) => {
            onInputFiles(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={folderRef}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            onInputFiles(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {notice && <p className="text-xs text-[#8a5a2b]">{notice}</p>}

      {/* 取込の進み具合 */}
      {items.length > 0 && (
        <div className="rounded-2xl border border-[#e5e5e5] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#eeeeee] px-4 py-2.5 text-sm">
            <div className="flex items-center gap-2 font-medium text-slate-700">
              {busy ? (
                <LoaderCircle className="h-4 w-4 animate-spin text-[#b4632c]" />
              ) : (
                <CircleCheck className="h-4 w-4 text-emerald-600" />
              )}
              {busy ? `取込中… ${finished} / ${items.length}` : `取込結果 ${items.length} 件`}
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-[#707070]">
              <span>完了 {counts.done}</span>
              <span>取込済み {counts.duplicate}</span>
              <span className={counts.error ? "font-medium text-[#dc000c]" : ""}>エラー {counts.error}</span>
              {counts.error > 0 && !busy && (
                <button
                  type="button"
                  onClick={() => {
                    itemsRef.current = itemsRef.current.map((i) =>
                      i.status === "error" && i.file.size > 0 && i.file.size <= QUALITY_SHEET_MAX_BYTES
                        ? { ...i, status: "pending", message: "" }
                        : i
                    );
                    sync();
                    void pump();
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-[#e5e5e5] px-2 py-1 text-xs text-[#555555] hover:bg-[#f7f7f5]"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  エラー分をやり直す
                </button>
              )}
              {!busy && (
                <button
                  type="button"
                  onClick={() => {
                    itemsRef.current = [];
                    sync();
                    setNotice("");
                  }}
                  className="rounded-lg border border-[#e5e5e5] px-2 py-1 text-xs text-[#555555] hover:bg-[#f7f7f5]"
                >
                  表示を消す
                </button>
              )}
            </div>
          </div>
          <ul className="max-h-80 divide-y divide-[#f0f0f0] overflow-auto text-sm">
            {items.map((i) => (
              <li key={i.key} className="flex items-start gap-3 px-4 py-2">
                <span className="mt-0.5 shrink-0">
                  {i.status === "uploading" && (
                    <LoaderCircle className="h-4 w-4 animate-spin text-[#b4632c]" />
                  )}
                  {i.status === "pending" && <span className="block h-4 w-4 rounded-full border border-[#d9d9d9]" />}
                  {i.status === "done" && <CircleCheck className="h-4 w-4 text-emerald-600" />}
                  {i.status === "duplicate" && <Copy className="h-4 w-4 text-amber-600" />}
                  {i.status === "error" && <CircleAlert className="h-4 w-4 text-[#dc000c]" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="truncate font-medium text-slate-800" title={i.name}>
                      {i.name}
                    </span>
                    <span className="text-xs text-[#9a9a9a]">{fmtSize(i.file.size)}</span>
                  </div>
                  {i.message && (
                    <p className={`mt-0.5 text-xs ${i.status === "error" ? "text-[#dc000c]" : "text-amber-700"}`}>
                      {i.message}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-[#707070]">
                  {i.status === "pending" && "待機中"}
                  {i.status === "uploading" && "送信中"}
                  {i.status === "done" && "完了"}
                  {i.status === "duplicate" && "取込済み"}
                  {i.status === "error" && "エラー"}
                </span>
                {i.status !== "uploading" && (
                  <button
                    type="button"
                    onClick={() => {
                      itemsRef.current = itemsRef.current.filter((x) => x.key !== i.key);
                      sync();
                    }}
                    aria-label="この行を消す"
                    className="shrink-0 rounded p-1 text-[#9a9a9a] hover:bg-[#f7f7f5] hover:text-[#555555]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
