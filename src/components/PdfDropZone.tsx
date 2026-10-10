"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CloudUpload, FileText, FolderOpen, LoaderCircle } from "lucide-react";

/** 選ばれたPDF1件。フォルダから拾ったものは相対パス（例 "202609/0901.pdf"）を持つ。 */
export interface PickedPdf {
  file: File;
  path: string;
}

/** 一度に受け付ける上限（月フォルダ1つ分より十分大きい。誤って全社フォルダを落とした保険） */
const MAX_FILES = 300;
/** フォルダをたどる深さ */
const MAX_DEPTH = 6;

const isPdf = (name: string, type: string) => /\.pdf$/i.test(name) || type === "application/pdf";

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
async function walk(entry: FileSystemEntry, depth: number, out: PickedPdf[]): Promise<void> {
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
    // 名前順に（フォルダの並びどおりに読まれるほうが確認しやすい）
    children.sort((a, b) => a.name.localeCompare(b.name, "ja"));
    for (const c of children) await walk(c, depth + 1, out);
  }
}

/**
 * PDFのドラッグ＆ドロップ枠。
 * - 複数ファイルも、フォルダごと落としても中のPDFだけを拾う
 * - 枠を押す／「ファイルを選ぶ」「フォルダを選ぶ」でも同じ
 * - PDF以外は数えて知らせるだけで渡さない
 * 受け取ったファイルをどうするかは呼び出し側（onFiles）に任せる。
 */
export default function PdfDropZone({
  onFiles,
  disabled = false,
  busyLabel = "",
  title = "ここにPDFをドラッグ＆ドロップ",
  hint = "複数のファイルも、月のフォルダごとでもまとめて落とせます。枠を押して選ぶこともできます。",
  footnote = "",
}: {
  onFiles: (files: PickedPdf[], info: { skippedNonPdf: number; truncated: number }) => void;
  disabled?: boolean;
  /** 処理中の表示（空なら通常表示） */
  busyLabel?: string;
  title?: string;
  hint?: string;
  footnote?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  // 子要素をまたぐと dragleave が飛ぶので、深さを数えて枠のハイライトがちらつかないようにする
  const dragDepth = useRef(0);
  const [dragActive, setDragActive] = useState(false);

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

  const deliver = useCallback(
    (picked: PickedPdf[]) => {
      let skippedNonPdf = 0;
      let truncated = 0;
      const pdfs: PickedPdf[] = [];
      for (const p of picked) {
        if (!isPdf(p.file.name, p.file.type)) {
          skippedNonPdf++;
          continue;
        }
        if (pdfs.length >= MAX_FILES) {
          truncated++;
          continue;
        }
        pdfs.push(p);
      }
      onFiles(pdfs, { skippedNonPdf, truncated });
    },
    [onFiles]
  );

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    dragDepth.current = 0;
    setDragActive(false);
    if (disabled) return;
    const dt = e.dataTransfer;
    // DataTransfer は await をまたぐと読めなくなるので、同期のうちに全部取り出す
    const plain: File[] = Array.from(dt.files ?? []);
    const fileItems = dt.items ? Array.from(dt.items).filter((it) => it.kind === "file") : [];
    const entries = fileItems
      .map((it) => (typeof it.webkitGetAsEntry === "function" ? it.webkitGetAsEntry() : null))
      .filter((en): en is FileSystemEntry => Boolean(en));
    void (async () => {
      let picked: PickedPdf[];
      if (entries.length > 0 && entries.length === fileItems.length) {
        picked = [];
        for (const en of entries) await walk(en, 0, picked);
      } else {
        picked = plain.map((f) => ({ file: f, path: f.name }));
      }
      deliver(picked);
    })();
  }

  function onInputFiles(list: FileList | null) {
    if (!list) return;
    deliver(
      Array.from(list).map((f) => ({
        file: f,
        // フォルダ選択なら相対パス（Chrome/Edge/Safari は webkitRelativePath に入る）
        path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
      }))
    );
  }

  const busy = Boolean(busyLabel);
  const off = disabled || busy;

  return (
    <div
      role="button"
      tabIndex={off ? -1 : 0}
      aria-disabled={off}
      aria-label="PDFをドラッグ＆ドロップ、またはクリックして選択"
      onClick={() => !off && fileRef.current?.click()}
      onKeyDown={(e) => {
        if (off) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          fileRef.current?.click();
        }
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        if (off || !e.dataTransfer.types.includes("Files")) return;
        dragDepth.current++;
        setDragActive(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (e.dataTransfer.types.includes("Files")) e.dataTransfer.dropEffect = off ? "none" : "copy";
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1);
        if (dragDepth.current === 0) setDragActive(false);
      }}
      onDrop={onDrop}
      className={`rounded-2xl border-2 border-dashed px-4 py-8 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#b4632c] sm:py-10 ${
        off
          ? "cursor-default border-[#e5e5e5] bg-[#fafaf8]"
          : dragActive
            ? "cursor-copy border-[#b4632c] bg-[#fbf3ec]"
            : "cursor-pointer border-[#d9d9d9] bg-white hover:border-[#b4632c]/60 hover:bg-[#f7f7f5]"
      }`}
    >
      <div
        className={`mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl ${
          dragActive ? "bg-[#b4632c] text-white" : "bg-[#f3e7dc] text-[#b4632c]"
        }`}
      >
        {busy ? <LoaderCircle className="h-7 w-7 animate-spin" /> : <CloudUpload className="h-7 w-7" />}
      </div>
      <p className="text-base font-bold text-slate-800">
        {busy ? busyLabel : dragActive ? "ここに離すと読み取ります" : title}
      </p>
      {!busy && <p className="mt-1 text-sm text-slate-500">{hint}</p>}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          disabled={off}
          onClick={(e) => {
            e.stopPropagation();
            fileRef.current?.click();
          }}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5] disabled:opacity-50"
        >
          <FileText className="h-4 w-4" />
          ファイルを選ぶ
        </button>
        <button
          type="button"
          disabled={off}
          onClick={(e) => {
            e.stopPropagation();
            folderRef.current?.click();
          }}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#e5e5e5] bg-white px-3 text-sm font-medium text-[#555555] hover:bg-[#f7f7f5] disabled:opacity-50"
        >
          <FolderOpen className="h-4 w-4" />
          フォルダを選ぶ
        </button>
      </div>
      {footnote && <p className="mt-4 text-xs text-slate-400">{footnote}</p>}
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
  );
}
