"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { deleteItemAction, saveItemAction } from "@/lib/actions";
import type { ScrapItem } from "@/lib/db";
import { fmt } from "@/lib/format";

const td = "border border-[#e5e5e5] px-2.5 py-1.5 whitespace-nowrap";
const tdNum = `${td} text-right tabular-nums`;
const th = "border border-[#e5e5e5] bg-[#f0f0ee] px-2.5 py-1.5 text-left font-semibold whitespace-nowrap";
const input =
  "w-full rounded-lg border border-[#e5e5e5] bg-white px-2.5 py-1.5 text-sm focus:border-[#b4632c] focus:outline-none";

type Draft = {
  id: string | null;
  kanriZuban: string;
  hinmei: string;
  kubun: string;
  oyaZuban: string;
  oyaHinmei: string;
  koZuban: string;
  koHinmei: string;
  tani: string;
  koseiJuryo: string;
  kanseiJuryo: string;
  seizoBashoCD: string;
  seizoBashoMei: string;
  factory: string;
};

const emptyDraft = (): Draft => ({
  id: null,
  kanriZuban: "",
  hinmei: "",
  kubun: "銅条",
  oyaZuban: "",
  oyaHinmei: "",
  koZuban: "",
  koHinmei: "",
  tani: "K",
  koseiJuryo: "",
  kanseiJuryo: "",
  seizoBashoCD: "",
  seizoBashoMei: "",
  factory: "大口",
});

const toDraft = (it: ScrapItem): Draft => ({
  id: it.id,
  kanriZuban: it.kanriZuban,
  hinmei: it.hinmei,
  kubun: it.kubun,
  oyaZuban: it.oyaZuban,
  oyaHinmei: it.oyaHinmei,
  koZuban: it.koZuban,
  koHinmei: it.koHinmei,
  tani: it.tani,
  koseiJuryo: String(it.koseiJuryo),
  kanseiJuryo: String(it.kanseiJuryo),
  seizoBashoCD: it.seizoBashoCD,
  seizoBashoMei: it.seizoBashoMei,
  factory: it.factory,
});

/** 品目マスターの一覧＋登録/編集ダイアログ（管理者のみのページから使う）。 */
export default function ItemsTable({
  items,
  truncated,
}: {
  items: ScrapItem[];
  truncated: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function set(patch: Partial<Draft>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  function save() {
    if (!draft) return;
    setError("");
    startTransition(async () => {
      const res = await saveItemAction(draft);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setDraft(null);
      router.refresh();
    });
  }

  function remove(it: ScrapItem) {
    if (!confirm(`品目「${it.key} ${it.koZuban}」を削除しますか?`)) return;
    startTransition(async () => {
      const res = await deleteItemAction(it.id);
      if (!res.ok) alert(res.message);
      router.refresh();
    });
  }

  const key = draft ? draft.kanriZuban.trim() + draft.seizoBashoCD.trim() : "";

  const field = (
    label: string,
    k: keyof Draft,
    opts: { required?: boolean; type?: string; placeholder?: string } = {}
  ) => (
    <label className="flex flex-col gap-1 text-xs text-[#707070]">
      {label}
      {opts.required ? "*" : ""}
      <input
        type={opts.type ?? "text"}
        step={opts.type === "number" ? "0.000001" : undefined}
        min={opts.type === "number" ? "0" : undefined}
        value={String(draft?.[k] ?? "")}
        placeholder={opts.placeholder}
        onChange={(e) => set({ [k]: e.target.value } as Partial<Draft>)}
        className={input}
      />
    </label>
  );

  return (
    <>
      <div className="mb-4">
        <button
          onClick={() => {
            setError("");
            setDraft(emptyDraft());
          }}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[#b4632c] px-3 py-2 text-sm font-semibold text-white hover:bg-[#96521f]"
        >
          <Plus className="h-4 w-4" />
          新規登録
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-[#e5e5e5] bg-white p-1">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {["管理図番", "品名", "KEY", "区分", "親図番", "子図番", "子品名", "単位"].map((h) => (
                <th key={h} className={th}>
                  {h}
                </th>
              ))}
              <th className={`${th} text-right`}>構成重量</th>
              <th className={`${th} text-right`}>完成重量(理論)</th>
              <th className={th}>製造場所</th>
              <th className={th}>工場</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td className={td} colSpan={13}>
                  品目がありません。「新規登録」または「CSV取込」から登録してください。
                </td>
              </tr>
            )}
            {items.map((it) => (
              <tr key={it.id} className="hover:bg-[#faf6ef]">
                <td className={td}>{it.kanriZuban}</td>
                <td className={td}>{it.hinmei}</td>
                <td className={td}>{it.key}</td>
                <td className={td}>{it.kubun}</td>
                <td className={td}>{it.oyaZuban}</td>
                <td className={td}>{it.koZuban}</td>
                <td className={td}>{it.koHinmei}</td>
                <td className={td}>{it.tani}</td>
                <td className={tdNum}>{fmt(it.koseiJuryo, 6)}</td>
                <td className={tdNum}>{fmt(it.kanseiJuryo, 6)}</td>
                <td className={td}>{it.seizoBashoMei || it.seizoBashoCD}</td>
                <td className={td}>{it.factory}</td>
                <td className={td}>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setError("");
                        setDraft(toDraft(it));
                      }}
                      className="rounded p-1 text-[#555555] hover:bg-[#f0f0ee]"
                      aria-label="編集"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => remove(it)}
                      className="rounded p-1 text-[#dc000c] hover:bg-[#fdecea]"
                      aria-label="削除"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {truncated && (
          <p className="px-3 py-2 text-xs text-[#909090]">
            500件を表示しています。検索で絞り込んでください。
          </p>
        )}
      </div>

      {/* 登録/編集ダイアログ */}
      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold text-[#333333]">
                {draft.id ? "品目編集" : "品目登録"}
              </h2>
              <button
                onClick={() => setDraft(null)}
                className="rounded p-1.5 text-[#555555] hover:bg-[#f0f0ee]"
                aria-label="閉じる"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {field("管理図番", "kanriZuban", { required: true })}
              {field("製造場所CD", "seizoBashoCD", { required: true, placeholder: "Z023000" })}
              <label className="flex flex-col gap-1 text-xs text-[#707070]">
                KEY（自動 = 管理図番+製造場所CD）
                <input value={key} readOnly className={`${input} bg-[#f7f7f5]`} />
              </label>
              {field("品名", "hinmei")}
              <label className="flex flex-col gap-1 text-xs text-[#707070]">
                区分
                <select
                  value={draft.kubun}
                  onChange={(e) => set({ kubun: e.target.value })}
                  className={input}
                >
                  {["銅条", "銅管", "その他"].map((o) => (
                    <option key={o}>{o}</option>
                  ))}
                </select>
              </label>
              {field("親図番", "oyaZuban")}
              {field("親品名", "oyaHinmei")}
              {field("子図番", "koZuban")}
              {field("子品名", "koHinmei")}
              {field("単位", "tani")}
              {field("構成重量(kg/個)", "koseiJuryo", { required: true, type: "number" })}
              {field("完成重量(理論値 kg/個)", "kanseiJuryo", { type: "number" })}
              {field("製造場所名", "seizoBashoMei")}
              {field("工場", "factory")}
            </div>
            {error && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setDraft(null)}
                className="rounded-lg border border-[#e5e5e5] px-4 py-2 text-sm text-[#555555] hover:bg-[#f7f7f5]"
              >
                キャンセル
              </button>
              <button
                onClick={save}
                disabled={pending}
                className="rounded-lg bg-[#b4632c] px-4 py-2 text-sm font-semibold text-white hover:bg-[#96521f] disabled:opacity-50"
              >
                {pending ? "保存中…" : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
