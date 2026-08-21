"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { deleteScrapKindAction, saveScrapKindAction } from "@/lib/actions";
import { kindColor, type ScrapKind } from "@/lib/scrapTypes";

const input =
  "h-11 rounded-lg border border-[#e5e5e5] bg-white px-3 text-base focus:border-[#b4632c] focus:outline-none sm:h-10 sm:text-sm";
const td = "border border-[#e5e5e5] px-3 py-2";
const th = "border border-[#e5e5e5] bg-[#f0f0ee] px-3 py-2 text-left font-semibold whitespace-nowrap";

type Draft = { id: string | null; name: string; sort: string; active: boolean };

/**
 * スクラップ種類の一覧＋登録/編集。
 * 種類名は日次記録の集計キーになるため、使用中の種類は削除できない
 * （「使用しない」に切り替えると新規の選択肢から外れる）。
 */
export default function ScrapKindsTable({ kinds }: { kinds: ScrapKind[] }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  function save() {
    if (!draft) return;
    setError("");
    startTransition(async () => {
      const res = await saveScrapKindAction({
        id: draft.id,
        name: draft.name,
        sort: draft.sort,
        active: draft.active,
      });
      if (!res.ok) {
        setError(res.message);
        return;
      }
      setDraft(null);
      router.refresh();
    });
  }

  function remove(k: ScrapKind) {
    if (!confirm(`スクラップ種類「${k.name}」を削除しますか?`)) return;
    startTransition(async () => {
      const res = await deleteScrapKindAction(k.id);
      if (!res.ok) alert(res.message);
      router.refresh();
    });
  }

  const nextSort = kinds.length ? Math.max(...kinds.map((k) => k.sort)) + 1 : 1;

  return (
    <section className="rounded-2xl border border-[#e5e5e5] bg-white p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold text-[#333333] sm:text-sm">
          スクラップ種類（{kinds.length}件）
        </h2>
        <button
          onClick={() => setDraft({ id: null, name: "", sort: String(nextSort), active: true })}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#b4632c] px-3 text-sm font-semibold text-white hover:bg-[#96521f]"
        >
          <Plus className="h-4 w-4" />
          新規登録
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className={`${th} w-20 text-right`}>表示順</th>
              <th className={th}>種類名</th>
              <th className={`${th} w-28`}>状態</th>
              <th className={`${th} w-28`}></th>
            </tr>
          </thead>
          <tbody>
            {kinds.length === 0 && (
              <tr>
                <td className={td} colSpan={4}>
                  種類がありません。「新規登録」から追加してください。
                </td>
              </tr>
            )}
            {kinds.map((k, i) => (
              <tr key={k.id} className="hover:bg-[#faf6ef]">
                <td className={`${td} text-right tabular-nums`}>{k.sort}</td>
                <td className={td}>
                  <span
                    className={`rounded-md px-2 py-0.5 text-xs font-bold ${kindColor(k.name, i)}`}
                  >
                    {k.name}
                  </span>
                </td>
                <td className={td}>
                  {k.active ? (
                    <span className="text-xs text-[#2f6b2f]">使用中</span>
                  ) : (
                    <span className="text-xs text-[#909090]">使用しない</span>
                  )}
                </td>
                <td className={td}>
                  <div className="flex gap-1">
                    <button
                      onClick={() =>
                        setDraft({
                          id: k.id,
                          name: k.name,
                          sort: String(k.sort),
                          active: k.active,
                        })
                      }
                      className="rounded p-1.5 text-[#555555] hover:bg-[#f0f0ee]"
                      aria-label={`${k.name}を編集`}
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => remove(k)}
                      className="rounded p-1.5 text-[#dc000c] hover:bg-[#fdecea]"
                      aria-label={`${k.name}を削除`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-xs text-[#909090]">
        種類名は日次記録の集計に使われます。使用中の種類は削除できません（「使用しない」に切り替えると、
        重量計の登録と日次記録の選択肢から外れます。過去の記録と集計はそのまま残ります）。
      </p>

      {draft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-base font-bold text-[#333333]">
                {draft.id ? "スクラップ種類の編集" : "スクラップ種類の登録"}
              </h3>
              <button
                onClick={() => setDraft(null)}
                className="rounded p-1.5 text-[#555555] hover:bg-[#f0f0ee]"
                aria-label="閉じる"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="space-y-3">
              <label className="flex flex-col gap-1 text-xs text-[#707070]">
                種類名*（例: 銅スクラップ）
                <input
                  type="text"
                  value={draft.name}
                  onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  className={input}
                  placeholder="銅スクラップ"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs text-[#707070]">
                表示順（小さいほど先に出ます）
                <input
                  type="number"
                  inputMode="numeric"
                  value={draft.sort}
                  onChange={(e) => setDraft({ ...draft, sort: e.target.value })}
                  className={`${input} w-28 text-right tabular-nums`}
                />
              </label>
              <label className="flex items-center gap-2.5 text-sm">
                <input
                  type="checkbox"
                  checked={draft.active}
                  onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
                  className="h-5 w-5 accent-[#b4632c]"
                />
                使用中（外すと新規の選択肢に出ません）
              </label>
              {error && <p className="text-sm text-[#dc000c]">{error}</p>}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={() => setDraft(null)}
                className="h-10 rounded-lg border border-[#e5e5e5] px-4 text-sm text-[#555555] hover:bg-[#f7f7f5]"
              >
                キャンセル
              </button>
              <button
                onClick={save}
                disabled={pending}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-[#b4632c] px-4 text-sm font-semibold text-white hover:bg-[#96521f] disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
